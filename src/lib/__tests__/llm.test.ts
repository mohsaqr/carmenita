import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptTemperature,
  adaptTokenParameter,
  buildProviderRequest,
  callLLM,
  forgetQuirks,
  knownQuirks,
  listModels,
  readProviderReply,
  settingsFromProvider,
  splitThinkTags,
  type LLMSettings,
} from "@/lib/ai/llm";
import { replaceRetiredModels } from "@/lib/store";
import type { ProviderConfig, SupportedProvider } from "@/types";

const config = (providerType: SupportedProvider, extras: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: providerType,
  providerType,
  displayName: providerType,
  apiKey: "key",
  defaultModel: "m",
  isEnabled: true,
  ...extras,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  forgetQuirks();
});

describe("settingsFromProvider", () => {
  it("never sends temperature to Anthropic, keeps it elsewhere", () => {
    expect(settingsFromProvider(config("anthropic"), { temperature: 0.3 }).temperature).toBeNull();
    expect(settingsFromProvider(config("openai"), { temperature: 0.3 }).temperature).toBe(0.3);
  });

  it("expands a bare Azure resource name to its endpoint", () => {
    expect(settingsFromProvider(config("azure", { baseUrl: "myres" })).baseUrl).toBe("https://myres.openai.azure.com");
    expect(settingsFromProvider(config("azure", { baseUrl: "https://x.example" })).baseUrl).toBe("https://x.example");
  });
});

describe("buildProviderRequest", () => {
  const base: LLMSettings = { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "k" };

  it("builds the Anthropic Messages request with a required max_tokens", () => {
    const req = buildProviderRequest(base, "sys", "hi");
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("k");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.body).toEqual({
      model: "claude-sonnet-5-5",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16000,
    });
  });

  it("builds OpenAI-compatible, Gemini and Azure shapes", () => {
    const openai = buildProviderRequest({ ...base, provider: "openai", model: "gpt", temperature: 0.2 }, "sys", "hi");
    expect(openai.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(openai.body).toEqual({
      model: "gpt",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      temperature: 0.2,
    });
    const google = buildProviderRequest({ ...base, provider: "google", model: "gemini-2.5-flash" }, "sys", "hi");
    expect(google.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    const azure = buildProviderRequest({ ...base, provider: "azure", model: "dep", baseUrl: "https://r.openai.azure.com" }, "sys", "hi");
    expect(azure.url).toBe("https://r.openai.azure.com/openai/deployments/dep/chat/completions?api-version=2024-10-21");
  });

  it("refuses a missing base URL or model", () => {
    expect(() => buildProviderRequest({ ...base, provider: "custom" }, "s", "u")).toThrow(/base URL/);
    expect(() => buildProviderRequest({ ...base, model: " " }, "s", "u")).toThrow(/model ID/);
  });
});

describe("readProviderReply", () => {
  it("reads each provider's text and drops inline thinking", () => {
    expect(readProviderReply("anthropic", { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "[1]" }] })).toBe("[1]");
    expect(readProviderReply("google", { candidates: [{ content: { parts: [{ text: "t", thought: true }, { text: "[2]" }] } }] })).toBe("[2]");
    expect(readProviderReply("ollama", { choices: [{ message: { content: "<think>hmm</think>\n[3]" } }] })).toBe("[3]");
    expect(() => readProviderReply("openai", { choices: [] })).toThrow(/did not contain text/);
  });

  it("treats an unclosed think block as all thinking", () => {
    expect(splitThinkTags("[1] <think>cut off")).toBe("[1]");
  });
});

describe("self-correction", () => {
  const settings: LLMSettings = { provider: "openai", model: "o3", apiKey: "k", temperature: 0.3, maxTokens: 50000 };

  it("drops a refused temperature, only when one was sent", () => {
    const error = new Error("Unsupported value: 'temperature' does not support 0.3 with this model.");
    expect(adaptTemperature(settings, error)?.temperature).toBeNull();
    expect(adaptTemperature({ ...settings, temperature: null }, error)).toBeNull();
    expect(adaptTemperature(settings, new Error("rate limited"))).toBeNull();
  });

  it("renames, then clamps the output cap from the provider's own words", () => {
    const renamed = adaptTokenParameter(settings, new Error("Use 'max_completion_tokens' instead of 'max_tokens'."));
    expect(renamed?.tokenParam).toBe("max_completion_tokens");
    const anthropic: LLMSettings = { provider: "anthropic", model: "c", apiKey: "k" };
    const clamped = adaptTokenParameter(anthropic, new Error("max_tokens: 16000 > 8192, which is the maximum allowed"));
    expect(clamped?.maxTokens).toBe(8192);
  });

  it("callLLM retries a refused parameter without spending retries, and remembers it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if ("temperature" in body) return json(400, { error: { message: "temperature is not supported with this model" } });
      return json(200, { choices: [{ message: { content: "OK" } }] });
    }));
    const result = await callLLM({ ...settings, retries: 0 }, "s", "u");
    expect(result.output).toBe("OK");
    expect(bodies).toHaveLength(2);
    expect(knownQuirks(settings)?.dropTemperature).toBe(true);
    // The next call starts from what was learned: one request, no temperature.
    await callLLM({ ...settings, retries: 0 }, "s", "u");
    expect(bodies).toHaveLength(3);
    expect("temperature" in bodies[2]).toBe(false);
  });

  it("surfaces an auth failure with its status, without retrying", async () => {
    const fetchMock = vi.fn(async () => json(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await callLLM({ ...settings, retries: 2 }, "s", "u").catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "LLMError", status: 401 });
    // The routes classify auth failures by this prefix.
    expect(String((error as Error).message)).toMatch(/^HTTP 401: invalid x-api-key — check the API key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: { message: "overloaded" } }))
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await callLLM({ ...settings, retries: 1 }, "s", "u")).output).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("listModels", () => {
  it("strips Google's models/ prefix and de-duplicates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { models: [{ name: "models/b" }, { name: "models/a" }, { name: "models/a" }] })));
    expect(await listModels({ provider: "google", model: "", apiKey: "k" })).toEqual(["a", "b"]);
  });

  it("refuses Azure, which has no listing", async () => {
    await expect(listModels({ provider: "azure", model: "", apiKey: "k", baseUrl: "https://r" })).rejects.toThrow(/portal/);
  });
});

describe("replaceRetiredModels", () => {
  it("moves a saved retired Claude id to the current default", () => {
    const out = replaceRetiredModels({ anthropic: config("anthropic", { defaultModel: "claude-3-5-sonnet-20241022" }) });
    expect(out.anthropic.defaultModel).toBe("claude-sonnet-5-5");
  });

  it("leaves a model the user chose untouched", () => {
    const providers = { anthropic: config("anthropic", { defaultModel: "claude-haiku-5-5" }) };
    expect(replaceRetiredModels(providers)).toEqual(providers);
  });
});
