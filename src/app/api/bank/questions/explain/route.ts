import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BankExplainSchema } from "@/lib/validation";
import { generateExplanation } from "@/lib/llm-enhance";

/**
 * POST /api/bank/questions/explain
 *
 * Given a list of question ids, generate (or regenerate) a 1-2 sentence
 * pedagogical explanation for each one via the `carmenita.feedback.add`
 * prompt. Used by the "Explain (N)" toolbar button on /bank.
 *
 * Body: {
 *   ids: string[],
 *   provider: ProviderConfig,
 *   temperature?: number,
 *   onlyIfMissing?: boolean  // default true — skip questions that already have an explanation
 * }
 * Returns: {
 *   updated: number,
 *   skipped: number,
 *   errors: { id: string, message: string }[]
 * }
 *
 * Design notes:
 * - Runs sequentially, ONE LLM call per question, with per-question error
 *   handling. A single LLM failure does NOT abort the whole batch.
 * - Auth-error failures (401/403) DO abort — no point hammering a bad key.
 * - Updates are per-row, not in a single transaction, so partial progress
 *   is visible even if the process is interrupted.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BankExplainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ids, provider, temperature, onlyIfMissing = true } = parsed.data;

  const rows = db
    .select()
    .from(questions)
    .where(inArray(questions.id, ids))
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ error: "No matching questions" }, { status: 404 });
  }

  let updated = 0;
  let skipped = 0;
  const errors: { id: string; message: string }[] = [];

  for (const row of rows) {
    // Skip rows that already have a non-empty explanation when
    // onlyIfMissing is true (the default). This makes repeated calls
    // idempotent and cheap — users can safely hit the button again.
    if (onlyIfMissing && row.explanation && row.explanation.trim().length > 0) {
      skipped++;
      continue;
    }

    try {
      const explanation = await generateExplanation(row, provider, temperature);
      db.update(questions)
        .set({ explanation })
        .where(inArray(questions.id, [row.id]))
        .run();
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ id: row.id, message: msg });
      // Abort on auth failures — no point continuing if the key is bad.
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        return NextResponse.json(
          {
            error: msg,
            updated,
            skipped,
            errors,
          },
          { status: 401 },
        );
      }
    }
  }

  return NextResponse.json({ updated, skipped, errors });
}
