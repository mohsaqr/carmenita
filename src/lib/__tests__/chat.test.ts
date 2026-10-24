import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { buildProviderRequest, callLLM, forgetQuirks, readProviderUsage, type LLMSettings } from "@/lib/ai/llm";
import { chatTotals, formatCost, formatUsage } from "@/lib/chat-format";
import { PROMPTS } from "@/lib/prompts";
import { serializeMarkdown } from "@/lib/formats/markdown";
import type { ProviderConfig } from "@/types";

/**
 * The chatbot: multi-turn transport + usage, the pure helpers, and the
 * /api/chat + /api/chats routes end to end on a real migrated DB. The
 * provider is a stubbed `fetch` that records what was sent.
 */

const ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-chat-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(ROOT, "src/db/migrations") });

// Everything that reaches `@/db/client` is imported dynamically, AFTER the
// test DB is parked on globalThis: a static import is hoisted above this
// setup and would open the developer's ./carmenita.db instead.
const auth = await import("@/lib/auth");
const { buildChatSystemPrompt, chatTitle, HINT_RULE } = await import("@/lib/chat");
const chatRoute = await import("@/app/api/chat/route");
const chatsRoute = await import("@/app/api/chats/route");
const oneChatRoute = await import("@/app/api/chats/[id]/route");
const importRoute = await import("@/app/api/bank/import/route");
const questionRoute = await import("@/app/api/bank/questions/[id]/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetQuirks();
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const settings: LLMSettings = { provider: "openai", model: "m", apiKey: "k", retries: 0 };

// ── Transport ───────────────────────────────────────────────────────────────

describe("multi-turn requests", () => {
  const turns = [
    { role: "user" as const, content: "hi" },
    { role: "assistant" as const, content: "hello" },
    { role: "user" as const, content: "why?" },
  ];

  it("OpenAI-style: system first, then the turns in order", () => {
    const { body } = buildProviderRequest(settings, "SYS", turns);
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, ...turns]);
  });

  it("Anthropic: system separate, turns as messages", () => {
    const { body } = buildProviderRequest({ ...settings, provider: "anthropic" }, "SYS", turns);
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual(turns);
  });

  it("Gemini: the assistant is called 'model'", () => {
    const { body } = buildProviderRequest({ ...settings, provider: "google" }, "SYS", turns);
    expect((body.contents as Array<{ role: string }>).map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("a single string is still one user message (every other caller)", () => {
    const { body } = buildProviderRequest(settings, "SYS", "only");
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "only" }]);
  });
});

