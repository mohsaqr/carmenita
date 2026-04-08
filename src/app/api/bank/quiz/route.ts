import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { questions, quizzes, quizQuestions } from "@/db/schema";
import { CreateQuizFromBankSchema } from "@/lib/validation";

/**
 * POST /api/bank/quiz
 * Body: { title, questionIds, immediateFeedback? }
 *
 * Creates a new quiz by referencing N existing bank questions via the
 * quiz_questions junction. Unlike /api/generate-quiz, this quiz has
 * NO source document (documentId = null) and NO LLM provider (since
 * we're not generating anything — just assembling).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateQuizFromBankSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { title, questionIds, immediateFeedback } = parsed.data;

  // Verify every question id exists
  const existing = db
    .select({ id: questions.id })
    .from(questions)
    .where(inArray(questions.id, questionIds))
    .all();
  const existingSet = new Set(existing.map((q) => q.id));
  const missing = questionIds.filter((id) => !existingSet.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Unknown question ids: ${missing.slice(0, 5).join(", ")}` },
      { status: 400 },
    );
  }

  const quizId = randomUUID();
  const now = new Date().toISOString();

  const tx = sqlite.transaction(() => {
    db.insert(quizzes).values({
      id: quizId,
      documentId: null,
      title,
      settings: {
        questionCount: questionIds.length,
        allowedTypes: ["mcq-single", "mcq-multi", "true-false"],
        immediateFeedback: immediateFeedback ?? true,
      },
      provider: "bank",
      model: "bank",
      createdAt: now,
      userId: null,
    }).run();

    db.insert(quizQuestions).values(
      questionIds.map((questionId, idx) => ({
        quizId,
        questionId,
        idx,
      })),
    ).run();
  });
  tx();

  return NextResponse.json({
    quizId,
    questionCount: questionIds.length,
  });
}
