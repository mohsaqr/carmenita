import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { quizzes, questions, quizQuestions } from "@/db/schema";

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
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const quiz = db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt)))
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

  return NextResponse.json({ quiz, questions: questionRows });
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
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const now = new Date().toISOString();
  const result = db
    .update(quizzes)
    .set({ deletedAt: now })
    .where(and(eq(quizzes.id, id), isNull(quizzes.deletedAt)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }
  return NextResponse.json({ trashed: id, deletedAt: now });
}
