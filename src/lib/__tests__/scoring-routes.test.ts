import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

/**
 * Scoring through the real routes: account default (UMCH when unset),
 * per-quiz override via PATCH /api/quizzes/[id], turning it off, and
 * what the attempt stores (points per answer, method, score).
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-scoring-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });

const auth = await import("@/lib/auth");
const settings = await import("@/lib/settings-store");
const quizRoute = await import("@/app/api/quizzes/[id]/route");
const attemptsRoute = await import("@/app/api/attempts/route");
const attemptRoute = await import("@/app/api/attempts/[id]/route");
const settingRoute = await import("@/app/api/settings/[key]/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const user = auth.createUser("Scorer", "scorer-pass-1");
const token = auth.createSession(user.id).token;
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: `${auth.SESSION_COOKIE}=${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// Quiz: q1 multi (A,B correct of A–E), q2 multi (A,B,C correct), q3 single (C).
const OPTS = JSON.stringify(["A", "B", "C", "D", "E"]);
const addQ = sqlite.prepare(
  `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty, bloom_level, topic, tags, source_passage, source_type, created_at, user_id)
   VALUES (?, ?, 'Q?', ?, ?, '', 'easy', 'remember', 't', '[]', '', 'manual', '2026-01-01', ?)`,
);
addQ.run("q1", "mcq-multi", OPTS, "[0,1]", user.id);
addQ.run("q2", "mcq-multi", OPTS, "[0,1,2]", user.id);
addQ.run("q3", "mcq-single", OPTS, "2", user.id);
sqlite
  .prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at, user_id) VALUES ('z', 'Exam', ?, 'bank', 'bank', '2026-01-01', ?)")
  .run(JSON.stringify({ questionCount: 3, allowedTypes: ["mcq-multi", "mcq-single"], immediateFeedback: true }), user.id);
["q1", "q2", "q3"].forEach((q, i) =>
  sqlite.prepare("INSERT INTO quiz_questions (quiz_id, question_id, idx) VALUES ('z', ?, ?)").run(q, i),
);

// The same answers every time: q1 = A,C (1 right + 1 wrong), q2 = A,B (2 of 3), q3 skipped.
const ANSWERS = [
  { questionId: "q1", userAnswer: [0, 2], timeMs: 1000 },
  { questionId: "q2", userAnswer: [0, 1], timeMs: 1000 },
  { questionId: "q3", userAnswer: null, timeMs: 1000 },
];

async function takeQuiz() {
  const started = await (await attemptsRoute.POST(req("/api/attempts", "POST", { quizId: "z" }))).json();
  const res = await attemptRoute.PATCH(req(`/api/attempts/${started.id}`, "PATCH", { answers: ANSWERS }), params(started.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  const stored = sqlite.prepare("SELECT score, scoring_method FROM attempts WHERE id = ?").get(started.id) as {
    score: number;
    scoring_method: string;
  };
  const points = Object.fromEntries(
    (sqlite.prepare("SELECT question_id, points, is_correct FROM answers WHERE attempt_id = ?").all(started.id) as Array<{
      question_id: string;
      points: number;
      is_correct: number;
    }>).map((r) => [r.question_id, { points: r.points, isCorrect: r.is_correct }]),
  );
  return { body, stored, points };
}

describe("account default", () => {
  it("is UMCH when never set, and the quiz reports it", async () => {
    const q = await (await quizRoute.GET(req("/api/quizzes/z"), params("z"))).json();
    expect(q.scoring).toEqual({ method: "umch", override: null, accountDefault: "umch" });

    const { body, stored, points } = await takeQuiz();
    // q1 A,C with A,B correct: (1 + 2) / 5 = 0.6 → 6/10. q2 A,B of A,B,C: (2 + 2) / 5 → 8/10.
    expect(points.q1).toEqual({ points: 0.6, isCorrect: 0 });
    expect(points.q2).toEqual({ points: 0.8, isCorrect: 0 });
    expect(points.q3).toEqual({ points: 0, isCorrect: 0 });
    expect(stored.scoring_method).toBe("umch");
    expect(stored.score).toBeCloseTo((0.6 + 0.8 + 0) / 3, 10);
    expect(body).toMatchObject({ scoringMethod: "umch", pointsEarned: 14, maxPoints: 30, correct: 0, total: 3 });
  });

  it("follows the Settings choice", async () => {
    settings.setSetting(user.id, "scoring-method", "cancelling");
    const { stored, points } = await takeQuiz();
    expect(stored.scoring_method).toBe("cancelling");
    expect(points.q1.points).toBe(0); // 1 right − 1 wrong
    expect(points.q2.points).toBeCloseTo(2 / 3, 10);
  });
});

describe("per-quiz override", () => {
  it("PATCH sets an override that beats the account default", async () => {
    const res = await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: "partial" }), params("z"));
    // The two attempts taken earlier are re-scored with the new override.
    expect(await res.json()).toEqual({ rescored: 2, scoring: { method: "partial", override: "partial", accountDefault: "cancelling" } });
    const { stored, points } = await takeQuiz();
    expect(stored.scoring_method).toBe("partial");
    expect(points.q1.points).toBe(0); // a wrong pick → 0
    expect(points.q2.points).toBeCloseTo(2 / 3, 10);
  });

  it("'all-or-nothing' turns partial scoring off for the quiz", async () => {
    await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: "all-or-nothing" }), params("z"));
    const { stored, points } = await takeQuiz();
    expect(stored.scoring_method).toBe("all-or-nothing");
    expect([points.q1.points, points.q2.points, points.q3.points]).toEqual([0, 0, 0]);
    expect(stored.score).toBe(0);
  });

  it("null clears the override (back to the account default); junk is refused", async () => {
    const cleared = await (await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: null }), params("z"))).json();
    expect(cleared.scoring).toEqual({ method: "cancelling", override: null, accountDefault: "cancelling" });
    expect((await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: "bogus" }), params("z"))).status).toBe(400);
    // The quiz's other settings survive the override round-trip.
    const s = JSON.parse((sqlite.prepare("SELECT settings FROM quizzes WHERE id = 'z'").get() as { settings: string }).settings);
    expect(s).toEqual({ questionCount: 3, allowedTypes: ["mcq-multi", "mcq-single"], immediateFeedback: true });
  });
});

describe("changing the method re-scores finished attempts", () => {
  const setDefault = async (method: unknown): Promise<Response> => {
    const res = await settingRoute.PUT(req("/api/settings/scoring-method", "PUT", { value: method }), {
      params: Promise.resolve({ key: "scoring-method" }),
    });
    if (!res) throw new Error("settings PUT returned no response");
    return res;
  };
  const attemptState = (id: string) => ({
    attempt: sqlite.prepare("SELECT score, scoring_method FROM attempts WHERE id = ?").get(id),
    answers: sqlite.prepare("SELECT question_id, points, is_correct FROM answers WHERE attempt_id = ? ORDER BY question_id").all(id),
  });

  it("an account change re-scores past attempts; switching back restores them exactly", async () => {
    await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: null }), params("z"));
    await setDefault("umch");
    const done = await takeQuiz();
    const underUmch = attemptState(done.body.attemptId);
    expect(underUmch.attempt).toMatchObject({ scoring_method: "umch" });

    const res = await setDefault("all-or-nothing");
    expect((await res.json()).rescored).toBeGreaterThanOrEqual(1);
    const off = attemptState(done.body.attemptId);
    expect(off.attempt).toEqual({ score: 0, scoring_method: "all-or-nothing" });
    expect(off.answers.map((a) => (a as { points: number }).points)).toEqual([0, 0, 0]);

    await setDefault("umch");
    expect(attemptState(done.body.attemptId)).toEqual(underUmch); // lossless round-trip
  });

  it("a quiz override re-scores that quiz; the account default then leaves it alone", async () => {
    await setDefault("umch");
    const done = await takeQuiz();
    const res = await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: "partial" }), params("z"));
    expect((await res.json()).rescored).toBeGreaterThanOrEqual(1);
    expect(attemptState(done.body.attemptId).attempt).toMatchObject({ scoring_method: "partial" });
    await setDefault("cancelling");
    expect(attemptState(done.body.attemptId).attempt).toMatchObject({ scoring_method: "partial" }); // override wins
    await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: null }), params("z"));
    expect(attemptState(done.body.attemptId).attempt).toMatchObject({ scoring_method: "cancelling" }); // follows default again
  });

  it("never touches another user's attempts", async () => {
    const other = auth.createUser("Bystander", "bystander-1");
    sqlite
      .prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at, user_id) VALUES ('zo', 'Theirs', '{}', 'bank', 'bank', '2026-01-01', ?)")
      .run(other.id);
    sqlite
      .prepare("INSERT INTO attempts (id, quiz_id, started_at, completed_at, score, scoring_method, user_id) VALUES ('ao', 'zo', '2026-01-01', '2026-01-01', 0.42, 'umch', ?)")
      .run(other.id);
    await setDefault("all-or-nothing");
    await setDefault("partial");
    expect(sqlite.prepare("SELECT score, scoring_method FROM attempts WHERE id = 'ao'").get()).toEqual({ score: 0.42, scoring_method: "umch" });
  });

  it("refuses an unknown method in Settings", async () => {
    expect((await setDefault("bogus")).status).toBe(400);
    expect(settings.getSetting(user.id, "scoring-method")).toBe("partial");
  });

  it("full marks are still 'correct' (for needs-review and breakdowns)", async () => {
    settings.setSetting(user.id, "scoring-method", "umch");
    await quizRoute.PATCH(req("/api/quizzes/z", "PATCH", { scoringMethod: null }), params("z"));
    const started = await (await attemptsRoute.POST(req("/api/attempts", "POST", { quizId: "z" }))).json();
    await attemptRoute.PATCH(
      req(`/api/attempts/${started.id}`, "PATCH", {
        answers: [
          { questionId: "q1", userAnswer: [1, 0], timeMs: 1 },
          { questionId: "q2", userAnswer: [0, 1, 2], timeMs: 1 },
          { questionId: "q3", userAnswer: 2, timeMs: 1 },
        ],
      }),
      params(started.id),
    );
    const rows = sqlite.prepare("SELECT points, is_correct FROM answers WHERE attempt_id = ?").all(started.id);
    expect(rows).toEqual([
      { points: 1, is_correct: 1 },
      { points: 1, is_correct: 1 },
      { points: 1, is_correct: 1 },
    ]);
  });
});
