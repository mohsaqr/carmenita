import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { BankImportSchema } from "@/lib/validation";
import { parseGift } from "@/lib/formats/gift";
import { parseAiken } from "@/lib/formats/aiken";
import { parseMarkdown } from "@/lib/formats/markdown";
import type { QuestionSource } from "@/db/schema";

/**
 * POST /api/bank/import
 * Body: { format: "gift" | "aiken" | "markdown", text, sourceLabel? }
 *
 * Parses the text into PortableQuestions and inserts them into the
 * bank with source_type = "gift-import" | "aiken-import" | "markdown-import".
 * Returns how many were imported, how many were skipped, and any warnings.
 */
export async function POST(req: NextRequest) {
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

  const { format, text, sourceLabel } = parsed.data;

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

  const now = new Date().toISOString();
  const sourceType: QuestionSource =
    format === "gift"
      ? "gift-import"
      : format === "aiken"
        ? "aiken-import"
        : "markdown-import";

  const rows = parsedQuestions.map((q) => ({
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
    sourceLabel: sourceLabel ?? null,
    createdAt: now,
    userId: null,
  }));

  db.insert(questions).values(rows).run();

  return NextResponse.json({
    imported: rows.length,
    warnings,
    ids: rows.map((r) => r.id),
  });
}
