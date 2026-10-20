import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BulkDeleteSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

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
async function handlePOST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
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
  const result = db
    .delete(questions)
    .where(and(inArray(questions.id, ids), eq(questions.userId, userId)))
    .run();

  return NextResponse.json({
    deleted: result.changes,
    requested: ids.length,
  });
}

export const POST = withLog(handlePOST);
