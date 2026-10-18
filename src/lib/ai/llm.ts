import type { ProviderConfig } from "@/types";

/**
 * Carmenita's LLM transport — a port of CarmNote's `transform-core.ts`
 * (handai/handainotes/carm-transform, as of 1f32edc), HTTP providers only.
 *
 * One plain `fetch` per provider instead of an SDK, so what goes on the wire
 * is visible and testable (`buildProviderRequest` is pure). The transport
 * self-corrects the refusals that actually break runs — a model that rejects
 * `temperature`, renames `max_tokens`, or caps output lower than asked — and
 * remembers each correction for the life of the server process, so a batch
 * pays for a refusal once, not once per question.
 *
 * Left out of the port: Chrome built-in AI and WebGPU (they run inside a
 * browser tab, and every Carmenita LLM call runs in an API route), request
 * pacing, live diagnostics and multi-turn input.
 */

export interface LLMSettings {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  azureApiVersion?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  /** Internal: set by self-correction when a provider wants the renamed parameter. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  retries?: number;
  timeoutMs?: number;
}

export interface LLMResult {
  output: string;
  latencyMs: number;
}

/** An LLM failure that carries the provider's HTTP status when there was one. */
export class LLMError extends Error {
  status?: number;
  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LLMError";
    this.status = status;
  }
}

/**
 * Base URLs and a default model per provider. `local` means no cloud account:
 * the API key is optional.
 */
export const PROVIDERS: Record<string, { label: string; baseUrl: string; model: string; local?: boolean }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-4-6" },
  google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2", local: true },
  lmstudio: { label: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "", local: true },
  azure: { label: "Azure OpenAI", baseUrl: "", model: "gpt-4.1-mini" },
  custom: { label: "Custom OpenAI-compatible", baseUrl: "", model: "" },
};

/**
 * Anthropic requires `max_tokens`. A quiz batch is a long JSON array, so the
 * default is generous; a model with a lower ceiling says so in its error and
 * `adaptTokenParameter` clamps to it.
 */
const ANTHROPIC_DEFAULT_MAX_TOKENS = 16000;

function cleanBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Settings for one call from a stored provider config. Azure's base URL field
 * has always held the resource name in Carmenita, so a bare name is expanded
 * to its endpoint; a full URL is used as given.
 */
export function settingsFromProvider(
  provider: ProviderConfig,
  options: { temperature?: number | null; maxTokens?: number | null } = {},
): LLMSettings {
  let baseUrl = provider.baseUrl?.trim() || undefined;
  if (provider.providerType === "azure" && baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}.openai.azure.com`;
  }
  return {
    provider: provider.providerType,
    model: provider.defaultModel,
    apiKey: provider.apiKey,
    baseUrl,
    // Current Claude models reject `temperature` outright; not sending it
    // saves the failed first request `adaptTemperature` would otherwise pay.
    temperature: provider.providerType === "anthropic" ? null : options.temperature ?? null,
    maxTokens: options.maxTokens ?? null,
  };
}

/**
 * Cut `<think>…</think>` blocks out of a reply. Local reasoning models (Qwen3
 * through Ollama or LM Studio) send their thinking inline, which otherwise
 * reaches the JSON parser and turns a good reply into a parse failure. An
 * unclosed block — the model hit its cap mid-thought — is all thinking.
 */
export function splitThinkTags(text: string): string {
  let output = String(text ?? "").replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  const open = output.match(/<think(?:ing)?>[\s\S]*$/i);
  if (open) output = output.slice(0, open.index);
  return output.trim();
}

/** One HTTP request to a provider, exactly as `callLLM` sends it. */
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** The request one attempt sends. Pure: no network, no learned quirks. */
export function buildProviderRequest(settings: LLMSettings, systemPrompt: string, userContent: string): ProviderRequest {
  const provider = settings.provider;
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  const base = cleanBase(settings.baseUrl || preset.baseUrl);
  if (!base) throw new LLMError("A base URL is required", 400);
  if (!settings.model.trim()) throw new LLMError("A model ID is required", 400);
  const temperature = settings.temperature;
  const maxTokens = settings.maxTokens || undefined;
  const tokenParam = settings.tokenParam || "max_tokens";
  const messages = [{ role: "user", content: userContent }];
  let url: string;
  let headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: Record<string, unknown>;

  if (provider === "anthropic") {
    url = `${base}/messages`;
    headers = { ...headers, "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" };
    body = {
      model: settings.model,
      system: systemPrompt,
      messages,
      max_tokens: maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS,
      ...(temperature != null ? { temperature } : {}),
    };
  } else if (provider === "google") {
    url = `${base}/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers = { ...headers, "x-goog-api-key": settings.apiKey };
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      },
    };
  } else if (provider === "azure") {
    const version = encodeURIComponent(settings.azureApiVersion || "2024-10-21");
    url = `${base}/openai/deployments/${encodeURIComponent(settings.model)}/chat/completions?api-version=${version}`;
    headers = { ...headers, "api-key": settings.apiKey };
    body = {
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      ...(temperature != null ? { temperature } : {}),
      ...(maxTokens ? { [tokenParam]: maxTokens } : {}),
    };
  } else {
    url = `${base}/chat/completions`;
    headers = { ...headers, Authorization: `Bearer ${settings.apiKey || (preset.local ? "local" : "")}` };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://carmenita.app";
      headers["X-Title"] = "Carmenita Quiz Generator";
    }
    body = {
      model: settings.model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      ...(temperature != null ? { temperature } : {}),
      ...(maxTokens ? { [tokenParam]: maxTokens } : {}),
    };
  }

  return { url, headers, body };
}

