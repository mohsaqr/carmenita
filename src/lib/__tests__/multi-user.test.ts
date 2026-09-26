import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { serializeMarkdown } from "@/lib/formats/markdown";

/**
 * Private banks, end to end through the real route handlers.
 *
 * Two accounts (Alice, Bob) with real session cookies. Alice imports a
 * set, builds a quiz, takes it. Bob must not be able to see, change,
 * quiz on, export or attempt ANY of it — every foreign id behaves like
 * a missing one. Then Alice sends Bob a copy, which must be fully
 * independent of her original. Also covers the 0007 backfill and the
 * first-account claim in scripts/create-user.mjs.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "src/db/migrations");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-mu-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: MIGRATIONS });

const auth = await import("@/lib/auth");
const setsRoute = await import("@/app/api/bank/sets/route");
const setRoute = await import("@/app/api/bank/sets/[id]/route");
const sendRoute = await import("@/app/api/bank/sets/[id]/send/route");
const usersRoute = await import("@/app/api/users/route");
const importRoute = await import("@/app/api/bank/import/route");
const questionsRoute = await import("@/app/api/bank/questions/route");
const questionRoute = await import("@/app/api/bank/questions/[id]/route");
const bulkDeleteRoute = await import("@/app/api/bank/questions/bulk-delete/route");
const bankQuizRoute = await import("@/app/api/bank/quiz/route");
const quickQuizRoute = await import("@/app/api/bank/quick-quiz/route");
const exportRoute = await import("@/app/api/bank/export/route");
const taxonomyRoute = await import("@/app/api/bank/taxonomy/route");
const quizzesRoute = await import("@/app/api/quizzes/route");
const quizRoute = await import("@/app/api/quizzes/[id]/route");
const attemptsRoute = await import("@/app/api/attempts/route");
const attemptRoute = await import("@/app/api/attempts/[id]/route");
const overviewRoute = await import("@/app/api/analytics/overview/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const alice = auth.upsertUser("Alice", "alice-pass-1");
const bob = auth.upsertUser("Bob", "bob-pass-12");
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
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const MD = serializeMarkdown(
  ["mitosis", "meiosis", "apoptosis"].map((topic, i) => ({
    type: "mcq-single" as const,
    question: `Question about ${topic}?`,
    options: ["A", "B", "C"],
    correctAnswer: i % 3,
    explanation: `Because ${topic}.`,
    difficulty: "easy" as const,
    bloomLevel: "remember" as const,
    subject: null,
    lesson: null,
    topic,
    tags: ["cells", "biology"],
    sourcePassage: `${topic} passage`,
  })),
);

async function json(resPromise: Promise<Response> | Response) {
  const res = await resPromise;
  return { status: res.status, body: await res.json() };
}

// Alice's fixture: an imported set, a quiz built from it, one finished attempt.
const imported = await json(
  importRoute.POST(req("/api/bank/import", aliceToken, {
    method: "POST",
    body: { format: "markdown", text: MD, setName: "Cell Biology", folder: "Biology" },
  })),
);
const aliceSetId: string = imported.body.setId;
const aliceQuestionIds: string[] = imported.body.ids;
const aliceQuiz = await json(
  bankQuizRoute.POST(req("/api/bank/quiz", aliceToken, {
    method: "POST",
    body: { title: "Alice quiz", questionIds: aliceQuestionIds },
  })),
);
const aliceQuizId: string = aliceQuiz.body.quizId;
const aliceAttempt = await json(
  attemptsRoute.POST(req("/api/attempts", aliceToken, { method: "POST", body: { quizId: aliceQuizId } })),
);
const aliceAttemptId: string = aliceAttempt.body.id;

describe("fixture sanity (Alice's own view works)", () => {
  it("Alice imported, built a quiz, and started an attempt", () => {
    expect(imported.status).toBe(200);
    expect(aliceQuestionIds).toHaveLength(3);
    expect(aliceQuiz.status).toBe(200);
    expect(aliceAttempt.status).toBe(200);
  });

  it("Alice sees her set, questions, quiz and attempt", async () => {
    const sets = await json(setsRoute.GET(req("/api/bank/sets", aliceToken)));
    expect(sets.body.sets.map((s: { id: string }) => s.id)).toEqual([aliceSetId]);
    const qs = await json(questionsRoute.GET(req("/api/bank/questions", aliceToken)));
    expect(qs.body.total).toBe(3);
    const quizzes = await json(quizzesRoute.GET(req("/api/quizzes", aliceToken)));
    expect(quizzes.body.quizzes.map((q: { id: string }) => q.id)).toEqual([aliceQuizId]);
    expect((await attemptRoute.GET(req(`/api/attempts/${aliceAttemptId}`, aliceToken), params({ id: aliceAttemptId }))).status).toBe(200);
  });
});

describe("Bob cannot reach Alice's bank", () => {
  it("lists: sets, questions, quizzes, attempts, taxonomy, export are all empty", async () => {
    expect((await json(setsRoute.GET(req("/api/bank/sets", bobToken)))).body.sets).toEqual([]);
    expect((await json(questionsRoute.GET(req("/api/bank/questions", bobToken)))).body.total).toBe(0);
    expect((await json(questionsRoute.GET(req(`/api/bank/questions?ids=${aliceQuestionIds.join(",")}`, bobToken)))).body.total).toBe(0);
    expect((await json(questionsRoute.GET(req("/api/bank/questions?folder=Biology", bobToken)))).body.total).toBe(0);
    expect((await json(quizzesRoute.GET(req("/api/quizzes", bobToken)))).body.quizzes).toEqual([]);
    expect((await json(attemptsRoute.GET(req("/api/attempts", bobToken)))).body.attempts).toEqual([]);
    const tax = (await json(taxonomyRoute.GET(req("/api/bank/taxonomy", bobToken)))).body;
    expect(tax).toEqual({ subjects: [], lessons: [], topics: [], tags: [] });
    const exp = await exportRoute.GET(req("/api/bank/export?format=markdown", bobToken));
    expect(await exp.text()).not.toContain("mitosis");
    const ov = (await json(overviewRoute.GET(req("/api/analytics/overview", bobToken)))).body;
    expect(ov.quizCount).toBe(0);
  });

  it("writes to Alice's set/questions act like missing ids and change nothing", async () => {
    expect((await setRoute.PATCH(req(`/api/bank/sets/${aliceSetId}`, bobToken, { method: "PATCH", body: { name: "hacked" } }), params({ id: aliceSetId }))).status).toBe(404);
    expect((await setRoute.DELETE(req(`/api/bank/sets/${aliceSetId}`, bobToken, { method: "DELETE" }), params({ id: aliceSetId }))).status).toBe(404);
    expect((await questionRoute.DELETE(req(`/api/bank/questions/${aliceQuestionIds[0]}`, bobToken, { method: "DELETE" }), params({ id: aliceQuestionIds[0] }))).status).toBe(404);
    expect((await questionRoute.PATCH(req(`/api/bank/questions/${aliceQuestionIds[0]}`, bobToken, { method: "PATCH", body: { notes: "x" } }), params({ id: aliceQuestionIds[0] }))).status).toBe(404);
    const bulk = await json(bulkDeleteRoute.POST(req("/api/bank/questions/bulk-delete", bobToken, { method: "POST", body: { ids: aliceQuestionIds } })));
    expect(bulk.body.deleted).toBe(0);
    // Alice's data is untouched.
    const sets = (await json(setsRoute.GET(req("/api/bank/sets", aliceToken)))).body.sets;
    expect(sets).toMatchObject([{ id: aliceSetId, name: "Cell Biology", questionCount: 3 }]);
  });

  it("Bob can't build quizzes from Alice's questions or use her quiz/attempt", async () => {
    expect((await bankQuizRoute.POST(req("/api/bank/quiz", bobToken, { method: "POST", body: { title: "x", questionIds: aliceQuestionIds } }))).status).toBe(400);
    expect((await quickQuizRoute.POST(req("/api/bank/quick-quiz", bobToken, { method: "POST", body: { count: 3, candidateIds: aliceQuestionIds } }))).status).toBe(404);
    expect((await quizRoute.GET(req(`/api/quizzes/${aliceQuizId}`, bobToken), params({ id: aliceQuizId }))).status).toBe(404);
    expect((await quizRoute.DELETE(req(`/api/quizzes/${aliceQuizId}`, bobToken, { method: "DELETE" }), params({ id: aliceQuizId }))).status).toBe(404);
    expect((await attemptsRoute.POST(req("/api/attempts", bobToken, { method: "POST", body: { quizId: aliceQuizId } }))).status).toBe(404);
    expect((await attemptRoute.GET(req(`/api/attempts/${aliceAttemptId}`, bobToken), params({ id: aliceAttemptId }))).status).toBe(404);
    const submit = await attemptRoute.PATCH(
      req(`/api/attempts/${aliceAttemptId}`, bobToken, { method: "PATCH", body: { answers: [{ questionId: aliceQuestionIds[0], userAnswer: 0, timeMs: 1 }] } }),
      params({ id: aliceAttemptId }),
    );
    expect(submit.status).toBe(404);
  });

  it("signed-out requests get 401 from data routes", async () => {
    expect((await setsRoute.GET(req("/api/bank/sets", null))).status).toBe(401);
    expect((await questionsRoute.GET(req("/api/bank/questions", null))).status).toBe(401);
  });
});

describe("sending a copy", () => {
  it("lists the other accounts for the picker", async () => {
    expect((await json(usersRoute.GET(req("/api/users", aliceToken)))).body.users).toEqual(["Bob"]);
  });

  it("Bob receives an independent copy marked 'from Alice'", async () => {
    const sent = await json(sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, aliceToken, { method: "POST", body: { toUsername: "bob" } }), params({ id: aliceSetId })));
    expect(sent).toEqual({ status: 200, body: { sentTo: "Bob", name: "Cell Biology", questionsCopied: 3 } });

    const bobSets = (await json(setsRoute.GET(req("/api/bank/sets", bobToken)))).body.sets;
    expect(bobSets).toMatchObject([{ name: "Cell Biology", folder: "Biology", receivedFrom: "Alice", questionCount: 3 }]);
    const bobQs = (await json(questionsRoute.GET(req("/api/bank/questions", bobToken)))).body.questions as Array<{ id: string; question: string; notes: string | null }>;
    expect(bobQs.map((q) => q.question).sort()).toEqual(["Question about apoptosis?", "Question about meiosis?", "Question about mitosis?"]);
    // Fresh ids — nothing shared with Alice's rows.
    expect(bobQs.some((q) => aliceQuestionIds.includes(q.id))).toBe(false);

    // Bob deleting his copy leaves Alice's original intact.
    const bobSetId = bobSets[0].id;
    expect((await setRoute.DELETE(req(`/api/bank/sets/${bobSetId}`, bobToken, { method: "DELETE" }), params({ id: bobSetId }))).status).toBe(200);
    const aliceSets = (await json(setsRoute.GET(req("/api/bank/sets", aliceToken)))).body.sets;
    expect(aliceSets).toMatchObject([{ id: aliceSetId, questionCount: 3 }]);
  });

  it("personal notes stay with the sender", async () => {
    await questionRoute.PATCH(req(`/api/bank/questions/${aliceQuestionIds[0]}`, aliceToken, { method: "PATCH", body: { notes: "my private note" } }), params({ id: aliceQuestionIds[0] }));
    await sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, aliceToken, { method: "POST", body: { toUsername: "Bob" } }), params({ id: aliceSetId }));
    const bobQs = (await json(questionsRoute.GET(req("/api/bank/questions", bobToken)))).body.questions as Array<{ notes: string | null }>;
    expect(bobQs.every((q) => q.notes === null)).toBe(true);
  });

  it("a second copy into a same-named set gets '(from Alice)' instead of merging", async () => {
    await sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, aliceToken, { method: "POST", body: { toUsername: "Bob" } }), params({ id: aliceSetId }));
    const names = (await json(setsRoute.GET(req("/api/bank/sets", bobToken)))).body.sets.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["Cell Biology", "Cell Biology (from Alice)"]);
  });

  it("rejects: someone else's set, yourself, unknown user", async () => {
    expect((await sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, bobToken, { method: "POST", body: { toUsername: "Alice" } }), params({ id: aliceSetId }))).status).toBe(404);
    expect((await sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, aliceToken, { method: "POST", body: { toUsername: "alice" } }), params({ id: aliceSetId }))).status).toBe(400);
    expect((await sendRoute.POST(req(`/api/bank/sets/${aliceSetId}/send`, aliceToken, { method: "POST", body: { toUsername: "nobody" } }), params({ id: aliceSetId }))).status).toBe(404);
  });
});

describe("existing data is never lost", () => {
  /** A pre-0007 DB: one account, ownerless content (the live state before this change). */
  function legacyDb(file: string, withUser: boolean) {
    const db = new Database(file);
    db.pragma("foreign_keys = ON");
    fs.readdirSync(MIGRATIONS)
      .filter((f) => /^000[0-6]_.*\.sql$/.test(f))
      .sort()
      .forEach((f) =>
        fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => db.exec(s)),
      );
    if (withUser) {
      db.prepare("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ('u-first', 'First', 'first', 'x', '2026-01-01')").run();
      db.prepare("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ('u-later', 'Later', 'later', 'x', '2026-02-01')").run();
    }
    db.prepare("INSERT INTO question_sets (id, name, created_at) VALUES ('s1', 'Old set', '2026-01-01')").run();
    db.prepare(
      `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty, bloom_level, topic, tags, source_passage, source_type, set_id, created_at)
       VALUES ('q1', 'mcq-single', 'Q?', '["a","b"]', '0', '', 'easy', 'remember', 't', '[]', '', 'markdown-import', 's1', '2026-01-01')`,
    ).run();
    db.prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at) VALUES ('z1', 'Old quiz', '{}', 'bank', 'bank', '2026-01-01')").run();
    db.prepare("INSERT INTO attempts (id, quiz_id, started_at) VALUES ('a1', 'z1', '2026-01-01')").run();
    return db;
  }
  const owners = (db: Database.Database) =>
    ["question_sets", "questions", "quizzes", "attempts"].map(
      (t) => (db.prepare(`SELECT user_id FROM ${t}`).get() as { user_id: string | null }).user_id,
    );

  it("migration 0007 gives all ownerless content to the FIRST account", () => {
    const db = legacyDb(path.join(TMP, "legacy.db"), true);
    fs.readFileSync(fs.readdirSync(MIGRATIONS).filter((f) => f.startsWith("0007_")).map((f) => path.join(MIGRATIONS, f))[0], "utf8")
      .split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).forEach((s) => db.exec(s));
    expect(owners(db)).toEqual(["u-first", "u-first", "u-first", "u-first"]);
    expect((db.prepare("SELECT COUNT(*) n FROM questions").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("fresh install: the first account created takes the seed's ownerless content", () => {
    // A fresh install = the public seed: fully migrated, content with no owner.
    const file = path.join(TMP, "fresh.db");
    const seed = new Database(file);
    migrate(drizzle(seed), { migrationsFolder: MIGRATIONS });
    seed.prepare("INSERT INTO question_sets (id, name, created_at) VALUES ('s1', 'Old set', '2026-01-01')").run();
    seed.prepare(
      `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty, bloom_level, topic, tags, source_passage, source_type, set_id, created_at)
       VALUES ('q1', 'mcq-single', 'Q?', '["a","b"]', '0', '', 'easy', 'remember', 't', '[]', '', 'markdown-import', 's1', '2026-01-01')`,
    ).run();
    seed.prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at) VALUES ('z1', 'Old quiz', '{}', 'bank', 'bank', '2026-01-01')").run();
    seed.prepare("INSERT INTO attempts (id, quiz_id, started_at) VALUES ('a1', 'z1', '2026-01-01')").run();
    seed.close();
    execFileSync("node", ["scripts/create-user.mjs", "FirstUser", "first-pass-1"], { env: { ...process.env, CARMENITA_DB: file }, stdio: "pipe" });
    execFileSync("node", ["scripts/create-user.mjs", "SecondUser", "second-pass-1"], { env: { ...process.env, CARMENITA_DB: file }, stdio: "pipe" });
    const db = new Database(file, { readonly: true });
    const first = (db.prepare("SELECT id FROM users WHERE username_key = 'firstuser'").get() as { id: string }).id;
    expect(owners(db)).toEqual([first, first, first, first]);
    db.close();
  });
});
