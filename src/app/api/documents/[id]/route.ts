import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

/**
 * DELETE /api/documents/[id] — cascade-deletes document + quizzes +
 * questions + attempts + answers via ON DELETE CASCADE foreign keys.
 */
async function handleDELETE(
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
async function handleGET(
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

export const DELETE = withLog(handleDELETE);
export const GET = withLog(handleGET);
