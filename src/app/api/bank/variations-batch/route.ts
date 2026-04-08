import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BankVariationsBatchSchema } from "@/lib/validation";
import { generateVariations } from "@/lib/llm-variations";

/**
 * POST /api/bank/variations-batch
 *
 * Generate variations for MANY parent questions in one request. For
 * each parent id, produces `countPerParent` variations of the given
 * type and stores each as a new question row with:
 *   • source_type        = "variation"
 *   • parent_question_id = the parent's id
 *   • variation_type     = the requested kind
 *
 * Used by the import page's "Add variations to all" post-import action.
 *
 * Body: { parentIds, variationType, countPerParent, provider, temperature? }
 * Returns: {
 *   created: number,
 *   errors: { parentId: string, message: string }[],
 *   childIds: string[],     // flat list of all newly-inserted variation ids
 *   parents: number,        // how many parent ids we tried
 * }
 *
 * Per-parent sequential with per-parent error handling (same model as
 * the explain/retag routes). A single LLM failure does NOT abort the
 * batch. Auth errors (401/403) DO abort.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BankVariationsBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { parentIds, variationType, countPerParent, provider, temperature } =
    parsed.data;

  // Load all parents in one query, then iterate. If any id is unknown,
  // we skip it and report in the errors list — not a hard failure.
  const parents = db
    .select()
    .from(questions)
    .where(inArray(questions.id, parentIds))
    .all();

  const parentMap = new Map(parents.map((p) => [p.id, p]));
  const errors: { parentId: string; message: string }[] = [];
  const allChildIds: string[] = [];
  let created = 0;

  for (const parentId of parentIds) {
    const original = parentMap.get(parentId);
    if (!original) {
      errors.push({ parentId, message: "Parent question not found in bank" });
      continue;
    }

    let variations;
    try {
      variations = await generateVariations({
        original,
        variationType,
        count: countPerParent,
        provider,
        temperature,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ parentId, message: msg });
      // Abort on auth failures — no point continuing if the key is bad.
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        return NextResponse.json(
          {
            error: msg,
            created,
            childIds: allChildIds,
            errors,
            parents: parents.length,
          },
          { status: 401 },
        );
      }
      continue;
    }

    if (variations.length === 0) {
      errors.push({
        parentId,
        message: "LLM returned no valid variations for this parent",
      });
      continue;
    }

    const now = new Date().toISOString();
    const rows = variations.map((v) => ({
      id: randomUUID(),
      type: v.type,
      question: v.question,
      options: v.options,
      correctAnswer: v.correctAnswer,
      explanation: v.explanation,
      difficulty: v.difficulty,
      bloomLevel: v.bloomLevel,
      // Inherit taxonomy from the parent when the LLM left it blank.
      subject: v.subject ?? original.subject,
      lesson: v.lesson ?? original.lesson,
      topic: (v.topic || original.topic).trim().toLowerCase(),
      tags: Array.from(
        new Set(
          [...(original.tags ?? []), ...(v.tags ?? [])].map((t) => t.toLowerCase()),
        ),
      ),
      sourcePassage: v.sourcePassage,
      sourceType: "variation" as const,
      sourceDocumentId: null,
      sourceLabel: `variation-${variationType}`,
      parentQuestionId: original.id,
      variationType,
      createdAt: now,
      userId: null,
    }));

    db.insert(questions).values(rows).run();
    created += rows.length;
    for (const r of rows) allChildIds.push(r.id);
  }

  return NextResponse.json({
    created,
    childIds: allChildIds,
    errors,
    parents: parents.length,
  });
}
