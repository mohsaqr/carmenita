import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { attempts, quizzes } from "@/db/schema";
import { CreateAttemptSchema } from "@/lib/validation";

/**
 * GET /api/attempts — list all attempts across every quiz, joined with
 * the parent quiz's title. Used by the /attempts page. Soft-deleted
 * quizzes are excluded so a trashed quiz doesn't show up in the
 * attempts log. To see attempts for a trashed quiz, restore the quiz
 * first.
 *
 * Returns: { attempts: [{ id, quizId, quizTitle, startedAt,
 * completedAt, score, questionCount }] }
 */
export async function GET() {
  const rows = db
    .select({
      id: attempts.id,
      quizId: attempts.quizId,
      quizTitle: quizzes.title,
      startedAt: attempts.startedAt,
      completedAt: attempts.completedAt,
      score: attempts.score,
      questionCount: sql<number>`(SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = ${attempts.quizId})`,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .where(isNull(quizzes.deletedAt))
    .orderBy(desc(attempts.startedAt))
    .all();

  return NextResponse.json({ attempts: rows });
}

/**
 * POST /api/attempts — start a new attempt.
 * Body: { quizId }
 * Returns: { id, quizId, startedAt }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateAttemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Verify the quiz exists and is not soft-deleted.
  const quiz = db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(
      and(eq(quizzes.id, parsed.data.quizId), isNull(quizzes.deletedAt)),
    )
    .get();
  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const id = randomUUID();
  const startedAt = new Date().toISOString();

  db.insert(attempts)
    .values({
      id,
      quizId: parsed.data.quizId,
      startedAt,
      completedAt: null,
      score: null,
      userId: null,
    })
    .run();

  return NextResponse.json({ id, quizId: parsed.data.quizId, startedAt });
}
