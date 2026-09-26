import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * PATCH /api/bank/questions/[id] — partial update of a single
 * question. Currently exposes only `notes` because that's the field
 * the study UI needs to update per question; other fields are
 * edited via the bank page or retag endpoints.
 *
 * Body: { notes?: string | null }
 *
 * An empty string OR null both clear the note. Notes longer than
 * 10k characters are rejected to avoid blowing up the row size on
 * free-text input.
 */
const PatchSchema = z.object({
  notes: z.string().max(10_000).nullable().optional(),
});

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
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const updates: Partial<{ notes: string | null }> = {};
  if ("notes" in parsed.data) {
    // Normalize empty string → null so the DB doesn't store whitespace-only notes
    const n = parsed.data.notes;
    updates.notes = n && n.trim().length > 0 ? n : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields in request body" },
      { status: 400 },
    );
  }

  const result = db
    .update(questions)
    .set(updates)
    .where(and(eq(questions.id, id), eq(questions.userId, userId)))
    .run();

  if (result.changes === 0) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json({ updated: id, notes: updates.notes ?? null });
}

/**
 * DELETE /api/bank/questions/[id] — remove a question from the bank.
 * Cascade deletes its quiz_questions junction rows (so it vanishes
 * from any quiz) and its answer rows.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;
  const result = db
    .delete(questions)
    .where(and(eq(questions.id, id), eq(questions.userId, userId)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: id });
}
