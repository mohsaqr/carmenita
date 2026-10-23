import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { CreateQuestionSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { bankQuestionWhere } from "@/lib/bank-filters";
import { withLog } from "@/lib/request-log";

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
 *   ?setId=<id>                — only questions in one set
 *   ?folder=pathology          — only questions in sets filed in that folder
 *   ?includeArchived=1         — also list questions from archived sets
 *                                (they are hidden by default, unless asked for by setId or ids)
 *   ?limit=200&offset=0        — pagination (default limit 500)
 *
 * Returns: { questions: Question[], total: number }
 */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get("limit") || "500", 10) || 500, 2000);
  const where = bankQuestionWhere(userId, sp);

  const rows = db
    .select()
    .from(questions)
    .where(where)
    // id breaks created_at ties (imports share timestamps), so pages are stable.
    .orderBy(desc(questions.createdAt), asc(questions.id))
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
async function handlePOST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
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
      userId,
    })
    .run();

  return NextResponse.json({ id, created: 1 });
}

export const GET = withLog(handleGET);
export const POST = withLog(handlePOST);
