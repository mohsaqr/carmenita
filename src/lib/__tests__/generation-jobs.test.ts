import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

/**
 * Document → quiz as a background job (the fix for Cloudflare's ~100 s
 * request limit, HTTP 524): chunk LLM calls run in parallel, the route
 * answers 202 { jobId } at once, the job saves the quiz, the poller
 * follows it to the end. Real DB and routes; only the provider's HTTP
 * endpoint is stubbed.
 */

const ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-jobs-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(ROOT, "src/db/migrations") });

const auth = await import("@/lib/auth");
const { generateQuizQuestions, mapWithConcurrency, planGeneration } = await import("@/lib/llm-quiz");
const jobs = await import("@/lib/generation-jobs");
const { pollGenerationJob, readJson } = await import("@/lib/generation-poll");
const generateRoute = await import("@/app/api/generate-quiz/route");
const jobRoute = await import("@/app/api/generate-quiz/jobs/[id]/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const alice = auth.upsertUser("Alice", "alice-pass-1");
const bob = auth.upsertUser("Bob", "bob-pass-12");
const aliceToken = auth.createSession(alice.id).token;
const bobToken = auth.createSession(bob.id).token;

function req(url: string, token: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", cookie: `${auth.SESSION_COOKIE}=${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const provider = {
  id: "openai",
  providerType: "openai" as const,
  displayName: "OpenAI",
  apiKey: "sk-test",
  defaultModel: "m",
  isEnabled: true,
};
const settings = {
  questionCount: 4,
  allowedTypes: ["mcq-single" as const],
  immediateFeedback: false,
  // These stubs write single-answer items only.
  multiAnswerShare: 0,
};

const question = (text: string) => ({
  type: "mcq-single",
  question: text,
  options: ["First choice", "Second choice", "Third choice", "Fourth choice", "Fifth choice"],
  correctAnswer: 0,
  explanation: "Because.",
  difficulty: "medium",
  bloomLevel: "understand",
  topic: "cells",
  tags: ["cells", "biology"],
  sourcePassage: "Cells.",
});

/**
 * A provider that answers after `delayMs`, records how many calls were in
 * flight at once, and returns one question shared by every call plus one
 * unique to the call.
 */
function stubProvider(delayMs = 20) {
  const seen = { calls: 0, inFlight: 0, maxInFlight: 0 };
  vi.stubGlobal("fetch", vi.fn(async () => {
    seen.calls += 1;
    const n = seen.calls;
    seen.inFlight += 1;
    seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    seen.inFlight -= 1;
    const content = JSON.stringify([
      question("Which organelle is shared by every reply here?"),
      question(`Which statement fits reply number ${n} best?`),
    ]);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
  return seen;
}

// Two chunks (chunk size is 40 000 characters); varied words so no
// question copies a 12-word run of the document.
const LONG_DOC = Array.from({ length: 3500 }, (_, i) => `word${i % 997} topic${i % 13}.`).join(" ");

describe("mapWithConcurrency", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (ms, i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight -= 1;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
    expect(maxInFlight).toBe(2);
  });

  it("returns [] for no items", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});

describe("generateQuizQuestions (parallel chunks)", () => {
  it("runs both chunk calls at once, reports progress, and still drops a cross-chunk duplicate", async () => {
    const seen = stubProvider();
    const progress: Array<[number, number]> = [];
    const out = await generateQuizQuestions({
      docText: LONG_DOC,
      provider,
      settings,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(seen.calls).toBe(2);
    expect(seen.maxInFlight).toBe(2);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    // shared question kept once, plus one unique per call
    expect(out.questions).toHaveLength(3);
    expect(out.dropped.duplicate).toBe(1);
  });

  it("fails the whole job on an auth error from any chunk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })));
    await expect(generateQuizQuestions({ docText: LONG_DOC, provider, settings })).rejects.toThrow(/401/);
  });
});

describe("generation jobs", () => {
  it("stores the result, the error, and hides a job from other users", async () => {
    const ok = jobs.startJob("u1", 2, async (progress) => {
      progress(1, 2);
      return { quizId: "q1", questionCount: 5 };
    });
    expect(ok.status).toBe("running");
    await vi.waitFor(() => expect(jobs.getJob("u1", ok.id)?.status).toBe("done"));
    expect(jobs.getJob("u1", ok.id)).toMatchObject({ done: 1, total: 2, result: { quizId: "q1" } });
    expect(jobs.getJob("u2", ok.id)).toBeUndefined();

    const bad = jobs.startJob("u1", 1, async () => {
      throw new Error("model said no");
    });
    await vi.waitFor(() => expect(jobs.getJob("u1", bad.id)?.status).toBe("error"));
    expect(jobs.getJob("u1", bad.id)?.error).toBe("model said no");
  });

  it("prunes finished jobs after the TTL, never running ones", async () => {
    const running = jobs.startJob("u1", 1, () => new Promise(() => {}));
    const done = jobs.startJob("u1", 1, async () => ({ quizId: "q", questionCount: 1 }));
    await vi.waitFor(() => expect(jobs.getJob("u1", done.id)?.status).toBe("done"));
    jobs.pruneJobs(Date.now() + jobs.JOB_TTL_MS + 1);
    expect(jobs.getJob("u1", done.id)).toBeUndefined();
    expect(jobs.getJob("u1", running.id)?.status).toBe("running");
  });
});

describe("POST /api/generate-quiz + GET /api/generate-quiz/jobs/[id]", () => {
  const insertDoc = (userId: string) => {
    const id = crypto.randomUUID();
    testDb.insert(schema.documents).values({
      id,
      filename: "lecture.pdf",
      text: LONG_DOC,
      charCount: LONG_DOC.length,
      truncated: false,
      createdAt: new Date().toISOString(),
      userId,
    }).run();
    return id;
  };
  const body = (documentId: string) => ({ documentId, title: "Lecture", settings, provider });

  it("answers 202 with a job id at once, then the job saves the quiz", async () => {
    stubProvider(50);
    const res = await generateRoute.POST(req("/api/generate-quiz", aliceToken, body(insertDoc(alice.id))));
    expect(res.status).toBe(202);
    const { jobId } = await res.json();

    const running = await jobRoute.GET(req(`/api/generate-quiz/jobs/${jobId}`, aliceToken), params(jobId));
    expect(await running.json()).toMatchObject({ status: "running", total: 2 });

    // Bob can't see Alice's job
    const foreign = await jobRoute.GET(req(`/api/generate-quiz/jobs/${jobId}`, bobToken), params(jobId));
    expect(foreign.status).toBe(404);

    await vi.waitFor(async () => {
      const r = await jobRoute.GET(req(`/api/generate-quiz/jobs/${jobId}`, aliceToken), params(jobId));
      expect((await r.json()).status).toBe("done");
    }, { timeout: 2000 });
    const done = await (await jobRoute.GET(req(`/api/generate-quiz/jobs/${jobId}`, aliceToken), params(jobId))).json();
    expect(done).toMatchObject({ status: "done", done: 2, total: 2, questionCount: 3 });

    const quiz = sqlite.prepare("select user_id from quizzes where id = ?").get(done.quizId);
    expect(quiz).toEqual({ user_id: alice.id });
    const linked = sqlite.prepare(
      "select q.source_type, q.user_id from quiz_questions qq join questions q on q.id = qq.question_id where qq.quiz_id = ?",
    ).all(done.quizId);
    expect(linked).toEqual(Array(3).fill({ source_type: "document", user_id: alice.id }));
  });

  it("still answers 404 straight away for another user's document", async () => {
    const res = await generateRoute.POST(req("/api/generate-quiz", bobToken, body(insertDoc(alice.id))));
    expect(res.status).toBe(404);
  });
});

describe("pollGenerationJob", () => {
  const reply = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const noWait = async () => {};

  it("reports progress until done", async () => {
    const replies = [
      reply(200, { status: "running", done: 0, total: 2 }),
      reply(200, { status: "running", done: 1, total: 2 }),
      reply(200, { status: "done", done: 2, total: 2, quizId: "q9", questionCount: 7 }),
    ];
    const progress: Array<[number, number]> = [];
    const out = await pollGenerationJob("j1", {
      fetchImpl: async () => replies.shift() as Response,
      sleep: noWait,
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(out).toMatchObject({ quizId: "q9", questionCount: 7 });
    expect(progress).toEqual([[0, 2], [1, 2]]);
  });

  it("surfaces a job error, a lost job, and survives a network blip", async () => {
    await expect(pollGenerationJob("j", {
      fetchImpl: async () => reply(200, { status: "error", error: "model said no" }),
      sleep: noWait,
    })).rejects.toThrow("model said no");

    await expect(pollGenerationJob("j", {
      fetchImpl: async () => reply(404, { error: "Generation job not found" }),
      sleep: noWait,
    })).rejects.toThrow(/server restarted/);

    let calls = 0;
    const out = await pollGenerationJob("j", {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("Failed to fetch");
        return reply(200, { status: "done", quizId: "q", questionCount: 1 });
      },
      sleep: noWait,
    });
    expect(out.quizId).toBe("q");
  });

  it("turns a proxy's HTML error page into a readable error", async () => {
    const html = new Response("<!DOCTYPE html><title>524</title>", { status: 524 });
    await expect(readJson(html)).rejects.toThrow("The server took too long to answer (HTTP 524).");
  });
});

describe("planGeneration (more questions)", () => {
  // Carmen's lecture: 95 slides, 37,562 characters.
  const LECTURE = Array.from({ length: 95 }, (_, i) =>
    `PAGE ${i + 1}\n${Array.from({ length: 40 }, (_, j) => `term${i}x${j}`).join(" ")}.`,
  ).join("\n\n");

  const check = (text: string, n: number) => {
    const tasks = planGeneration(text, n);
    expect(tasks.reduce((sum, t) => sum + t.count, 0)).toBe(n);
    expect(tasks.every((t) => t.count >= 1 && t.count <= 20)).toBe(true);
    // the last part reaches the end of the document
    expect(Math.max(...tasks.map((t) => t.chunk.endChar))).toBe(text.length);
    return tasks;
  };

  it("keeps a small quiz to one call over the whole document", () => {
    const tasks = check(LECTURE, 10);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].chunk.text).toBe(LECTURE);
  });

  it("splits 100 questions into ~5 parts across the lecture, ≤ 20 per call", () => {
    const tasks = check(LECTURE, 100);
    expect(tasks.length).toBeGreaterThanOrEqual(5);
    expect(tasks.length).toBeLessThanOrEqual(7);
    // different stretches of the document, in order
    const starts = tasks.map((t) => t.chunk.startChar);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(tasks.length);
  });

  it("still caps calls at 20 when a short document can't be split that finely", () => {
    check("A short note about GABA receptors. ".repeat(60), 200);
  });

  it("the settings schema allows up to MAX_QUESTIONS and no more", async () => {
    const { QuizSettingsSchema } = await import("@/lib/validation");
    const { MAX_QUESTIONS } = await import("@/lib/topic-batches");
    expect(MAX_QUESTIONS).toBe(200);
    expect(QuizSettingsSchema.safeParse({ ...settings, questionCount: 200 }).success).toBe(true);
    expect(QuizSettingsSchema.safeParse({ ...settings, questionCount: 201 }).success).toBe(false);
  });
});
