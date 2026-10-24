import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptExtraParameters,
  buildProviderRequest,
  callLLM,
  callsInFlight,
  DEFAULT_MAX_TOKENS,
  forgetQuirks,
  knownQuirks,
  LLMError,
  MAX_IN_FLIGHT,
  OUTPUT_BUDGET,
  parseRetryAfter,
  PROVIDERS,
  questionBudget,
  readEventStream,
  retryable,
  retryDelayMs,
  type LLMSettings,
} from "@/lib/ai/llm";
import { generateExplanation, generateTagging } from "@/lib/llm-enhance";
import { generateQuizQuestions } from "@/lib/llm-quiz";
import { generateQuestionsFromTopic } from "@/lib/llm-topic";
import { generateVariations } from "@/lib/llm-variations";
import type { ProviderConfig, Question } from "@/types";

/**
 * The transport's behaviour on a shared GPU server (Dynasite / filex), from
 * the server team's note of 2026-10-24: every request capped, thinking off,
 * at most MAX_IN_FLIGHT calls per endpoint, timeouts never retried, busy
 * servers waited out, long replies streamed with an idle timeout.
 */

const dynasite: LLMSettings = { provider: "custom", model: "qwen3.8-27b", apiKey: "sk-d", baseUrl: "https://api.dynasite.org/v1" };
const openai: LLMSettings = { provider: "openai", model: "gpt", apiKey: "k" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const ok = (content = "OK") => json(200, { choices: [{ message: { content }, finish_reason: "stop" }] });

const encoder = new TextEncoder();
/** An event-stream reply; `hang` leaves it open after the given events. */
const sse = (events: string[], hang = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((event) => controller.enqueue(encoder.encode(event)));
        if (!hang) controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
const event = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;
const delta = (content: string, finish: string | null = null) => event({ choices: [{ delta: { content }, finish_reason: finish }] });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetQuirks();
});

describe("output cap on every request", () => {
  it("sends DEFAULT_MAX_TOKENS from every provider when the caller set none", () => {
    const caps = Object.keys(PROVIDERS).map((provider) => {
      const body = buildProviderRequest({ ...openai, provider, baseUrl: "https://x.test/v1" }, "s", "u").body as {
        max_tokens?: number;
        generationConfig?: { maxOutputTokens?: number };
      };
      return body.max_tokens ?? body.generationConfig?.maxOutputTokens;
    });
    expect(caps).toEqual(Object.keys(PROVIDERS).map(() => DEFAULT_MAX_TOKENS));
  });

  it("sends the caller's budget, and none only when self-correction removed it", () => {
    expect(buildProviderRequest({ ...dynasite, maxTokens: 4000 }, "s", "u").body.max_tokens).toBe(4000);
    expect("max_tokens" in buildProviderRequest({ ...dynasite, maxTokens: null }, "s", "u").body).toBe(false);
  });

  it("sizes question budgets by count, within the server's ceiling", () => {
    const budgets = [1, 5, 10, 20, 50].map(questionBudget);
    expect(budgets).toEqual([2600, 5000, 8000, 14000, DEFAULT_MAX_TOKENS]);
    // Monotone: more questions never get a smaller budget.
    expect(budgets.every((b, i) => i === 0 || b >= budgets[i - 1])).toBe(true);
  });

  it("every LLM caller passes its own budget", async () => {
    const caps: number[] = [];
    const replies = [
      "[]", // document part
      "[]", // topic batch
      "[]", // variations
      '{"explanation": "Because."}',
      '{"subject": "S", "lesson": "L", "topic": "T", "tags": ["a", "b"]}',
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      caps.push(JSON.parse(String(init.body)).max_tokens);
      return ok(replies[caps.length - 1]);
    }));
    const provider: ProviderConfig = { id: "openai", providerType: "openai", displayName: "OpenAI", apiKey: "k", defaultModel: "gpt", isEnabled: true };
    const question: Question = {
      id: "q", type: "mcq-single", question: "Capital of France?", options: ["Berlin", "Paris"], correctAnswer: 1,
      explanation: "", difficulty: "easy", bloomLevel: "remember", subject: null, lesson: null, topic: "capitals", tags: [],
      sourcePassage: "", sourceType: "manual", sourceDocumentId: null, sourceLabel: null, setId: null,
      parentQuestionId: null, variationType: null, notes: null, createdAt: "2026-10-24T00:00:00Z", userId: null, setArchived: false,
    };
    // Only the requests matter here: the question generators refuse an empty
    // reply after sending, which is the parser's job and tested elsewhere.
    await expect(generateQuizQuestions({
      docText: "Photosynthesis turns light into chemical energy.",
      provider,
      settings: { questionCount: 3, allowedTypes: ["mcq-single"], immediateFeedback: true },
    })).rejects.toThrow(/failed for every part/);
    await expect(generateQuestionsFromTopic({ topic: "photosynthesis", count: 7, provider })).rejects.toThrow(/0 questions/);
    await expect(generateVariations({ original: question, variationType: "paraphrase", count: 2, provider })).rejects.toThrow(/0 questions/);
    await generateExplanation(question, provider);
    await generateTagging(question, provider);
    expect(caps).toEqual([questionBudget(3), questionBudget(7), questionBudget(2), OUTPUT_BUDGET.explanation, OUTPUT_BUDGET.tagging]);
  });
});

