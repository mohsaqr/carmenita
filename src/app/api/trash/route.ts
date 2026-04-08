import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * GET /api/trash — list all soft-deleted quizzes.
 *
 * A "trashed" quiz is one whose `deleted_at` column is non-NULL. The
 * row stays in the `quizzes` table so that attempts, answers, and
 * quiz_questions links are preserved and can be recovered via
 * `POST /api/trash/[id]/restore`.
 *
 * Returns the same shape as `GET /api/quizzes` plus a `deletedAt` field.
 * Sort order: most recently deleted first.
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
    deleted_at: string;
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
      q.deleted_at,
      q.settings,
      (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id)                                AS question_count,
      (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL)         AS attempt_count,
      (SELECT MAX(score) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL)       AS best_score,
      (SELECT MAX(completed_at) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS last_attempt_at
    FROM quizzes q
    LEFT JOIN documents d ON d.id = q.document_id
    WHERE q.deleted_at IS NOT NULL
    ORDER BY q.deleted_at DESC
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
      deletedAt: r.deleted_at,
      settings: typeof r.settings === "string" ? JSON.parse(r.settings) : r.settings,
      questionCount: r.question_count,
      attemptCount: r.attempt_count,
      bestScore: r.best_score,
      lastAttemptAt: r.last_attempt_at,
    })),
  });
}
