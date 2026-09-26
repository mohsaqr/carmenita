import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";

/**
 * DELETE /api/documents/[id] — cascade-deletes document + quizzes +
 * questions + attempts + answers via ON DELETE CASCADE foreign keys.
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
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: id });
}

/**
 * GET /api/documents/[id] — return the full document including text.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;
  const row = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .get();
  if (!row) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ document: row });
}