describe("thinking switch and streaming (self-hosted endpoints only)", () => {
  it("turns Qwen3's thinking off and streams with usage on Dynasite", () => {
    expect(buildProviderRequest(dynasite, "s", "u").body).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("asks gpt-oss for low reasoning effort, and leaves other models alone", () => {
    expect(buildProviderRequest({ ...dynasite, model: "gpt-oss-120b" }, "s", "u").body.reasoning_effort).toBe("low");
    const plain = buildProviderRequest({ ...dynasite, model: "llama-3.3-70b" }, "s", "u").body;
    expect(["chat_template_kwargs", "reasoning_effort"].some((k) => k in plain)).toBe(false);
  });

  it("keeps the cloud APIs' request shape: no thinking fields, no streaming", () => {
    const body = buildProviderRequest({ ...openai, provider: "groq", model: "qwen/qwen3-32b" }, "s", "u").body;
    expect(["chat_template_kwargs", "stream", "stream_options"].some((k) => k in body)).toBe(false);
  });

  it("drops a refused field and remembers it: stream_options first, then the thinking switch", () => {
    const noUsage = adaptExtraParameters(dynasite, new Error("Unrecognized request argument: stream_options"));
    expect(noUsage?.noStreamUsage).toBe(true);
    const noThinking = adaptExtraParameters(dynasite, new Error("extra_forbidden: chat_template_kwargs"));
    expect(noThinking?.noThinkingParams).toBe(true);
    expect(adaptExtraParameters({ ...dynasite, model: "llama" }, new Error("chat_template_kwargs"))).toBeNull();
    expect(adaptExtraParameters(dynasite, new Error("rate limited"))).toBeNull();
  });

  it("callLLM retries without a refused thinking switch, once per endpoint", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if ("chat_template_kwargs" in body) return json(400, { error: { message: "Unknown field chat_template_kwargs" } });
      return sse([delta("OK", "stop")]);
    }));
    expect((await callLLM({ ...dynasite, retries: 0 }, "s", "u")).output).toBe("OK");
    expect(knownQuirks(dynasite)?.noThinkingParams).toBe(true);
    await callLLM({ ...dynasite, retries: 0 }, "s", "u");
    expect(bodies.map((b) => "chat_template_kwargs" in b)).toEqual([true, false, false]);
  });
});

describe("readEventStream", () => {
  it("joins content split across chunks and lines, skips reasoning and keep-alives, keeps usage", async () => {
    const parts = [
      ": keep-alive\n\n",
      event({ choices: [{ delta: { reasoning_content: "thinking…" } }] }),
      'data: {"choices":[{"delta":{"content":"[{\\"a\\"',
      ':1}]"},"finish_reason":null}]}\r\n\r\n',
      delta("", "stop"),
      event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }),
      "data: [DONE]\n\n",
    ];
    const activity = vi.fn();
    const reply = await readEventStream(sse(parts).body as ReadableStream<Uint8Array>, new AbortController().signal, activity);
    expect(reply).toEqual({
      choices: [{ message: { content: '[{"a":1}]' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
    expect(activity).toHaveBeenCalledTimes(parts.length);
  });

  it("raises an error the server sends mid-stream, with its status", async () => {
    const stream = sse([delta("par"), event({ error: { message: "Engine overloaded", code: 503 } })]).body as ReadableStream<Uint8Array>;
    const error = await readEventStream(stream, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).status).toBe(503);
  });

  it("callLLM reads a streamed reply and its token counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sse([delta("Hel"), delta("lo", "stop"), event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } })])));
    const result = await callLLM(dynasite, "s", "u");
    expect(result.output).toBe("Hello");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, costUsd: null });
  });
});

