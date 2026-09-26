import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { quizzes, questions, quizQuestions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { z } from "zod";
import { getSetting } from "@/lib/settings-store";
import { rescoreAttempts } from "@/lib/rescore";
import {
  isScoringMethod,
  resolveScoringMethod,
  SCORING_METHODS,
  SCORING_SETTING_KEY,
  SERVER_DEFAULT_SCORING,
} from "@/lib/scoring";

/**
 * GET /api/quizzes/[id] — fetch a quiz with all its questions in order.
 *
 * Questions are joined through the `quiz_questions` junction and
 * ordered by `quiz_questions.idx` (NOT the old `questions.idx`, which
 * no longer exists — a question can belong to many quizzes with
 * different positions).
 *
 * Soft-deleted quizzes (deleted_at IS NOT NULL) return 404 here.
 * To view or restore them, use `/api/trash`.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;

  const quiz = db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt), eq(quizzes.userId, userId)))
    .get();
  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const questionRows = db
    .select({
      // All question columns
      id: questions.id,
      type: questions.type,
      question: questions.question,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      explanation: questions.explanation,
      difficulty: questions.difficulty,
      bloomLevel: questions.bloomLevel,
      topic: questions.topic,
      sourcePassage: questions.sourcePassage,
      sourceType: questions.sourceType,
      sourceDocumentId: questions.sourceDocumentId,
      sourceLabel: questions.sourceLabel,
      notes: questions.notes,
      createdAt: questions.createdAt,
      userId: questions.userId,
      // Position within this quiz
      idx: quizQuestions.idx,
    })
    .from(quizQuestions)
    .innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .where(eq(quizQuestions.quizId, id))
    .orderBy(asc(quizQuestions.idx))
    .all();

  // Effective scoring method (quiz override > account default > UMCH),
  // so the runner's feedback matches what the submit will score.
  const accountDefault = getSetting(userId, SCORING_SETTING_KEY);
  const scoring = {
    method: resolveScoringMethod(quiz.settings?.scoringMethod, accountDefault, SERVER_DEFAULT_SCORING),
    override: isScoringMethod(quiz.settings?.scoringMethod) ? quiz.settings.scoringMethod : null,
    accountDefault: resolveScoringMethod(null, accountDefault, SERVER_DEFAULT_SCORING),
  };

  return NextResponse.json({ quiz, questions: questionRows, scoring });
}

const PatchSchema = z.object({
  // A method overrides the account default for this quiz; null clears it.
  scoringMethod: z.enum(SCORING_METHODS).nullable(),
});

/**
 * PATCH /api/quizzes/[id] — body { scoringMethod: <method> | null }
 * Sets (or clears, with null) this quiz's scoring override and re-scores
 * this quiz's finished attempts with it. Returns { scoring, rescored }.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown scoring method" }, { status: 400 });
  }
  const quiz = db
    .select({ settings: quizzes.settings })
    .from(quizzes)
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt), eq(quizzes.userId, userId)))
    .get();
  if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  const settings = { ...quiz.settings };
  if (parsed.data.scoringMethod === null) delete settings.scoringMethod;
  else settings.scoringMethod = parsed.data.scoringMethod;
  db.update(quizzes)
    .set({ settings })
    .where(and(eq(quizzes.id, id), eq(quizzes.userId, userId)))
    .run();

  // This quiz's past attempts follow the new method too.
  const rescored = rescoreAttempts(userId, { quizId: id });

  const accountDefault = getSetting(userId, SCORING_SETTING_KEY);
  return NextResponse.json({
    rescored,
    scoring: {
      method: resolveScoringMethod(settings.scoringMethod, accountDefault, SERVER_DEFAULT_SCORING),
      override: parsed.data.scoringMethod,
      accountDefault: resolveScoringMethod(null, accountDefault, SERVER_DEFAULT_SCORING),
    },
  });
}

/**
 * DELETE /api/quizzes/[id] — SOFT DELETE.
 *
 * Sets `deleted_at` to the current timestamp instead of removing the
 * row. The quiz disappears from the dashboard and the quiz runner, but
 * its attempts, answers, and quiz_questions junction rows are
 * preserved. The quiz can be restored from `/trash` at any time.
 *
 * For permanent deletion, see `DELETE /api/trash/[id]`.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;
  const now = new Date().toISOString();
  const result = db
    .update(quizzes)
    .set({ deletedAt: now })
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt), eq(quizzes.userId, userId)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }
  return NextResponse.json({ trashed: id, deletedAt: now });
}
