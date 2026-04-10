import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * SQL-backed quiz analytics. All functions are async and return plain
 * objects that serialize cleanly to JSON for API route responses.
 *
 * Handai's analytics.ts is focused on inter-rater agreement (Cohen's
 * kappa) which isn't relevant here — every query in this module is new.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Improvement curve — per-trial score for a single quiz.
// `trial` is 1-indexed and ordered by completion time.
// ─────────────────────────────────────────────────────────────────────────────
export interface ImprovementPoint {
  trial: number;
  completedAt: string;
  score: number;
}

export async function improvementCurve(
  quizId: string,
): Promise<ImprovementPoint[]> {
  const rows = db.all<{
    trial: number;
    completed_at: string;
    score: number;
  }>(sql`
    SELECT
      ROW_NUMBER() OVER (ORDER BY completed_at ASC) AS trial,
      completed_at,
      score
    FROM attempts
    WHERE quiz_id = ${quizId}
      AND completed_at IS NOT NULL
      AND score IS NOT NULL
    ORDER BY completed_at ASC
  `);

  return rows.map((r) => ({
    trial: r.trial,
    completedAt: r.completed_at,
    score: r.score,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-topic breakdown — aggregated across all completed attempts.
// Optionally filtered to a single quiz.
// ─────────────────────────────────────────────────────────────────────────────
export interface TopicStat {
  topic: string;
  total: number;
  correct: number;
  rate: number;
}

export async function topicBreakdown(quizId?: string): Promise<TopicStat[]> {
  const rows = db.all<{
    topic: string;
    total: number;
    correct: number;
    rate: number;
  }>(sql`
    SELECT
      q.topic AS topic,
      COUNT(*) AS total,
      SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
      AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
    FROM answers a
    JOIN questions q  ON q.id  = a.question_id
    JOIN attempts  at ON at.id = a.attempt_id
    WHERE at.completed_at IS NOT NULL
      ${quizId ? sql`AND at.quiz_id = ${quizId}` : sql``}
    GROUP BY q.topic
    ORDER BY rate ASC
  `);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-difficulty breakdown
// ─────────────────────────────────────────────────────────────────────────────
export interface DifficultyStat {
  difficulty: "easy" | "medium" | "hard";
  total: number;
  correct: number;
  rate: number;
}

export async function difficultyBreakdown(
  quizId?: string,
): Promise<DifficultyStat[]> {
  const rows = db.all<DifficultyStat>(sql`
    SELECT
      q.difficulty AS difficulty,
      COUNT(*) AS total,
      SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
      AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
    FROM answers a
    JOIN questions q  ON q.id  = a.question_id
    JOIN attempts  at ON at.id = a.attempt_id
    WHERE at.completed_at IS NOT NULL
      ${quizId ? sql`AND at.quiz_id = ${quizId}` : sql``}
    GROUP BY q.difficulty
    ORDER BY
      CASE q.difficulty
        WHEN 'easy' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'hard' THEN 3
      END
  `);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Bloom-level breakdown
// ─────────────────────────────────────────────────────────────────────────────
export type BloomLevelStr =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export interface BloomStat {
  bloomLevel: BloomLevelStr;
  total: number;
  correct: number;
  rate: number;
}

export async function bloomBreakdown(quizId?: string): Promise<BloomStat[]> {
  const rows = db.all<{
    bloom_level: BloomLevelStr;
    total: number;
    correct: number;
    rate: number;
  }>(sql`
    SELECT
      q.bloom_level,
      COUNT(*) AS total,
      SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
      AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
    FROM answers a
    JOIN questions q  ON q.id  = a.question_id
    JOIN attempts  at ON at.id = a.attempt_id
    WHERE at.completed_at IS NOT NULL
      ${quizId ? sql`AND at.quiz_id = ${quizId}` : sql``}
    GROUP BY q.bloom_level
    ORDER BY
      CASE q.bloom_level
        WHEN 'remember' THEN 1
        WHEN 'understand' THEN 2
        WHEN 'apply' THEN 3
        WHEN 'analyze' THEN 4
        WHEN 'evaluate' THEN 5
        WHEN 'create' THEN 6
      END
  `);
  return rows.map((r) => ({
    bloomLevel: r.bloom_level,
    total: r.total,
    correct: r.correct,
    rate: r.rate,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Slowest questions — median (well, average) answer time per question.
// Helps identify questions the user consistently finds hard.
// ─────────────────────────────────────────────────────────────────────────────
export interface SlowestQuestion {
  questionId: string;
  question: string;
  avgMs: number;
  answered: number;
}

export async function slowestQuestions(
  limit = 10,
): Promise<SlowestQuestion[]> {
  const rows = db.all<{
    id: string;
    question: string;
    avg_ms: number;
    answered: number;
  }>(sql`
    SELECT
      q.id,
      q.question,
      AVG(a.time_ms) AS avg_ms,
      COUNT(*) AS answered
    FROM answers a
    JOIN questions q ON q.id = a.question_id
    GROUP BY q.id
    HAVING answered > 0
    ORDER BY avg_ms DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    questionId: r.id,
    question: r.question,
    avgMs: r.avg_ms,
    answered: r.answered,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview — high-level numbers for the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export interface Overview {
  quizCount: number;
  attemptCount: number;
  documentCount: number;
  avgScore: number | null;
}

export async function overview(): Promise<Overview> {
  const [row] = db.all<{
    quiz_count: number;
    attempt_count: number;
    document_count: number;
    avg_score: number | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM quizzes)                                        AS quiz_count,
      (SELECT COUNT(*) FROM attempts WHERE completed_at IS NOT NULL)        AS attempt_count,
      (SELECT COUNT(*) FROM documents)                                      AS document_count,
      (SELECT AVG(score) FROM attempts WHERE completed_at IS NOT NULL)      AS avg_score
  `);

  return {
    quizCount: row?.quiz_count ?? 0,
    attemptCount: row?.attempt_count ?? 0,
    documentCount: row?.document_count ?? 0,
    avgScore: row?.avg_score ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Needs review — questions the user has gotten wrong at least once.
// Ranked by accuracy rate (worst first), then by number of wrong answers.
// ─────────────────────────────────────────────────────────────────────────────
export interface NeedsReviewQuestion {
  questionId: string;
  question: string;
  topic: string;
  difficulty: string;
  answered: number;
  wrong: number;
  rate: number;
}

export async function needsReview(
  limit = 50,
): Promise<NeedsReviewQuestion[]> {
  const rows = db.all<{
    id: string;
    question: string;
    topic: string;
    difficulty: string;
    answered: number;
    wrong: number;
    rate: number;
  }>(sql`
    SELECT
      q.id,
      q.question,
      q.topic,
      q.difficulty,
      COUNT(*) AS answered,
      SUM(CASE WHEN a.is_correct THEN 0 ELSE 1 END) AS wrong,
      AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
    FROM answers a
    JOIN questions q  ON q.id  = a.question_id
    JOIN attempts  at ON at.id = a.attempt_id
    WHERE at.completed_at IS NOT NULL
    GROUP BY q.id
    HAVING wrong > 0
    ORDER BY rate ASC, wrong DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    questionId: r.id,
    question: r.question,
    topic: r.topic,
    difficulty: r.difficulty,
    answered: r.answered,
    wrong: r.wrong,
    rate: r.rate,
  }));
}