describe("retries on a shared server", () => {
  it("never retries a timeout, a gateway timeout, or an abort", () => {
    expect(retryable(new DOMException("Request timed out", "TimeoutError"))).toBe(false);
    expect(retryable(new DOMException("gone", "AbortError"))).toBe(false);
    expect([504, 524].map((status) => retryable(new LLMError("x", status)))).toEqual([false, false]);
    expect([429, 500, 502, 503].map((status) => retryable(new LLMError("x", status)))).toEqual([true, true, true, true]);
  });

  it("waits 10 s, then 30 s, or what Retry-After says (at most a minute)", () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(new LLMError("x", 500), attempt))).toEqual([10_000, 30_000, 30_000]);
    expect(retryDelayMs(new LLMError("x", 429, { retryAfterMs: 5_000 }), 1)).toBe(5_000);
    expect(retryDelayMs(new LLMError("x", 429, { retryAfterMs: 600_000 }), 1)).toBe(60_000);
  });

  it("reads Retry-After as seconds or an HTTP date", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(parseRetryAfter("7", now)).toBe(7_000);
    expect(parseRetryAfter("Sat, 24 Oct 2026 12:00:20 GMT", now)).toBe(20_000);
    expect([null, "", "soon"].map((v) => parseRetryAfter(v, now))).toEqual([undefined, undefined, undefined]);
  });

  it("a stream that goes quiet is given up after the idle timeout, and not retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchMock = vi.fn(async () => sse([delta("[")], true));
    vi.stubGlobal("fetch", fetchMock);
    const result = callLLM({ ...dynasite, retries: 2 }, "s", "u").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = (await result) as LLMError;
    expect(error.message).toMatch(/timed out: the model sent nothing for 60 s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(callsInFlight(dynasite)).toBe(0);
  });

  it("a reply cut off before any answer fails at once with the reason", async () => {
    const fetchMock = vi.fn(async () => sse([event({ choices: [{ delta: { reasoning_content: "hmm" } }] }), delta("", "length")]));
    vi.stubGlobal("fetch", fetchMock);
    const error = (await callLLM({ ...dynasite, maxTokens: 4000, retries: 2 }, "s", "u").catch((e: unknown) => e)) as LLMError;
    expect(error.message).toMatch(/reached its limit of 4000 tokens before giving any answer/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("after a 429, every call to that endpoint waits out Retry-After, not just the one refused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const started: number[] = [];
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      started.push(Date.now());
      if (first) {
        first = false;
        return json(429, { error: { message: "Too many requests" } }, { "Retry-After": "20" });
      }
      return ok();
    }));
    const t0 = Date.now();
    const refused = callLLM({ ...openai, retries: 1 }, "s", "u");
    await vi.advanceTimersByTimeAsync(1_000);
    const later = callLLM({ ...openai, retries: 0 }, "s", "u");
    await vi.advanceTimersByTimeAsync(19_000);
    expect((await refused).output).toBe("OK");
    expect((await later).output).toBe("OK");
    // Both the retry and the newcomer started only once the 20 s were up.
    expect(started.map((t) => t - t0)).toEqual([0, 20_000, 20_000]);
  });
});

describe("endpoint gate", () => {
  /** A fetch that holds every request open until `releaseAll()`. */
  function heldFetch() {
    const held: Array<() => void> = [];
    let open = 0;
    let peak = 0;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      open += 1;
      peak = Math.max(peak, open);
      await new Promise<void>((resolve) => held.push(resolve));
      open -= 1;
      return ok();
    }));
    return {
      held,
      urls,
      peak: () => peak,
      releaseAll: () => held.splice(0).forEach((resolve) => resolve()),
    };
  }

  it(`keeps at most ${MAX_IN_FLIGHT} calls open per endpoint and queues the rest`, async () => {
    const server = heldFetch();
    let settled = false;
    const all = Promise.all(Array.from({ length: 10 }, () => callLLM(dynasite, "s", "u"))).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(server.held).toHaveLength(MAX_IN_FLIGHT));
    expect(callsInFlight(dynasite)).toBe(MAX_IN_FLIGHT);
    // Drain: each released batch lets the next queued calls start.
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      server.releaseAll();
    }
    expect(await all).toHaveLength(10);
    expect(server.peak()).toBe(MAX_IN_FLIGHT);
    expect(callsInFlight(dynasite)).toBe(0);
  });

  it("gives each endpoint its own slots: a busy Dynasite does not hold up OpenAI", async () => {
    const server = heldFetch();
    const queued = Array.from({ length: MAX_IN_FLIGHT + 1 }, () => callLLM(dynasite, "s", "u"));
    const other = callLLM(openai, "s", "u");
    await vi.waitFor(() => expect(server.held).toHaveLength(MAX_IN_FLIGHT + 1));
    expect(server.urls.filter((u) => u.startsWith("https://api.openai.com"))).toHaveLength(1);
    while (callsInFlight(dynasite) + callsInFlight(openai) > 0) {
      server.releaseAll();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await Promise.all([...queued, other])).toHaveLength(MAX_IN_FLIGHT + 2);
  });

  it("a queued call whose caller leaves gives up its place without taking a slot", async () => {
    const server = heldFetch();
    const running = Array.from({ length: MAX_IN_FLIGHT }, () => callLLM(dynasite, "s", "u"));
    const leaving = new AbortController();
    const queued = callLLM(dynasite, "s", "u", leaving.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(server.held).toHaveLength(MAX_IN_FLIGHT));
    leaving.abort(new DOMException("client gone", "AbortError"));
    expect(((await queued) as DOMException).name).toBe("AbortError");
    server.releaseAll();
    await Promise.all(running);
    expect(server.urls).toHaveLength(MAX_IN_FLIGHT);
    expect(callsInFlight(dynasite)).toBe(0);
  });
});
