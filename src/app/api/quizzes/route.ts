import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * GET /api/quizzes — list all quizzes with joined counts.
 *
 * Returns one row per quiz with `questionCount`, `attemptCount`, and
 * `bestScore` (max across completed attempts, null if never attempted).
 *
 * Question counts are joined through the `quiz_questions` junction
 * table rather than the old questions.quiz_id column. Document filename
 * is a LEFT JOIN because quizzes can exist without a source document
 * (assembled from the bank).
 */
export async function GET() {
  const rows = db.all<{
    id: string;
    title: string;
    document_id: string | null;
    document_filename: string | null;
    provider: string;
    model: string;
    created_at: string;
    settings: string;
    question_count: number;
    attempt_count: number;
    best_score: number | null;
    last_attempt_at: string | null;
  }>(sql`
    SELECT
      q.id,
      q.title,
      q.document_id,
      d.filename AS document_filename,
      q.provider,
      q.model,
      q.created_at,
      q.settings,
      (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id)                                AS question_count,
      (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL)         AS attempt_count,
      (SELECT MAX(score) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL)       AS best_score,
      (SELECT MAX(completed_at) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS last_attempt_at
    FROM quizzes q
    LEFT JOIN documents d ON d.id = q.document_id
    WHERE q.deleted_at IS NULL
    ORDER BY q.created_at DESC
  `);

  return NextResponse.json({
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      documentId: r.document_id,
      documentFilename: r.document_filename,
      provider: r.provider,
      model: r.model,
      createdAt: r.created_at,
      settings: typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings,
      questionCount: r.question_count,
      attemptCount: r.attempt_count,
      bestScore: r.best_score,
      lastAttemptAt: r.last_attempt_at,
    })),
  });
}
