import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { questions, quizzes, quizQuestions } from "@/db/schema";
import { QuickQuizSchema } from "@/lib/validation";

/**
 * POST /api/bank/quick-quiz
 *
 * "Quick exam" primitive. Given either a list of candidate question ids
 * OR a set of filter criteria, picks up to `count` matching questions
 * (shuffled by default), creates a new quiz referencing them via the
 * `quiz_questions` junction, and returns the new quizId.
 *
 * Used by:
 *   - The dashboard ExamPickerCard (filter criteria mode)
 *   - The bank page grouped view's "Take N as quiz" button (candidateIds mode)
 *   - The import page's "Take as-is" action (candidateIds mode)
 *
 * Body: { title?, count, candidateIds?, subject?, lesson?, topic?, tag?,
 *          difficulty?, bloomLevel?, sourceType?, immediateFeedback?, shuffle? }
 * Returns: { quizId, questionCount }
 *
 * No LLM call — this is pure bank assembly. The generated quiz has
 * provider="bank", model="bank", documentId=null.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = QuickQuizSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    title,
    count,
    candidateIds,
    subject,
    lesson,
    topic,
    tag,
    difficulty,
    bloomLevel,
    sourceType,
    immediateFeedback = true,
    shuffle = true,
  } = parsed.data;

  // ── Resolve candidate id set ────────────────────────────────────────
  //
  // Two modes:
  //   1. candidateIds provided — trust the caller's selection (usually
  //      from the bank page's visible/selected rows).
  //   2. filter criteria — run a query against the questions table.
  //
  // Either way we end up with a list of ids to draw from.

  let pool: string[];

  if (candidateIds && candidateIds.length > 0) {
    // Verify every id exists in the bank so we don't create a quiz
    // pointing at stale ids.
    const existing = db
      .select({ id: questions.id })
      .from(questions)
      .where(inArray(questions.id, candidateIds))
      .all();
    pool = existing.map((r) => r.id);
  } else {
    const conditions = [];
    if (subject) conditions.push(eq(questions.subject, subject));
    if (lesson) conditions.push(eq(questions.lesson, lesson));
    if (topic) conditions.push(eq(questions.topic, topic));
    if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
    if (bloomLevel) conditions.push(eq(questions.bloomLevel, bloomLevel));
    if (sourceType) conditions.push(eq(questions.sourceType, sourceType));
    if (tag) {
      // Same LIKE trick used in /api/bank/questions — tags column is
      // a JSON string, SQLite has no native JSON array query.
      const escaped = tag.replace(/"/g, '\\"');
      conditions.push(like(questions.tags, `%"${escaped}"%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = db.select({ id: questions.id }).from(questions).where(where).all();
    pool = rows.map((r) => r.id);
  }

  if (pool.length === 0) {
    return NextResponse.json(
      {
        error:
          "No questions match the requested criteria. Try broadening the filters or importing more questions.",
      },
      { status: 404 },
    );
  }

  // ── Shuffle + slice ────────────────────────────────────────────────
  //
  // Fisher-Yates in place. Shuffling even when `shuffle=false` was
  // requested would feel wrong, so we honor the flag — but the default
  // is true because "quick exam" should vary across attempts.

  const working = [...pool];
  if (shuffle) {
    for (let i = working.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [working[i], working[j]] = [working[j], working[i]];
    }
  }
  const chosen = working.slice(0, Math.min(count, working.length));

  // ── Build the quiz + junction rows in one transaction ──────────────

  const quizId = randomUUID();
  const now = new Date().toISOString();

  const derivedTitle =
    title ||
    buildDefaultTitle({ subject, lesson, topic, tag, difficulty, bloomLevel });

  const tx = sqlite.transaction(() => {
    db.insert(quizzes)
      .values({
        id: quizId,
        documentId: null,
        title: derivedTitle,
        settings: {
          questionCount: chosen.length,
          allowedTypes: ["mcq-single", "mcq-multi", "true-false"],
          immediateFeedback,
        },
        provider: "bank",
        model: "bank",
        createdAt: now,
        userId: null,
      })
      .run();

    db.insert(quizQuestions)
      .values(
        chosen.map((questionId, idx) => ({
          quizId,
          questionId,
          idx,
        })),
      )
      .run();
  });
  tx();

  return NextResponse.json({
    quizId,
    questionCount: chosen.length,
    poolSize: pool.length,
  });
}

/**
 * Derive a human-friendly default quiz title from the filter criteria.
 * The frontend usually passes its own title, but falling back to a
 * derived one keeps the /api contract standalone-usable.
 */
function buildDefaultTitle(filters: {
  subject?: string;
  lesson?: string;
  topic?: string;
  tag?: string;
  difficulty?: string;
  bloomLevel?: string;
}): string {
  const parts: string[] = ["Quick exam"];
  if (filters.subject) parts.push(`— ${filters.subject}`);
  if (filters.lesson) parts.push(`/ ${filters.lesson}`);
  if (filters.topic) parts.push(`/ ${filters.topic}`);
  if (filters.tag) parts.push(`#${filters.tag}`);
  if (filters.difficulty) parts.push(`(${filters.difficulty})`);
  if (filters.bloomLevel) parts.push(`[${filters.bloomLevel}]`);
  return parts.join(" ");
}