/** The answer text in a provider's JSON reply. Throws when it holds none. */
export function readProviderReply(provider: string, json: unknown): string {
  const reply = json as {
    content?: Array<{ type?: string; text?: string }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (provider === "anthropic") {
    return splitThinkTags((reply.content || []).map((part) => (part.type === "text" ? part.text || "" : "")).join(""));
  }
  if (provider === "google") {
    const parts = reply.candidates?.[0]?.content?.parts || [];
    return splitThinkTags(parts.filter((part) => part.thought !== true).map((part) => part.text || "").join(""));
  }
  const content = reply.choices?.[0]?.message?.content;
  if (typeof content === "string") return splitThinkTags(content);
  if (Array.isArray(content)) return splitThinkTags(content.map((part: { text?: string }) => part.text || "").join(""));
  throw new LLMError("Provider response did not contain text output");
}

/** The provider's own error text when its body says one, else the body, else the status line. */
export function responseErrorMessage(status: number, statusText: string, text: string): string {
  let detail: unknown = text;
  try {
    const parsed = JSON.parse(text);
    detail = parsed.error?.message || parsed.error || parsed.message || text;
  } catch { /* not JSON: use the response text */ }
  return String(detail || `${status} ${statusText}`);
}

async function responseError(response: Response): Promise<LLMError> {
  const text = await response.text().catch(() => "");
  return new LLMError(responseErrorMessage(response.status, response.statusText, text), response.status);
}

function retryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status && [400, 401, 403, 404, 422].includes(status)) return false;
  return !(error instanceof DOMException && error.name === "AbortError");
}

// ── Learned provider quirks ─────────────────────────────────────────────────
// A model that rejects a parameter once rejects it every time, so each
// correction is remembered per endpoint for the life of the process. Memory
// only: never written back into the user's settings.

export interface ProviderQuirks {
  dropTemperature?: boolean;
  tokenParam?: "max_completion_tokens";
  /** The largest output cap the model accepted; null when it refused any. */
  maxTokens?: number | null;
}

const QUIRKS = new Map<string, ProviderQuirks>();

function quirkKey(settings: LLMSettings): string {
  return `${settings.provider}|${settings.baseUrl || ""}|${settings.model}`;
}

export function knownQuirks(settings: LLMSettings): ProviderQuirks | undefined {
  return QUIRKS.get(quirkKey(settings));
}

/** Forget every learned correction — for tests. */
export function forgetQuirks(): void {
  QUIRKS.clear();
}

