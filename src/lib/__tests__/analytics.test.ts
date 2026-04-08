import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";

/**
 * End-to-end analytics tests. Spins up a temporary SQLite DB, applies
 * the real Drizzle migrations, seeds synthetic quiz/attempt/answer
 * data, and exercises every analytics function.
 *
 * Note: analytics.ts imports from "@/db/client" which is a module-level
 * singleton wrapping the production carmenita.db. For the test we
 * monkeypatch that singleton before importing the analytics module.
 */

const TEST_DB_PATH = path.join(process.cwd(), `carmenita-test-${Date.now()}.db`);

// Open a test DB, apply migrations, override the global singleton
const sqlite = new Database(TEST_DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });

// Override the global singleton used by db/client.ts so @/lib/analytics
// (which imports `db` from @/db/client) sees our test instance.
declare global {
  var __carmenitaDb: typeof testDb | undefined;
  var __carmenitaSqlite: Database.Database | undefined;
}
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;

// Apply migrations from the real migration directory
migrate(testDb, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });

// Now import analytics (after the singleton is in place)
const {
  overview,
  topicBreakdown,
  difficultyBreakdown,
  bloomBreakdown,
  improvementCurve,
  slowestQuestions,
} = await import("@/lib/analytics");

// ── Synthetic data seeding ────────────────────────────────────────────────────

const docId = "doc1";
const quizId = "quiz1";
const quiz2Id = "quiz2";

// Questions: 2 topics, 3 difficulties, 2 bloom levels
const questionSpecs = [
  { id: "q1", topic: "photosynthesis", difficulty: "easy", bloomLevel: "remember" },
  { id: "q2", topic: "photosynthesis", difficulty: "medium", bloomLevel: "apply" },
  { id: "q3", topic: "photosynthesis", difficulty: "hard", bloomLevel: "analyze" },
  { id: "q4", topic: "respiration", difficulty: "easy", bloomLevel: "remember" },
  { id: "q5", topic: "respiration", difficulty: "medium", bloomLevel: "apply" },
] as const;

const { documents, quizzes, questions, quizQuestions, attempts, answers } = schema;

beforeAll(() => {
  testDb.insert(documents).values({
    id: docId,
    filename: "biology.pdf",
    text: "Plants use photosynthesis to convert sunlight to chemical energy. Cellular respiration releases that energy.",
    charCount: 101,
    truncated: false,
    createdAt: "2026-04-01T00:00:00Z",
    userId: null,
  }).run();

  testDb.insert(quizzes).values([
    {
      id: quizId,
      documentId: docId,
      title: "Biology 101",
      settings: { questionCount: 5, allowedTypes: ["mcq-single"], immediateFeedback: true },
      provider: "openai",
      model: "gpt-4o",
      createdAt: "2026-04-01T00:00:00Z",
      userId: null,
    },
    {
      id: quiz2Id,
      documentId: docId,
      title: "Biology 102",
      settings: { questionCount: 0, allowedTypes: ["mcq-single"], immediateFeedback: true },
      provider: "openai",
      model: "gpt-4o",
      createdAt: "2026-04-01T00:00:00Z",
      userId: null,
    },
  ]).run();

  // Insert questions into the global bank
  testDb.insert(questions).values(
    questionSpecs.map((spec) => ({
      id: spec.id,
      type: "mcq-single" as const,
      question: `Question about ${spec.topic} at ${spec.difficulty} level`,
      options: ["A", "B", "C", "D"],
      correctAnswer: 0,
      explanation: "Reason.",
      difficulty: spec.difficulty,
      bloomLevel: spec.bloomLevel,
      topic: spec.topic,
      sourcePassage: "source",
      sourceType: "document" as const,
      sourceDocumentId: docId,
      sourceLabel: "biology.pdf",
      createdAt: "2026-04-01T00:00:00Z",
      userId: null,
    })),
  ).run();

  // Wire them into quiz1 via the junction table (quiz2 stays empty)
  testDb.insert(quizQuestions).values(
    questionSpecs.map((spec, idx) => ({
      quizId,
      questionId: spec.id,
      idx,
    })),
  ).run();

  // 3 attempts with improving scores: 40%, 60%, 80%
  // Attempt 1: q1, q2 correct / q3, q4, q5 wrong → 2/5 = 40%
  // Attempt 2: q1, q2, q4 correct / q3, q5 wrong → 3/5 = 60%
  // Attempt 3: q1, q2, q3, q4 correct / q5 wrong → 4/5 = 80%
  const attemptData: Array<{
    id: string;
    completedAt: string;
    score: number;
    correctSet: Set<string>;
  }> = [
    { id: "a1", completedAt: "2026-04-01T10:00:00Z", score: 0.4, correctSet: new Set(["q1", "q2"]) },
    { id: "a2", completedAt: "2026-04-01T11:00:00Z", score: 0.6, correctSet: new Set(["q1", "q2", "q4"]) },
    { id: "a3", completedAt: "2026-04-01T12:00:00Z", score: 0.8, correctSet: new Set(["q1", "q2", "q3", "q4"]) },
  ];

  testDb.insert(attempts).values(
    attemptData.map((a) => ({
      id: a.id,
      quizId,
      startedAt: "2026-04-01T00:00:00Z",
      completedAt: a.completedAt,
      score: a.score,
      userId: null,
    })),
  ).run();

  // Per-question time: easy=2s, medium=5s, hard=10s
  const timeFor: Record<string, number> = {
    q1: 2000,
    q2: 5000,
    q3: 10000,
    q4: 2000,
    q5: 5000,
  };

  const answerRows = attemptData.flatMap((a) =>
    questionSpecs.map((spec) => ({
      attemptId: a.id,
      questionId: spec.id,
      userAnswer: a.correctSet.has(spec.id) ? 0 : 1,
      isCorrect: a.correctSet.has(spec.id),
      timeMs: timeFor[spec.id],
    })),
  );
  testDb.insert(answers).values(answerRows).run();
});

