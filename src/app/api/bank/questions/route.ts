import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { CreateQuestionSchema } from "@/lib/validation";

/**
 * GET /api/bank/questions — list questions from the global bank with
 * optional filters.
 *
 * Query parameters:
 *   ?topic=photosynthesis      — filter by topic tag (exact match)
 *   ?difficulty=easy           — filter by difficulty
 *   ?bloomLevel=analyze        — filter by Bloom level
 *   ?sourceType=gift-import    — filter by provenance
 *   ?ids=id1,id2,id3           — fetch specific questions (used by export)
 *   ?limit=200&offset=0        — pagination (default limit 500)
 *
 * Returns: { questions: Question[], total: number }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const topic = sp.get("topic");
  const subject = sp.get("subject");
  const lesson = sp.get("lesson");
  const tag = sp.get("tag");
  const difficulty = sp.get("difficulty") as
    | "easy"
    | "medium"
    | "hard"
    | null;
  const bloomLevel = sp.get("bloomLevel") as
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create"
    | null;
  const sourceType = sp.get("sourceType") as
    | "document"
    | "gift-import"
    | "aiken-import"
    | "markdown-import"
    | "manual"
    | "variation"
    | null;
  const idsCsv = sp.get("ids");
  const limit = Math.min(parseInt(sp.get("limit") || "500", 10) || 500, 2000);

  const conditions = [];
  if (topic) conditions.push(eq(questions.topic, topic));
  if (subject) conditions.push(eq(questions.subject, subject));
  if (lesson) conditions.push(eq(questions.lesson, lesson));
  // Tags are stored as a JSON string like ["a","b","c"]. SQLite doesn't
  // have a native JSON array query, so we do a LIKE match on the quoted
  // tag literal. Good enough for the expected data volumes; indexable
  // via FTS later if needed.
  if (tag) {
    const escaped = tag.replace(/"/g, '\\"');
    conditions.push(like(questions.tags, `%"${escaped}"%`));
  }
  if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
  if (bloomLevel) conditions.push(eq(questions.bloomLevel, bloomLevel));
  if (sourceType) conditions.push(eq(questions.sourceType, sourceType));
  if (idsCsv) {
    const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) conditions.push(inArray(questions.id, ids));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(questions)
    .where(where)
    .orderBy(desc(questions.createdAt))
    .limit(limit)
    .all();

  return NextResponse.json({ questions: rows, total: rows.length });
}

/**
 * POST /api/bank/questions — create a manual question.
 *
 * Body: CreateQuestionSchema shape (full PortableQuestion with
 * type-specific constraints enforced in the Zod refinement). The new
 * row gets source_type="manual" and no parent or document link.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const q = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();

  // Normalize taxonomy fields to lowercase + trimmed; tags deduped.
  const normalizedTags = Array.from(
    new Set(q.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );

  db.insert(questions)
    .values({
      id,
      type: q.type,
      question: q.question.trim(),
      // For true-false we always store the canonical ["True","False"]
      // pair regardless of what the client passed.
      options:
        q.type === "true-false" ? ["True", "False"] : q.options.map((o) => o.trim()),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation.trim(),
      difficulty: q.difficulty,
      bloomLevel: q.bloomLevel,
      subject: q.subject?.trim().toLowerCase() || null,
      lesson: q.lesson?.trim().toLowerCase() || null,
      topic: q.topic.trim().toLowerCase(),
      tags: normalizedTags,
      sourcePassage: q.sourcePassage.trim(),
      sourceType: "manual",
      sourceDocumentId: null,
      sourceLabel: null,
      parentQuestionId: null,
      variationType: null,
      createdAt: now,
      userId: null,
    })
    .run();

  return NextResponse.json({ id, created: 1 });
}
