import type { ProviderConfig } from "@/types";
import { logLine } from "@/lib/request-log";

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
 * Shared GPU servers (Dynasite on filex: 64 request slots for every app)
 * shaped the rest, after Carmenita jammed Qwen there on 2026-10-24: every
 * request carries an output cap, reasoning models are told not to think at
 * length, at most MAX_IN_FLIGHT calls are open per endpoint, timeouts are
 * never retried (the abandoned request keeps running on the GPU), and
 * self-hosted endpoints stream with an idle timeout instead of a total one.
 *
 * Left out of the port: Chrome built-in AI and WebGPU (they run inside a
 * browser tab, and every Carmenita LLM call runs in an API route) and live
 * diagnostics.
 */

export interface LLMSettings {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  azureApiVersion?: string;
  temperature?: number | null;
  /** Output cap. Undefined = DEFAULT_MAX_TOKENS; null = none (only self-correction sets it). */
  maxTokens?: number | null;
  /** Internal: set by self-correction when a provider wants the renamed parameter. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  /** Internal: set by self-correction when a server refuses `thinkingParams`. */
  noThinkingParams?: boolean;
  /** Internal: set by self-correction when a streaming server refuses `stream_options`. */
  noStreamUsage?: boolean;
  retries?: number;
  timeoutMs?: number;
  /** Streamed calls: give up when the model has sent nothing for this long. */
  idleTimeoutMs?: number;
}

/** One turn of a conversation, for multi-turn calls (the chat). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * What a call used, as the provider reported it. Null when it didn't say.
 * `costUsd` only comes from providers that price the call themselves (a
 * LiteLLM proxy's `x-litellm-response-cost` header, OpenRouter's
 * `usage.cost`); Carmenita keeps no price list of its own.
 */
export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface LLMResult {
  output: string;
  latencyMs: number;
  usage: LLMUsage;
}

/**
 * An LLM failure that carries the provider's HTTP status when there was one,
 * the wait its `Retry-After` header asked for, and whether retrying is futile.
 */
export class LLMError extends Error {
  status?: number;
  retryAfterMs?: number;
  noRetry?: boolean;
  constructor(
    message: string,
    status?: number,
    options?: { cause?: unknown; retryAfterMs?: number; noRetry?: boolean },
  ) {
    super(message, options);
    this.name = "LLMError";
    this.status = status;
    this.retryAfterMs = options?.retryAfterMs;
    this.noRetry = options?.noRetry;
  }
}

/**
 * Base URLs and a default model per provider. `local` means no cloud account:
 * the API key is optional.
 */
export const PROVIDERS: Record<string, { label: string; baseUrl: string; model: string; local?: boolean }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" },
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
 * The output cap a request carries when its caller set none. Without a cap a
 * vLLM server lets a reply run to the context limit, and a thinking model can
 * loop there for half an hour holding a GPU slot. 16 000 is the cap Dynasite's
 * Qwen applies itself. A model with a lower ceiling says so in its error and
 * `adaptTokenParameter` clamps to it.
 */
export const DEFAULT_MAX_TOKENS = 16_000;

/** Output budgets per kind of call, in tokens (a model's reasoning included). */
export const OUTPUT_BUDGET = { chat: 2000, explanation: 1000, tagging: 800, test: 512 } as const;

/**
 * The budget for a reply of `count` questions. One question with five
 * options, an explanation and tags is about 300–400 tokens; the rest is room
 * for a model that reasons before answering.
 */
export function questionBudget(count: number): number {
  return Math.min(DEFAULT_MAX_TOKENS, 2000 + 600 * Math.max(1, Math.round(count)));
}

/** The cap a request sends; undefined = none. Anthropic always needs one. */
function effectiveMaxTokens(settings: LLMSettings): number | undefined {
  if (settings.maxTokens === null) return settings.provider === "anthropic" ? DEFAULT_MAX_TOKENS : undefined;
  return settings.maxTokens || DEFAULT_MAX_TOKENS;
}

/**
 * Self-hosted OpenAI-compatible endpoints: vLLM, a LiteLLM proxy such as
 * Dynasite (providerType "custom"), Ollama, LM Studio. Only these get the
 * thinking switch and streaming; cloud APIs keep the request they always had.
 */
const SELF_HOSTED = new Set(["custom", "ollama", "lmstudio"]);

/** True when calls to this provider stream (with an idle timeout). */
export function streams(settings: LLMSettings): boolean {
  return SELF_HOSTED.has(settings.provider);
}

