import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BankRetagSchema } from "@/lib/validation";
import { generateTagging } from "@/lib/llm-enhance";

/**
 * POST /api/bank/questions/retag
 *
 * Given a list of question ids, derive a subject / lesson / topic / tags
 * set for each one via the `carmenita.tag.add` prompt. Replaces the
 * existing values. Used by the "Re-tag (N)" toolbar button on /bank,
 * primarily for imported questions that landed in the bank without
 * good metadata.
 *
 * Body: { ids: string[], provider, temperature? }
 * Returns: {
 *   updated: number,
 *   errors: { id: string, message: string }[]
 * }
 *
 * Per-question sequential with per-question error handling. Auth-error
 * failures abort the whole batch (same as explain). Unlike bulk-tag which
 * merges into existing tag arrays, retag REPLACES because we're asking
 * the LLM to produce a complete tagging.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BankRetagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ids, provider, temperature } = parsed.data;

  const rows = db
    .select()
    .from(questions)
    .where(inArray(questions.id, ids))
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ error: "No matching questions" }, { status: 404 });
  }

  let updated = 0;
  const errors: { id: string; message: string }[] = [];

  for (const row of rows) {
    try {
      const tagging = await generateTagging(row, provider, temperature);
      db.update(questions)
        .set({
          subject: tagging.subject,
          lesson: tagging.lesson,
          topic: tagging.topic,
          tags: tagging.tags,
        })
        .where(inArray(questions.id, [row.id]))
        .run();
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ id: row.id, message: msg });
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        return NextResponse.json(
          {
            error: msg,
            updated,
            errors,
          },
          { status: 401 },
        );
      }
    }
  }

  return NextResponse.json({ updated, errors });
}
