import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { attempts, answers, questions, quizQuestions } from "@/db/schema";
import { SubmitAttemptSchema } from "@/lib/validation";

/**
 * GET /api/attempts/[id] — fetch an attempt with its answers joined to
 * the questions (through the quiz_questions junction). Used by the
 * results page.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const attempt = db.select().from(attempts).where(eq(attempts.id, id)).get();
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  const questionRows = db
    .select({
      id: questions.id,
      type: questions.type,
      question: questions.question,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      explanation: questions.explanation,
      difficulty: questions.difficulty,
      bloomLevel: questions.bloomLevel,
      topic: questions.topic,
      sourcePassage: questions.sourcePassage,
      sourceType: questions.sourceType,
      sourceDocumentId: questions.sourceDocumentId,
      sourceLabel: questions.sourceLabel,
      createdAt: questions.createdAt,
      userId: questions.userId,
      idx: quizQuestions.idx,
    })
    .from(quizQuestions)
    .innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .orderBy(asc(quizQuestions.idx))
    .all();

  const answerRows = db
    .select()
    .from(answers)
    .where(eq(answers.attemptId, id))
    .all();

  const answerMap = new Map(answerRows.map((a) => [a.questionId, a]));
  const merged = questionRows.map((q) => ({
    ...q,
    answer: answerMap.get(q.id) ?? null,
  }));

  return NextResponse.json({ attempt, questions: merged });
}

/**
 * PATCH /api/attempts/[id] — submit answers for a completed attempt.
 *
 * Body: { answers: [{ questionId, userAnswer, timeMs }] }
 *
 * Scoring happens server-side against the stored `correctAnswer` — we
 * never trust a client-provided `isCorrect` field. The attempt is marked
 * `completedAt = now`, `score = correctCount / totalQuestions`.
 *
 * Total questions is the count of rows in `quiz_questions` for this
 * quiz, NOT the length of the submitted answers array.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SubmitAttemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const attempt = db.select().from(attempts).where(eq(attempts.id, id)).get();
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  if (attempt.completedAt) {
    return NextResponse.json(
      { error: "Attempt is already submitted" },
      { status: 409 },
    );
  }

  // Load the quiz's questions through the junction
  const quizQuestionRows = db
    .select({
      id: questions.id,
      type: questions.type,
      correctAnswer: questions.correctAnswer,
    })
    .from(quizQuestions)
    .innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .all();
  const questionMap = new Map(quizQuestionRows.map((q) => [q.id, q]));

  const now = new Date().toISOString();
  const scoredAnswers = parsed.data.answers.map((submitted) => {
    const q = questionMap.get(submitted.questionId);
    if (!q) {
      return {
        attemptId: id,
        questionId: submitted.questionId,
        userAnswer: submitted.userAnswer,
        isCorrect: false,
        timeMs: submitted.timeMs,
      };
    }
    return {
      attemptId: id,
      questionId: submitted.questionId,
      userAnswer: submitted.userAnswer,
      isCorrect: scoreAnswer(q.type, q.correctAnswer, submitted.userAnswer),
      timeMs: submitted.timeMs,
    };
  });

  const total = quizQuestionRows.length;
  const correct = scoredAnswers.filter((a) => a.isCorrect).length;
  const score = total > 0 ? correct / total : 0;

  const tx = sqlite.transaction(() => {
    db.insert(answers).values(scoredAnswers).run();
    db.update(attempts)
      .set({ completedAt: now, score })
      .where(eq(attempts.id, id))
      .run();
  });
  tx();

  return NextResponse.json({
    attemptId: id,
    score,
    correct,
    total,
    completedAt: now,
    answers: scoredAnswers,
  });
}

function scoreAnswer(
  type: "mcq-single" | "mcq-multi" | "true-false",
  correct: number | number[],
  submitted: number | number[] | null,
): boolean {
  if (submitted === null) return false;
  if (type === "mcq-multi") {
    if (!Array.isArray(correct) || !Array.isArray(submitted)) return false;
    if (correct.length !== submitted.length) return false;
    const cSet = new Set(correct);
    return submitted.every((v) => cSet.has(v));
  }
  if (typeof correct !== "number" || typeof submitted !== "number") return false;
  return correct === submitted;
}
