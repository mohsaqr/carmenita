import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * DELETE /api/documents/[id] — cascade-deletes document + quizzes +
 * questions + attempts + answers via ON DELETE CASCADE foreign keys.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = db.delete(documents).where(eq(documents.id, id)).run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: id });
}

/**
 * GET /api/documents/[id] — return the full document including text.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ document: row });
}
