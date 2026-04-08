import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BulkDeleteSchema } from "@/lib/validation";

/**
 * POST /api/bank/questions/bulk-delete
 *
 * Body: { ids: string[] }
 *
 * Deletes many bank questions in one transaction. Cascades remove
 * quiz_questions junction rows and answer rows via the foreign-key
 * ON DELETE CASCADE constraints. Variations of deleted questions
 * survive (their parent_question_id is set to NULL via ON DELETE SET NULL).
 *
 * Returns the count of rows actually deleted. If some ids don't exist
 * the count will be lower than the input length — not an error, just
 * the silent behavior of SQL DELETE.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ids } = parsed.data;
  const result = db.delete(questions).where(inArray(questions.id, ids)).run();

  return NextResponse.json({
    deleted: result.changes,
    requested: ids.length,
  });
}
