import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { questions } from "@/db/schema";
import { BulkTagSchema } from "@/lib/validation";

/**
 * PATCH /api/bank/questions/bulk-tag
 *
 * Body: {
 *   ids: string[],
 *   subject?: string | null,   // nullable = clear; undefined = leave
 *   lesson?:  string | null,
 *   topic?:   string,          // optional; must be non-empty if present
 *   addTags?:    string[],     // tags to union in
 *   removeTags?: string[],     // tags to subtract
 * }
 *
 * Updates many rows in one transaction. Since the `tags` column is a
 * JSON array, we read each row, merge, and write back. For small-to-
 * medium banks (hundreds of rows) this is fine; for larger banks we'd
 * add a junction table.
 */
export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BulkTagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ids, subject, lesson, topic, addTags, removeTags } = parsed.data;

  // Load affected rows to compute new tag arrays
  const affected = db
    .select({ id: questions.id, tags: questions.tags })
    .from(questions)
    .where(inArray(questions.id, ids))
    .all();

  if (affected.length === 0) {
    return NextResponse.json({ error: "No matching questions" }, { status: 404 });
  }

  const addSet = new Set((addTags ?? []).map((t) => t.trim().toLowerCase()));
  const removeSet = new Set((removeTags ?? []).map((t) => t.trim().toLowerCase()));

  const tx = sqlite.transaction(() => {
    for (const row of affected) {
      // Compute the new tags array for this specific row (preserving
      // existing tags, adding, and removing as requested)
      const current = new Set((row.tags ?? []).map((t) => t.toLowerCase()));
      for (const t of addSet) current.add(t);
      for (const t of removeSet) current.delete(t);
      const newTags = Array.from(current).sort();

      // Build the update patch. Only set columns the caller provided.
      const patch: Record<string, unknown> = { tags: newTags };
      if (subject !== undefined) patch.subject = subject?.trim().toLowerCase() || null;
      if (lesson !== undefined) patch.lesson = lesson?.trim().toLowerCase() || null;
      if (topic !== undefined) patch.topic = topic.trim().toLowerCase();

      db.update(questions).set(patch).where(inArray(questions.id, [row.id])).run();
    }
  });
  tx();

  return NextResponse.json({
    updated: affected.length,
    ids: affected.map((r) => r.id),
  });
}
