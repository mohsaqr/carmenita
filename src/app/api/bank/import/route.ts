import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BankImportSchema } from "@/lib/validation";
import { parseGift } from "@/lib/formats/gift";
import { parseAiken } from "@/lib/formats/aiken";
import { parseMarkdown } from "@/lib/formats/markdown";
import type { QuestionSource } from "@/db/schema";
import { findOrCreateSet } from "@/lib/question-sets";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/bank/import
 * Body: { format: "gift" | "aiken" | "markdown", text, setName, folder? }
 *
 * Parses the text into PortableQuestions and inserts them into the
 * bank with source_type = "gift-import" | "aiken-import" | "markdown-import",
 * inside the named set (created, or appended to when a set with the
 * same name already exists in the same folder).
 * Returns { imported, warnings, ids, setId, setCreated }.
 */
export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BankImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { format, text, setName, folder } = parsed.data;

  const result =
    format === "gift"
      ? parseGift(text)
      : format === "aiken"
        ? parseAiken(text)
        : parseMarkdown(text);
  const { questions: parsedQuestions, warnings } = result;

  if (parsedQuestions.length === 0) {
    return NextResponse.json(
      {
        error: "No valid questions found in the provided text.",
        warnings,
      },
      { status: 400 },
    );
  }

  const baseTime = Date.now();
  const sourceType: QuestionSource =
    format === "gift"
      ? "gift-import"
      : format === "aiken"
        ? "aiken-import"
        : "markdown-import";

  // Each question gets a createdAt offset by 1ms so that the bank's
  // default ORDER BY created_at DESC preserves file order: Q1 first
  // (highest timestamp), Q2 second, etc.
  const total = parsedQuestions.length;
  const rows = parsedQuestions.map((q, i) => ({
    id: randomUUID(),
    type: q.type,
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    difficulty: q.difficulty,
    bloomLevel: q.bloomLevel,
    // Pipe taxonomy through from the parser into the DB row.
    subject: q.subject,
    lesson: q.lesson,
    topic: q.topic.trim().toLowerCase(),
    tags: q.tags,
    sourcePassage: q.sourcePassage,
    sourceType,
    sourceDocumentId: null,
    sourceLabel: setName,
    createdAt: new Date(baseTime + (total - 1 - i)).toISOString(),
    userId,
  }));

  // better-sqlite3 transactions are synchronous: the set is only kept
  // if the question insert succeeds too.
  const set = db.transaction(() => {
    const target = findOrCreateSet(userId, setName, folder);
    db.insert(questions)
      .values(rows.map((r) => ({ ...r, setId: target.id })))
      .run();
    return target;
  });

  return NextResponse.json({
    imported: rows.length,
    warnings,
    ids: rows.map((r) => r.id),
    setId: set.id,
    setCreated: set.created,
  });
}