describe("usage from the provider's reply", () => {
  it("reads each provider's token fields", () => {
    expect(readProviderUsage("openai", { usage: { prompt_tokens: 12, completion_tokens: 3 } })).toEqual({
      inputTokens: 12, outputTokens: 3, costUsd: null,
    });
    expect(readProviderUsage("anthropic", { usage: { input_tokens: 40, output_tokens: 9 } })).toEqual({
      inputTokens: 40, outputTokens: 9, costUsd: null,
    });
    expect(readProviderUsage("google", { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } })).toEqual({
      inputTokens: 7, outputTokens: 2, costUsd: null,
    });
  });

  it("takes a price only from the provider: LiteLLM's header, else OpenRouter's usage.cost", () => {
    expect(readProviderUsage("custom", { usage: { prompt_tokens: 1, completion_tokens: 1 } }, "0.000123").costUsd).toBe(0.000123);
    expect(readProviderUsage("openrouter", { usage: { cost: 0.002 } }).costUsd).toBe(0.002);
    expect(readProviderUsage("custom", {}, "")).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
    expect(readProviderUsage("custom", {}, "not-a-number").costUsd).toBeNull();
  });

  it("callLLM returns the usage with the text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json(200, { choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }, { "x-litellm-response-cost": "0.0001" }),
    ));
    const result = await callLLM(settings, "s", "u");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 1, costUsd: 0.0001 });
  });
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("chat helpers", () => {
  const q = {
    id: "q1",
    question: "Which organelle makes ATP?",
    options: ["Nucleus", "Mitochondrion", "Ribosome"],
    correctAnswer: 1,
    explanation: "Oxidative phosphorylation.",
    topic: "cell energy",
  };
  const templates = {
    general: PROMPTS["carmenita.chat.general"].defaultValue,
    question: PROMPTS["carmenita.chat.question"].defaultValue,
  };

  it("fills the question prompt with the question, lettered options and the answer", () => {
    const prompt = buildChatSystemPrompt(q, templates);
    expect(prompt).toContain("Which organelle makes ATP?");
    expect(prompt).toContain("B. Mitochondrion");
    expect(prompt).toContain('Option B ("Mitochondrion")');
    expect(prompt).toContain("Oxidative phosphorylation.");
    expect(prompt).not.toMatch(/\{(question|optionsList|correctAnswer|explanation|topic)\}/);
  });

  it("hint mode appends the no-answer rule; without a question there is nothing to hide", () => {
    expect(buildChatSystemPrompt(q, templates, { hint: true }).endsWith(HINT_RULE)).toBe(true);
    expect(buildChatSystemPrompt(q, templates)).not.toContain("HINT MODE");
    expect(buildChatSystemPrompt(null, templates, { hint: true })).toBe(templates.general);
  });

  it("uses the general prompt with no question", () => {
    expect(buildChatSystemPrompt(null, templates)).toBe(templates.general);
  });

  it("titles a chat from its first message, cut at a word", () => {
    expect(chatTitle("  short   question ")).toBe("short question");
    expect(chatTitle("")).toBe("New chat");
    const long = chatTitle("Explain the difference between mitosis and meiosis in plain words with an example please");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it("sums usage over replies; cost only when every reply was priced", () => {
    const priced = [
      { role: "user" },
      { role: "assistant", inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
      { role: "assistant", inputTokens: 20, outputTokens: 3, costUsd: 0.002 },
    ];
    const totals = chatTotals(priced);
    expect(totals.inputTokens).toBe(30);
    expect(totals.outputTokens).toBe(5);
    expect(totals.costUsd).toBeCloseTo(0.003, 12);
    expect(chatTotals([...priced, { role: "assistant", inputTokens: 1, outputTokens: 1, costUsd: null }]).costUsd).toBeNull();
    expect(chatTotals([{ role: "user" }])).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: null });
  });

  it("formats usage and cost", () => {
    expect(formatUsage({ inputTokens: 1234, outputTokens: 210, costUsd: 0.0012 })).toBe("1,234 in · 210 out · $0.0012");
    expect(formatUsage({ inputTokens: null, outputTokens: null, costUsd: null })).toBe("");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.25)).toBe("$0.250");
    expect(formatCost(3.5)).toBe("$3.50");
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

const alice = auth.upsertUser("ChatAlice", "alice-pass-1");
const bob = auth.upsertUser("ChatBob", "bob-pass-12");
const aliceToken = auth.createSession(alice.id).token;
const bobToken = auth.createSession(bob.id).token;

function req(url: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `${auth.SESSION_COOKIE}=${token}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function call(res: Promise<Response> | Response) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

const provider: ProviderConfig = {
  id: "custom",
  providerType: "custom",
  displayName: "Fake",
  apiKey: "k",
  baseUrl: "https://llm.test/v1",
  defaultModel: "fake-model",
  isEnabled: true,
};

/** A provider that answers "reply N" and records every request body. */
function fakeProvider() {
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return json(
      200,
      { choices: [{ message: { content: `reply ${sent.length}` } }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      { "x-litellm-response-cost": "0.0005" },
    );
  }));
  return sent;
}

const imported = await call(
  importRoute.POST(req("/api/bank/import", aliceToken, {
    method: "POST",
    body: {
      format: "markdown",
      setName: "Chat set",
      text: serializeMarkdown([{
        type: "mcq-single", question: "What does ATP stand for?", options: ["Adenosine triphosphate", "Amino tri-peptide"],
        correctAnswer: 0, explanation: "Three phosphates.", difficulty: "easy", bloomLevel: "remember",
        subject: null, lesson: null, topic: "atp", tags: ["energy", "cells"], sourcePassage: "",
      }]),
    },
  })),
);
const aliceQuestionId: string = imported.body.ids[0];

describe("POST /api/chat", () => {
  it("a temporary chat stores nothing and sends the browser's history", async () => {
    const sent = fakeProvider();
    const res = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST",
      body: { provider, message: "and then?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] },
    })));
    expect(res.status).toBe(200);
    expect(res.body.chatId).toBeNull();
    expect(res.body.reply).toMatchObject({
      role: "assistant", content: "reply 1", model: "fake-model", inputTokens: 100, outputTokens: 20, costUsd: 0.0005,
    });
    expect(sent[0].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect((await call(chatsRoute.GET(req("/api/chats", aliceToken)))).body.chats).toEqual([]);
  });

  it("a saved chat about a question: prompt carries the question, history comes from the DB", async () => {
    const sent = fakeProvider();
    const first = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST",
      body: { provider, message: "Why is A right?", questionId: aliceQuestionId, save: true },
    })));
    expect(first.status).toBe(200);
    const chatId: string = first.body.chatId;
    expect(chatId).toBeTruthy();
    expect(sent[0].messages[0].content).toContain("What does ATP stand for?");

    // A forged history is ignored for a saved chat.
    const second = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST",
      body: { provider, message: "And B?", chatId, history: [{ role: "user", content: "FORGED" }] },
    })));
    expect(second.status).toBe(200);
    expect(sent[1].messages.map((m) => m.content).slice(1)).toEqual(["Why is A right?", "reply 1", "And B?"]);

    const list = (await call(chatsRoute.GET(req("/api/chats", aliceToken)))).body.chats;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: chatId, title: "Why is A right?", questionId: aliceQuestionId, messageCount: 4, inputTokens: 200, outputTokens: 40 });
    expect(list[0].costUsd).toBeCloseTo(0.001, 12);
  });

  it("a provider failure is a 502 with its message, and nothing is stored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { error: { message: "bad model" } })));
    const before = (await call(chatsRoute.GET(req("/api/chats", aliceToken)))).body.chats.length;
    const res = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST", body: { provider, message: "hi", save: true },
    })));
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/bad model/);
    expect((await call(chatsRoute.GET(req("/api/chats", aliceToken)))).body.chats).toHaveLength(before);
  });

  it("hint: true puts the no-answer rule in the system prompt sent to the model", async () => {
    const sent = fakeProvider();
    const again = await call(importRoute.POST(req("/api/bank/import", aliceToken, {
      method: "POST",
      body: { format: "markdown", setName: "Hint set", text: serializeMarkdown([{
        type: "mcq-single", question: "Hint me?", options: ["a", "b"], correctAnswer: 0, explanation: "", difficulty: "easy",
        bloomLevel: "remember", subject: null, lesson: null, topic: "hint", tags: ["x", "y"], sourcePassage: "",
      }]) },
    })));
    const res = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST", body: { provider, message: "help", questionId: again.body.ids[0], hint: true },
    })));
    expect(res.status).toBe(200);
    expect(sent[0].messages[0].content).toContain("Hint me?");
    expect(sent[0].messages[0].content).toContain("HINT MODE");
  });

  it("rejects an empty message", async () => {
    const res = await call(chatRoute.POST(req("/api/chat", aliceToken, { method: "POST", body: { provider, message: "   " } })));
    expect(res.status).toBe(400);
  });
});

describe("saving, renaming, deleting", () => {
  it("saves a temporary chat as it stands, renames and deletes it", async () => {
    const saved = await call(chatsRoute.POST(req("/api/chats", aliceToken, {
      method: "POST",
      body: { messages: [
        { role: "user", content: "hi", createdAt: "2026-10-24T00:00:00Z" },
        { role: "assistant", content: "hello", createdAt: "2026-10-24T00:00:01Z", model: "m", inputTokens: 3, outputTokens: 1, costUsd: null },
      ] },
    })));
    expect(saved.status).toBe(201);
    const id: string = saved.body.chat.id;
    expect(saved.body.chat.title).toBe("hi");

    const renamed = await call(oneChatRoute.PATCH(req(`/api/chats/${id}`, aliceToken, { method: "PATCH", body: { title: "Greeting" } }), params(id)));
    expect(renamed.body.chat.title).toBe("Greeting");
    const got = await call(oneChatRoute.GET(req(`/api/chats/${id}`, aliceToken), params(id)));
    expect(got.body.chat.messages).toHaveLength(2);

    expect((await call(oneChatRoute.DELETE(req(`/api/chats/${id}`, aliceToken, { method: "DELETE" }), params(id)))).status).toBe(200);
    expect((await call(oneChatRoute.GET(req(`/api/chats/${id}`, aliceToken), params(id)))).status).toBe(404);
  });

  it("deleting the question keeps the chat, detached", async () => {
    fakeProvider();
    const { body } = await call(chatRoute.POST(req("/api/chat", aliceToken, {
      method: "POST", body: { provider, message: "about to vanish", questionId: aliceQuestionId, save: true },
    })));
    await questionRoute.DELETE(req(`/api/bank/questions/${aliceQuestionId}`, aliceToken, { method: "DELETE" }), params(aliceQuestionId));
    const got = await call(oneChatRoute.GET(req(`/api/chats/${body.chatId}`, aliceToken), params(body.chatId)));
    expect(got.status).toBe(200);
    expect(got.body.chat.questionId).toBeNull();
  });
});

describe("Bob cannot reach Alice's chats or questions", () => {
  it("every foreign id behaves like a missing one", async () => {
    const sent = fakeProvider();
    const aliceChat = (await call(chatsRoute.GET(req("/api/chats", aliceToken)))).body.chats[0];
    expect(aliceChat).toBeTruthy();
    const id: string = aliceChat.id;

    expect((await call(chatsRoute.GET(req("/api/chats", bobToken)))).body.chats).toEqual([]);
    expect((await call(oneChatRoute.GET(req(`/api/chats/${id}`, bobToken), params(id)))).status).toBe(404);
    expect((await call(oneChatRoute.PATCH(req(`/api/chats/${id}`, bobToken, { method: "PATCH", body: { title: "x" } }), params(id)))).status).toBe(404);
    expect((await call(oneChatRoute.DELETE(req(`/api/chats/${id}`, bobToken, { method: "DELETE" }), params(id)))).status).toBe(404);
    expect((await call(chatRoute.POST(req("/api/chat", bobToken, { method: "POST", body: { provider, message: "hi", chatId: id } })))).status).toBe(404);

    // Alice's question (a fresh one: the first was deleted above).
    const again = await call(importRoute.POST(req("/api/bank/import", aliceToken, {
      method: "POST",
      body: { format: "markdown", setName: "Chat set 2", text: serializeMarkdown([{
        type: "mcq-single", question: "Secret?", options: ["a", "b"], correctAnswer: 0, explanation: "", difficulty: "easy",
        bloomLevel: "remember", subject: null, lesson: null, topic: "secret", tags: ["x", "y"], sourcePassage: "",
      }]) },
    })));
    const qid: string = again.body.ids[0];
    expect((await call(chatRoute.POST(req("/api/chat", bobToken, { method: "POST", body: { provider, message: "hi", questionId: qid } })))).status).toBe(404);
    expect((await call(chatsRoute.POST(req("/api/chats", bobToken, {
      method: "POST", body: { questionId: qid, messages: [{ role: "user", content: "hi", createdAt: "x" }] },
    })))).status).toBe(404);
    expect((await call(questionRoute.GET(req(`/api/bank/questions/${qid}`, bobToken), params(qid)))).status).toBe(404);
    expect((await call(questionRoute.GET(req(`/api/bank/questions/${qid}`, aliceToken), params(qid)))).status).toBe(200);
    // None of Bob's refused requests reached the model.
    expect(sent).toHaveLength(0);

  });

  it("signed out is 401", async () => {
    expect((await chatRoute.POST(req("/api/chat", null, { method: "POST", body: { provider, message: "hi" } }))).status).toBe(401);
    expect((await chatsRoute.GET(req("/api/chats", null))).status).toBe(401);
  });
});
