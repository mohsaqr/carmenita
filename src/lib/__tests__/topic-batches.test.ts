import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { batchSizes, TOPIC_BATCH_SIZE } from "@/lib/topic-batches";
import { buildTopicPrompt } from "@/lib/llm-topic";

/**
 * Topic runs larger than one batch: the split, the "already asked" prompt
 * block, and the real route creating a quiz then appending to it — with
 * the provider's HTTP endpoint stubbed (the only fake; DB and route are real).
 */

const ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-topic-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(ROOT, "src/db/migrations") });

const auth = await import("@/lib/auth");
const topicRoute = await import("@/app/api/generate-from-topic/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("batchSizes", () => {
  it("splits into batches of at most 20, largest first", () => {
    expect(TOPIC_BATCH_SIZE).toBe(20);
    expect(batchSizes(45)).toEqual([20, 20, 5]);
    expect(batchSizes(40)).toEqual([20, 20]);
    expect(batchSizes(20)).toEqual([20]);
    expect(batchSizes(7)).toEqual([7]);
  });

  it("is empty for nothing to generate", () => {
    expect(batchSizes(0)).toEqual([]);
    expect(batchSizes(-3)).toEqual([]);
    expect(batchSizes(Number.NaN)).toEqual([]);
  });

  it("always sums to the total and never exceeds the batch size", () => {
    const totals = Array.from({ length: 50 }, (_, i) => i + 1);
    const ok = totals.every((n) => {
      const sizes = batchSizes(n);
      return sizes.reduce((a, b) => a + b, 0) === n && sizes.every((s) => s >= 1 && s <= TOPIC_BATCH_SIZE);
    });
    expect(ok).toBe(true);
  });
});

describe("buildTopicPrompt avoid", () => {
  const args = { topic: "SSRIs", count: 20, allowedTypes: ["mcq-single" as const] };

  it("adds no block on the first batch", () => {
    expect(buildTopicPrompt(args)).not.toContain("ALREADY ASKED");
  });

  it("lists earlier questions, capped to the most recent 60", () => {
    const avoid = Array.from({ length: 70 }, (_, i) => `Earlier question ${i}?`);
    const prompt = buildTopicPrompt({ ...args, avoid });
    expect(prompt).toContain("ALREADY ASKED");
    expect(prompt).toContain("- Earlier question 69?");
    expect(prompt).toContain("- Earlier question 10?");
    expect(prompt).not.toContain("- Earlier question 9?");
  });
});

describe("POST /api/generate-from-topic in batches", () => {
  const alice = auth.upsertUser("Alice", "alice-pass-1");
  const bob = auth.upsertUser("Bob", "bob-pass-12");
  const aliceToken = auth.createSession(alice.id).token;
  const bobToken = auth.createSession(bob.id).token;

  const provider = {
    id: "anthropic", providerType: "anthropic" as const, displayName: "Anthropic",
    apiKey: "k", defaultModel: "claude-sonnet-5-5", isEnabled: true,
  };
  const body = {
    topic: "SSRIs", title: "SSRIs",
    settings: { questionCount: 25, allowedTypes: ["mcq-single"], immediateFeedback: true },
    provider,
  };
  const question = (stem: string) => ({
    type: "mcq-single", question: stem, options: ["A", "B", "C", "D"], correctAnswer: 0,
    explanation: "Because A.", difficulty: "medium", bloomLevel: "remember",
    topic: "ssris", tags: ["ssri", "pharmacology"], sourcePassage: "SSRIs block reuptake.",
  });

  /** A fake Anthropic endpoint: answers with `n` questions, records each prompt. */
  function stubClaude(prompts: string[]) {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body));
      prompts.push(sent.system);
      const n = Number(/Generate exactly (\d+) questions/.exec(sent.system)?.[1] ?? 1);
      call += 1;
      const stems = Array.from({ length: n }, (_, i) => `Batch ${call} question ${i + 1}?`);
      const text = JSON.stringify(stems.map(question));
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
    }));
  }

  const post = (token: string, extra: Record<string, unknown>) =>
    topicRoute.POST(new NextRequest("http://localhost/api/generate-from-topic", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${auth.SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ ...body, ...extra }),
    }));

  it("creates the quiz on batch 1 and appends batch 2 in order, telling it what was asked", async () => {
    const prompts: string[] = [];
    stubClaude(prompts);

    const first = await (await post(aliceToken, { batchCount: 20 })).json();
    expect(first.questionCount).toBe(20);
    expect(first.questions).toHaveLength(first.questionCount);

    const second = await post(aliceToken, { batchCount: 5, appendToQuizId: first.quizId, avoid: first.questions });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.quizId).toBe(first.quizId);
    expect(secondBody.questionCount).toBe(5);

    expect(prompts[0]).not.toContain("ALREADY ASKED");
    expect(prompts[1]).toContain("ALREADY ASKED");
    expect(prompts[1]).toContain(first.questions[0]);

    const rows = sqlite
      .prepare(`SELECT qq.idx, q.question, q.user_id FROM quiz_questions qq JOIN questions q ON q.id = qq.question_id
                WHERE qq.quiz_id = ? ORDER BY qq.idx`)
      .all(first.quizId) as Array<{ idx: number; question: string; user_id: string }>;
    const total = first.questionCount + secondBody.questionCount;
    expect(rows).toHaveLength(total);
    // idx runs 0..total-1 with no gap or collision, batch 1 before batch 2.
    expect(rows.map((r) => r.idx)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(rows[0].question).toMatch(/^Batch 1 /);
    expect(rows[total - 1].question).toMatch(/^Batch 2 /);
    expect(rows.every((r) => r.user_id === alice.id)).toBe(true);
    // One quiz, not two.
    expect(sqlite.prepare("SELECT count(*) n FROM quizzes WHERE user_id = ?").get(alice.id)).toEqual({ n: 1 });
  });

  it("will not append to another user's quiz", async () => {
    stubClaude([]);
    const mine = await (await post(aliceToken, { batchCount: 3 })).json();
    const res = await post(bobToken, { batchCount: 3, appendToQuizId: mine.quizId });
    expect(res.status).toBe(404);
    const count = sqlite.prepare("SELECT count(*) n FROM quiz_questions WHERE quiz_id = ?").get(mine.quizId);
    expect(count).toEqual({ n: mine.questionCount });
  });
});
