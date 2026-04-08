import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { quizzes } from "@/db/schema";

/**
 * POST /api/trash/[id]/restore — restore a trashed quiz.
 *
 * Sets `deleted_at` back to NULL. The quiz reappears on the dashboard
 * and becomes attemptable again. All its attempts, answers, and
 * question links are still intact because soft-delete never removed
 * them.
 *
 * This file uses `POST /api/trash/[id]` as the restore endpoint (rather
 * than a nested `/restore` route) because there's only one meaningful
 * POST action on a trashed row.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = db
    .update(quizzes)
    .set({ deletedAt: null })
    .where(and(eq(quizzes.id, id), isNotNull(quizzes.deletedAt)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json(
      { error: "Trashed quiz not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ restored: id });
}

/**
 * DELETE /api/trash/[id] — permanent deletion.
 *
 * Removes the quiz row (and cascades its quiz_questions junction,
 * attempts, and answers via the foreign key constraints). Only
 * operates on rows that are ALREADY in the trash — an attempt to
 * permanently delete an active quiz returns 404 so callers can't
 * accidentally skip the "soft delete first" step.
 *
 * Questions in the bank are NOT touched — the bank is the source of
 * truth and is never reduced by quiz deletion.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = db
    .delete(quizzes)
    .where(and(eq(quizzes.id, id), isNotNull(quizzes.deletedAt)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json(
      { error: "Trashed quiz not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ permanentlyDeleted: id });
}