afterAll(() => {
  sqlite.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {
    /* best effort */
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("overview", () => {
  it("counts quizzes, attempts, documents, and averages score", async () => {
    const o = await overview();
    expect(o.quizCount).toBe(2);
    expect(o.attemptCount).toBe(3);
    expect(o.documentCount).toBe(1);
    // Avg of 0.4, 0.6, 0.8 = 0.6
    expect(o.avgScore).toBeCloseTo(0.6, 4);
  });
});

describe("topicBreakdown", () => {
  it("groups correctness by topic", async () => {
    const rows = await topicBreakdown();
    // photosynthesis: q1, q2, q3 across 3 attempts = 9 rows
    //   a1: q1✓, q2✓, q3✗ (2/3)
    //   a2: q1✓, q2✓, q3✗ (2/3)
    //   a3: q1✓, q2✓, q3✓ (3/3)
    //   Total: 7/9 correct
    // respiration: q4, q5 across 3 attempts = 6 rows
    //   a1: q4✗, q5✗ (0/2)
    //   a2: q4✓, q5✗ (1/2)
    //   a3: q4✓, q5✗ (1/2)
    //   Total: 2/6 correct
    const photo = rows.find((r) => r.topic === "photosynthesis");
    const resp = rows.find((r) => r.topic === "respiration");
    expect(photo?.total).toBe(9);
    expect(photo?.correct).toBe(7);
    expect(photo?.rate).toBeCloseTo(7 / 9, 4);
    expect(resp?.total).toBe(6);
    expect(resp?.correct).toBe(2);
    expect(resp?.rate).toBeCloseTo(2 / 6, 4);
    // Ordered ASC by rate — respiration should come first
    expect(rows[0].topic).toBe("respiration");
  });

  it("filters to a single quiz when quizId is provided", async () => {
    const rows = await topicBreakdown(quizId);
    expect(rows.length).toBe(2); // 2 topics in this quiz
    const rows2 = await topicBreakdown(quiz2Id);
    expect(rows2.length).toBe(0); // empty quiz
  });
});

describe("difficultyBreakdown", () => {
  it("splits by easy/medium/hard and orders them", async () => {
    const rows = await difficultyBreakdown();
    expect(rows.map((r) => r.difficulty)).toEqual(["easy", "medium", "hard"]);
    // easy: q1, q4 across 3 attempts = 6 rows
    //   q1 always correct (3), q4: 0/✓/✓ = 2
    //   → 5/6
    const easy = rows.find((r) => r.difficulty === "easy");
    expect(easy?.total).toBe(6);
    expect(easy?.correct).toBe(5);
  });
});

describe("bloomBreakdown", () => {
  it("groups by Bloom level", async () => {
    const rows = await bloomBreakdown();
    const rem = rows.find((r) => r.bloomLevel === "remember");
    const ana = rows.find((r) => r.bloomLevel === "analyze");
    expect(rem).toBeDefined();
    expect(ana).toBeDefined();
    // analyze = q3 only → 0 + 0 + 1 = 1/3
    expect(ana?.total).toBe(3);
    expect(ana?.correct).toBe(1);
  });
});

describe("improvementCurve", () => {
  it("returns scores in chronological order with trial numbers", async () => {
    const curve = await improvementCurve(quizId);
    expect(curve).toHaveLength(3);
    expect(curve[0].trial).toBe(1);
    expect(curve[0].score).toBeCloseTo(0.4, 4);
    expect(curve[1].score).toBeCloseTo(0.6, 4);
    expect(curve[2].score).toBeCloseTo(0.8, 4);
  });

  it("returns empty array for a quiz with no attempts", async () => {
    const curve = await improvementCurve(quiz2Id);
    expect(curve).toHaveLength(0);
  });
});

describe("slowestQuestions", () => {
  it("returns the slowest questions by average time", async () => {
    const rows = await slowestQuestions(3);
    expect(rows.length).toBe(3);
    // q3 (hard, 10s) should be slowest, then q2/q5 (medium, 5s)
    expect(rows[0].questionId).toBe("q3");
    expect(rows[0].avgMs).toBe(10000);
    expect(rows[0].answered).toBe(3);
  });
});