function withKnownQuirks(settings: LLMSettings): LLMSettings {
  const learned = QUIRKS.get(quirkKey(settings));
  if (!learned) return settings;
  const next = { ...settings };
  if (learned.dropTemperature) next.temperature = null;
  if (learned.tokenParam) next.tokenParam = learned.tokenParam;
  // A learned ceiling only ever lowers the configured value.
  if (learned.maxTokens !== undefined && next.maxTokens != null) {
    next.maxTokens = learned.maxTokens == null ? null : Math.min(next.maxTokens, learned.maxTokens);
  }
  return next;
}

function rememberQuirk(before: LLMSettings, after: LLMSettings): void {
  const key = quirkKey(before);
  const learned = QUIRKS.get(key) || {};
  if (before.temperature != null && after.temperature == null) learned.dropTemperature = true;
  if (after.tokenParam === "max_completion_tokens" && after.tokenParam !== before.tokenParam) learned.tokenParam = after.tokenParam;
  if (after.maxTokens !== before.maxTokens) learned.maxTokens = after.maxTokens ?? null;
  QUIRKS.set(key, learned);
}

/**
 * Drop a rejected temperature. Current Claude models and OpenAI reasoning
 * models accept only their default; temperature is a preference, so the run
 * should go on without it rather than die.
 */
export function adaptTemperature(settings: LLMSettings, error: unknown): LLMSettings | null {
  const message = String((error as Error)?.message || "");
  if (!/temperature/i.test(message)) return null;
  if (settings.temperature == null) return null;
  return { ...settings, temperature: null };
}

/**
 * Correct a rejected output-token setting, most specific first: the renamed
 * parameter (`max_completion_tokens`), then the ceiling the error states,
 * then no cap at all.
 */
export function adaptTokenParameter(settings: LLMSettings, error: unknown): LLMSettings | null {
  const message = String((error as Error)?.message || "");
  if (!/max[_ ]?tokens|max_completion_tokens|maxOutputTokens|output token|completion token/i.test(message)) return null;
  if (/max_completion_tokens/i.test(message) && settings.tokenParam !== "max_completion_tokens") {
    return { ...settings, tokenParam: "max_completion_tokens" };
  }
  // Anthropic always sends a cap, so a refused default counts as configured.
  const configured = settings.maxTokens || (settings.provider === "anthropic" ? ANTHROPIC_DEFAULT_MAX_TOKENS : 0);
  if (configured) {
    const stated = (message.match(/\d{2,7}/g) || []).map(Number).filter((n) => n > 0 && n < configured);
    if (stated.length) return { ...settings, maxTokens: Math.max(...stated) };
    if (settings.provider !== "anthropic" && settings.maxTokens) return { ...settings, maxTokens: null };
  }
  return null;
}

/** A provider/network error message with an actionable next step appended. */
export function friendlyError(error: unknown): string {
  const message = String((error as Error)?.message ?? error ?? "Unknown error").trim() || "Unknown error";
  const status = (error as { status?: number })?.status;
  if (status === 401 || /invalid[_ ]?(x-)?api[_ -]?key|unauthorized|authentication/i.test(message)) return `${message} — check the API key in Settings.`;
  if (status === 403) return `${message} — this key is not allowed to use that model.`;
  if (status === 404 || /model.+(not found|does not exist)/i.test(message)) return `${message} — check the model ID in Settings.`;
  if (status === 429 || /rate.?limit|quota|overloaded/i.test(message)) return `${message} — the provider is rate-limiting; wait a moment and retry.`;
  if (/max[_ ]?tokens|max_completion_tokens|maxOutputTokens|output token|completion token/i.test(message)) return `${message} — clear Maximum output tokens in Settings (empty = provider default).`;
  if (/timed out/i.test(message)) return `${message} — try a faster model or fewer questions per run.`;
  if (/failed to fetch|networkerror|load failed|fetch failed|ECONNREFUSED/i.test(message)) return "Could not reach the provider — check the base URL, and that a local server (Ollama, LM Studio) is running.";
  return message;
}

/**
 * The error a failed call surfaces: the friendly message, prefixed with the
 * HTTP status so the routes can tell an auth failure (401/403) from the rest.
 */