/**
 * Fields that keep a reasoning model from spending its budget thinking.
 * Qwen3 thinks at length by default (vLLM's `enable_thinking` switch turns it
 * off); gpt-oss reasons at medium effort unless told `low`. A server that
 * refuses the fields gets them dropped by `adaptExtraParameters`.
 */
export function thinkingParams(settings: LLMSettings): Record<string, unknown> {
  if (!SELF_HOSTED.has(settings.provider) || settings.noThinkingParams) return {};
  if (/qwen3/i.test(settings.model)) return { chat_template_kwargs: { enable_thinking: false } };
  if (/gpt-oss/i.test(settings.model)) return { reasoning_effort: "low" };
  return {};
}

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
    maxTokens: options.maxTokens ?? undefined,
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

/**
 * The request one attempt sends. Pure: no network, no learned quirks.
 * `input` is one user message, or a whole conversation (oldest first).
 */
export function buildProviderRequest(settings: LLMSettings, systemPrompt: string, input: string | ChatTurn[]): ProviderRequest {
  const provider = settings.provider;
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  const base = cleanBase(settings.baseUrl || preset.baseUrl);
  if (!base) throw new LLMError("A base URL is required", 400);
  if (!settings.model.trim()) throw new LLMError("A model ID is required", 400);
  const temperature = settings.temperature;
  const maxTokens = effectiveMaxTokens(settings);
  const tokenParam = settings.tokenParam || "max_tokens";
  const messages: ChatTurn[] = typeof input === "string" ? [{ role: "user", content: input }] : input;
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
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(temperature != null ? { temperature } : {}),
    };
  } else if (provider === "google") {
    url = `${base}/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers = { ...headers, "x-goog-api-key": settings.apiKey };
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      // Gemini calls the assistant "model".
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
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
      ...thinkingParams(settings),
      ...(streams(settings)
        ? { stream: true, ...(settings.noStreamUsage ? {} : { stream_options: { include_usage: true } }) }
        : {}),
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

/** True when the reply stopped because it reached the output cap. */
export function replyWasCut(provider: string, json: unknown): boolean {
  const reply = json as {
    stop_reason?: unknown;
    candidates?: Array<{ finishReason?: unknown }>;
    choices?: Array<{ finish_reason?: unknown }>;
  };
  if (provider === "anthropic") return reply.stop_reason === "max_tokens";
  if (provider === "google") return reply.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return reply.choices?.[0]?.finish_reason === "length";
}

/**
 * Read an OpenAI-style event stream (`data: {…}` lines ending `data: [DONE]`)
 * into the shape a non-streamed reply has, so `readProviderReply` and
 * `readProviderUsage` read both. Reasoning deltas are skipped (they are not
 * the answer), but every chunk, keep-alive comments included, calls
 * `onActivity`, so an idle timeout fires only when the server has gone quiet.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onActivity: () => void = () => {},
): Promise<{ choices: Array<{ message: { content: string }; finish_reason: string | null }>; usage?: unknown }> {
  const reader = body.getReader();
  // Cancelling unblocks a pending read; the abort reason is thrown below, so
  // a failure of the cancel itself has nothing left to report.
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let finishReason: string | null = null;
  let usage: unknown;
  const readLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as {
      error?: { message?: string; code?: unknown } | string;
      choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
      usage?: unknown;
    };
    if (chunk.error) {
      const error = typeof chunk.error === "string" ? { message: chunk.error } : chunk.error;
      const code = Number(error.code);
      throw new LLMError(String(error.message || "Stream error"), code >= 400 && code < 600 ? code : undefined);
    }
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string") content += choice.delta.content;
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };
  try {
    // A stream is read chunk by chunk until it ends; each read waits on the last.
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      onActivity();
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      lines.forEach(readLine);
    }
    readLine((pending + decoder.decode()).trim());
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  return { choices: [{ message: { content }, finish_reason: finishReason }], ...(usage ? { usage } : {}) };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Token counts (and a price, when the provider states one) from a reply.
 * `costHeader` is a LiteLLM proxy's `x-litellm-response-cost`.
 */
export function readProviderUsage(provider: string, json: unknown, costHeader?: string | null): LLMUsage {
  const reply = json as {
    usage?: { input_tokens?: unknown; output_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  };
  const headerCost = costHeader != null && costHeader.trim() !== "" ? count(Number(costHeader)) : null;
  if (provider === "anthropic") {
    return { inputTokens: count(reply.usage?.input_tokens), outputTokens: count(reply.usage?.output_tokens), costUsd: headerCost };
  }
  if (provider === "google") {
    return {
      inputTokens: count(reply.usageMetadata?.promptTokenCount),
      outputTokens: count(reply.usageMetadata?.candidatesTokenCount),
      costUsd: headerCost,
    };
  }
  return {
    inputTokens: count(reply.usage?.prompt_tokens),
    outputTokens: count(reply.usage?.completion_tokens),
    costUsd: headerCost ?? count(reply.usage?.cost),
  };
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

/** A `Retry-After` header (seconds, or an HTTP date) in milliseconds; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

async function responseError(response: Response): Promise<LLMError> {
  const text = await response.text().catch(() => "");
  return new LLMError(responseErrorMessage(response.status, response.statusText, text), response.status, {
    retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
  });
}

/** Waits before the 1st and 2nd retry. Long on purpose: a busy GPU needs minutes, not milliseconds. */
export const RETRY_DELAYS_MS = [10_000, 30_000];
const MAX_RETRY_WAIT_MS = 60_000;

/** Statuses that mean "the server is busy": every call to the endpoint waits, not just this one. */
const BUSY_STATUSES = [429, 503];

/**
 * Whether a failure is worth another request. Never a refusal, never an
 * abort (the caller has gone) and never a timeout: a request that timed out,
 * here or at a gateway (504, Cloudflare's 524), may still be running on the
 * server, and a retry would only add to the load that made it slow.
 */
export function retryable(error: unknown): boolean {
  if ((error as LLMError)?.noRetry) return false;
  const status = (error as { status?: number })?.status;
  if (status && [400, 401, 403, 404, 408, 422, 504, 524].includes(status)) return false;
  return !(error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError"));
}

/** The wait before retry number `attempt` (1-based): the server's Retry-After, else the schedule; at most a minute. */
export function retryDelayMs(error: unknown, attempt: number): number {
  const planned = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
  return Math.min(MAX_RETRY_WAIT_MS, (error as LLMError)?.retryAfterMs ?? planned);
}

/** Resolves after `ms`; rejects with the signal's reason if it aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

// ── Endpoint gate ───────────────────────────────────────────────────────────
// A self-hosted GPU serves every app from one pool of request slots, and a
// request Carmenita gives up on keeps running there. So the whole process
// keeps at most MAX_IN_FLIGHT calls open per endpoint (every model behind one
// base URL shares the pool) and queues the rest; after a 429/503 every call
// to that endpoint holds back together instead of each worker retrying alone.

export const MAX_IN_FLIGHT = 4;

interface EndpointGate {
  active: number;
  waiting: Array<() => void>;
  /** Epoch ms before which no call to the endpoint starts (a busy server's cool-down). */
  notBefore: number;
}

const GATES = new Map<string, EndpointGate>();

function endpointKey(settings: LLMSettings): string {
  const preset = PROVIDERS[settings.provider] || PROVIDERS.custom;
  return cleanBase(settings.baseUrl || preset.baseUrl) || settings.provider;
}

function gateFor(key: string): EndpointGate {
  let gate = GATES.get(key);
  if (!gate) {
    gate = { active: 0, waiting: [], notBefore: 0 };
    GATES.set(key, gate);
  }
  return gate;
}

/** Calls open to an endpoint right now — for tests and diagnosis. */
export function callsInFlight(settings: LLMSettings): number {
  return GATES.get(endpointKey(settings))?.active ?? 0;
}

function holdEndpoint(key: string, ms: number): void {
  const gate = gateFor(key);
  gate.notBefore = Math.max(gate.notBefore, Date.now() + ms);
}

/** Wait for a free slot (and the end of any cool-down); returns the release. */
async function acquireSlot(key: string, signal?: AbortSignal): Promise<() => void> {
  const gate = gateFor(key);
  // Re-checked after every wake-up: a cool-down can start while waiting, and
  // a newcomer can take the slot that was freed.
  for (;;) {
    const coolDown = gate.notBefore - Date.now();
    if (coolDown > 0) {
      await sleep(coolDown, signal);
      continue;
    }
    if (gate.active < MAX_IN_FLIGHT) break;
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const stop = () => {
        gate.waiting = gate.waiting.filter((waiter) => waiter !== wake);
        reject(signal?.reason);
      };
      const wake = () => {
        signal?.removeEventListener("abort", stop);
        resolve();
      };
      gate.waiting.push(wake);
      signal?.addEventListener("abort", stop, { once: true });
    });
  }
  gate.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    gate.active -= 1;
    gate.waiting.shift()?.();
  };
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
  noThinkingParams?: boolean;
  noStreamUsage?: boolean;
}

const QUIRKS = new Map<string, ProviderQuirks>();

function quirkKey(settings: LLMSettings): string {
  return `${settings.provider}|${settings.baseUrl || ""}|${settings.model}`;
}

export function knownQuirks(settings: LLMSettings): ProviderQuirks | undefined {
  return QUIRKS.get(quirkKey(settings));
}

/** Forget every learned correction, and every endpoint's queue and cool-down — for tests. */
export function forgetQuirks(): void {
  QUIRKS.clear();
  GATES.clear();
}

function withKnownQuirks(settings: LLMSettings): LLMSettings {
  const learned = QUIRKS.get(quirkKey(settings));
  if (!learned) return settings;
  const next = { ...settings };
  if (learned.dropTemperature) next.temperature = null;
  if (learned.tokenParam) next.tokenParam = learned.tokenParam;
  if (learned.noThinkingParams) next.noThinkingParams = true;
  if (learned.noStreamUsage) next.noStreamUsage = true;
  // A learned ceiling only ever lowers the cap the call would send.
  const cap = effectiveMaxTokens(next);
  if (learned.maxTokens !== undefined && next.maxTokens !== null && cap) {
    next.maxTokens = learned.maxTokens == null ? null : Math.min(cap, learned.maxTokens);
  }
  return next;
}

function rememberQuirk(before: LLMSettings, after: LLMSettings): void {
  const key = quirkKey(before);
  const learned = QUIRKS.get(key) || {};
  if (before.temperature != null && after.temperature == null) learned.dropTemperature = true;
  if (after.tokenParam === "max_completion_tokens" && after.tokenParam !== before.tokenParam) learned.tokenParam = after.tokenParam;
  if (after.maxTokens !== before.maxTokens) learned.maxTokens = after.maxTokens ?? null;
  if (after.noThinkingParams && !before.noThinkingParams) learned.noThinkingParams = true;
  if (after.noStreamUsage && !before.noStreamUsage) learned.noStreamUsage = true;
  QUIRKS.set(key, learned);
}

/**
 * Drop a request field this transport adds on its own that the server
 * refused: `stream_options` (older OpenAI-compatible servers), then the
 * thinking switch (a server whose template has no `enable_thinking`, or no
 * `reasoning_effort`). The call goes on without it rather than die.
 */
export function adaptExtraParameters(settings: LLMSettings, error: unknown): LLMSettings | null {
  const message = String((error as Error)?.message || "");
  if (/stream_options|include_usage/i.test(message) && streams(settings) && !settings.noStreamUsage) {
    return { ...settings, noStreamUsage: true };
  }
  if (
    /chat_template_kwargs|enable_thinking|reasoning_effort/i.test(message) &&
    Object.keys(thinkingParams(settings)).length > 0
  ) {
    return { ...settings, noThinkingParams: true };
  }
  return null;
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
  // Every request sends a cap (the default when none was set), so a refused
  // default counts as configured.
  const configured = effectiveMaxTokens(settings);
  if (configured) {
    const stated = (message.match(/\d{2,7}/g) || []).map(Number).filter((n) => n > 0 && n < configured);
    if (stated.length) return { ...settings, maxTokens: Math.max(...stated) };
    if (settings.provider !== "anthropic") return { ...settings, maxTokens: null };
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

/**
 * One server-log line per finished call — provider, model, outcome, time —
 * so a failed or slow generation can be diagnosed from the service journal.
 * Never the key, the prompt or the reply.
 */
function logCall(settings: LLMSettings, latencyMs: number, error?: unknown, outcome?: { cut: boolean; usage: LLMUsage }): void {
  const lead = `${settings.provider} ${settings.model} ${latencyMs}ms`;
  if (error === undefined) {
    const out = outcome?.usage.outputTokens;
    const fields = { out: out ?? undefined, cap: effectiveMaxTokens(settings), cut: outcome?.cut ? true : undefined };
    logLine("llm", fields, "info", `${lead} ok`);
    return;
  }
  const status = (error as { status?: number })?.status;
  const message = String((error as Error)?.message ?? error).slice(0, 300);
  logLine("llm", { error: message }, "warn", `${lead} failed${status ? ` HTTP ${status}` : ""}`);
}

async function callOnce(
  settings: LLMSettings,
  systemPrompt: string,
  input: string | ChatTurn[],
  signal: AbortSignal,
  onActivity: () => void,
): Promise<{ output: string; usage: LLMUsage; cut: boolean }> {
  const request = buildProviderRequest(settings, systemPrompt, input);
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });
  if (!response.ok) throw await responseError(response);
  // Judged by what came back, not what was asked: a server that ignores
  // `stream: true` answers with plain JSON.
  const isStream = /text\/event-stream/i.test(response.headers.get("content-type") || "") && response.body;
  const json = isStream ? await readEventStream(response.body as ReadableStream<Uint8Array>, signal, onActivity) : await response.json();
  const output = readProviderReply(settings.provider, json);
  const cut = replyWasCut(settings.provider, json);
  if (cut && !output) {
    // The same request would spend the same budget the same way.
    throw new LLMError(
      `The reply reached its limit of ${effectiveMaxTokens(settings)} tokens before giving any answer (the model spent them reasoning). Pick a model without thinking, or ask for fewer questions per run.`,
      undefined,
      { noRetry: true },
    );
  }
  return { output, cut, usage: readProviderUsage(settings.provider, json, response.headers.get("x-litellm-response-cost")) };
}

/** Total time one request may take: non-streamed, and streamed (where the idle timeout does the real work). */
const REQUEST_TIMEOUT_MS = 180_000;
const STREAM_TIMEOUT_MS = 600_000;
/** A streamed reply that sends nothing for this long is given up. */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * One completion, through the endpoint gate, with retries for transient
 * failures (10 s, then 30 s, or the server's Retry-After) and self-correction
 * for parameter refusals (which do not spend the retry budget).
 */
export async function callLLM(
  settings: LLMSettings,
  systemPrompt: string,
  input: string | ChatTurn[],
  outerSignal?: AbortSignal,
): Promise<LLMResult> {
  const started = performance.now();
  const attempts = Math.max(1, (settings.retries ?? 2) + 1);
  const endpoint = endpointKey(settings);
  let current = withKnownQuirks(settings);
  let adaptations = 0;
  let lastError: unknown;
  // Retries and self-corrections are sequential by nature: each attempt
  // depends on how the previous one failed.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (outerSignal?.aborted) throw outerSignal.reason ?? new DOMException("Request aborted", "AbortError");
    const release = await acquireSlot(endpoint, outerSignal);
    const streamed = streams(current);
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, current.timeoutMs || (streamed ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS));
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
    const idleMs = Math.max(1000, current.idleTimeoutMs || STREAM_IDLE_TIMEOUT_MS);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      if (!streamed) return;
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(new DOMException(`Request timed out: the model sent nothing for ${Math.round(idleMs / 1000)} s`, "TimeoutError")),
        idleMs,
      );
    };
    const abort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener("abort", abort, { once: true });
    touch();
    try {
      const { output, usage, cut } = await callOnce(current, systemPrompt, input, controller.signal, touch);
      const latencyMs = Math.round(performance.now() - started);
      logCall(current, latencyMs, undefined, { cut, usage });
      return { output, latencyMs, usage };
    } catch (error) {
      lastError = error;
      if (!outerSignal?.aborted && adaptations < 3) {
        const adapted = adaptTokenParameter(current, error) ?? adaptTemperature(current, error) ?? adaptExtraParameters(current, error);
        if (adapted) {
          rememberQuirk(current, adapted);
          current = adapted;
          adaptations += 1;
          attempt -= 1;
          continue;
        }
      }
      if (outerSignal?.aborted || attempt === attempts || !retryable(error)) {
        logCall(current, Math.round(performance.now() - started), error);
        throw finalError(error);
      }
      const delay = retryDelayMs(error, attempt);
      if (BUSY_STATUSES.includes((error as { status?: number })?.status ?? 0)) holdEndpoint(endpoint, delay);
      // The slot is free while this call waits; the wait ends early if the caller leaves.
      release();
      await sleep(delay, outerSignal);
    } finally {
      clearTimeout(timeout);
      clearTimeout(idle);
      outerSignal?.removeEventListener("abort", abort);
      release();
    }
  }
  logCall(current, Math.round(performance.now() - started), lastError);
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
    { ...settings, retries: 0, maxTokens: OUTPUT_BUDGET.test, timeoutMs: Math.min(settings.timeoutMs ?? 45_000, 45_000) },
    "Reply with the single word OK.",
    "ping",
    signal,
  );
  return { ...reply, ok: reply.output.trim() !== "" };
}
