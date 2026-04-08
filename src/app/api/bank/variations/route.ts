import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { GenerateVariationsSchema } from "@/lib/validation";
import { generateVariations } from "@/lib/llm-variations";

/**
 * POST /api/bank/variations
 *
 * Body: { questionId, variationType, count, provider, temperature? }
 *
 * Generates N variations of a bank question via the LLM and stores each
 * one as a new question row with:
 *   • source_type        = "variation"
 *   • parent_question_id = the original question's id
 *   • variation_type     = the kind of variation requested
 *
 * The original question is NOT modified; it remains in the bank verbatim.
 * Variations are completely independent rows that happen to point back
 * to their parent.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GenerateVariationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { questionId, variationType, count, provider, temperature } = parsed.data;

  const original = db
    .select()
    .from(questions)
    .where(eq(questions.id, questionId))
    .get();
  if (!original) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  let variations;
  try {
    variations = await generateVariations({
      original,
      variationType,
      count,
      provider,
      temperature,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown generation error";
    const status = /401|403|invalid api key|authentication/i.test(msg)
      ? 401
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  if (variations.length === 0) {
    return NextResponse.json(
      {
        error:
          "The LLM returned no valid variations — output was empty or malformed.",
      },
      { status: 502 },
    );
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
    // Inherit taxonomy from the parent when the LLM leaves it blank,
    // otherwise trust what the LLM returned. This guarantees variations
    // always land in the same subject/lesson as the original even if
    // the model forgot to include them.
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

  return NextResponse.json({
    created: rows.length,
    ids: rows.map((r) => r.id),
    variationType,
    parentQuestionId: original.id,
  });
}