function finalError(error: unknown): LLMError {
  const status = (error as { status?: number })?.status;
  const prefix = status ? `HTTP ${status}: ` : "";
  return new LLMError(prefix + friendlyError(error), status, { cause: error });
}

async function callOnce(settings: LLMSettings, systemPrompt: string, userContent: string, signal: AbortSignal): Promise<string> {
  const request = buildProviderRequest(settings, systemPrompt, userContent);
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
  if (!response.ok) throw await responseError(response);
  return readProviderReply(settings.provider, await response.json());
}

/**
 * One completion, with retries for transient failures and self-correction for
 * parameter refusals (which do not spend the retry budget).
 */
export async function callLLM(
  settings: LLMSettings,
  systemPrompt: string,
  userContent: string,
  outerSignal?: AbortSignal,
): Promise<LLMResult> {
  const started = performance.now();
  const attempts = Math.max(1, (settings.retries ?? 2) + 1);
  let current = withKnownQuirks(settings);
  let adaptations = 0;
  let lastError: unknown;
  // Retries and self-corrections are sequential by nature: each attempt
  // depends on how the previous one failed.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (outerSignal?.aborted) throw outerSignal.reason ?? new DOMException("Request aborted", "AbortError");
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, current.timeoutMs || 180_000);
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
    const abort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener("abort", abort, { once: true });
    try {
      const output = await callOnce(current, systemPrompt, userContent, controller.signal);
      return { output, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      lastError = error;
      if (!outerSignal?.aborted && adaptations < 3) {
        const adapted = adaptTokenParameter(current, error) ?? adaptTemperature(current, error);
        if (adapted) {
          rememberQuirk(current, adapted);
          current = adapted;
          adaptations += 1;
          attempt -= 1;
          continue;
        }
      }
      if (outerSignal?.aborted || attempt === attempts || !retryable(error)) throw finalError(error);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1) + Math.random() * 150));
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", abort);
    }
  }
  throw finalError(lastError);
}

/**
 * The models this key can use, for the Settings model picker. A suggestion,
 * never a whitelist: the model field stays free text. Doubles as the
 * credential check — a bad key fails here, next to the field that caused it.
 */
export async function listModels(settings: LLMSettings, signal?: AbortSignal): Promise<string[]> {
  const provider = settings.provider;
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  if (provider === "azure") {
    throw new LLMError("Azure lists deployments in the portal, not over this API — type the deployment name.", 400);
  }
  const base = cleanBase(settings.baseUrl || preset.baseUrl);
  if (!base) throw new LLMError("A base URL is required", 400);

  let headers: Record<string, string>;
  if (provider === "anthropic") {
    headers = { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" };
  } else if (provider === "google") {
    headers = { "x-goog-api-key": settings.apiKey };
  } else {
    headers = { Authorization: `Bearer ${settings.apiKey || (preset.local ? "local" : "")}` };
  }

  const response = await fetch(`${base}/models`, { headers, signal });
  if (!response.ok) throw await responseError(response);
  const json = (await response.json()) as {
    data?: Array<{ id?: unknown }>;
    models?: Array<{ name?: unknown; id?: unknown }>;
  };
  const ids = Array.isArray(json.data)
    ? json.data.map((entry) => String(entry.id ?? ""))
    : Array.isArray(json.models)
      // Google answers "models/gemini-2.5-flash"; the request wants the tail.
      ? json.models.map((entry) => String(entry.name ?? entry.id ?? "").replace(/^models\//, ""))
      : [];
  return [...new Set(ids.filter(Boolean))].sort();
}

/**
 * One tiny real request down the same path a quiz run uses — the only check
 * that proves the model answers, including the transport's self-correction.
 */
export async function testConnection(settings: LLMSettings, signal?: AbortSignal): Promise<LLMResult & { ok: boolean }> {
  const reply = await callLLM(
    { ...settings, retries: 0, timeoutMs: Math.min(settings.timeoutMs ?? 45_000, 45_000) },
    "Reply with the single word OK.",
    "ping",
    signal,
  );
  return { ...reply, ok: reply.output.trim() !== "" };
}
