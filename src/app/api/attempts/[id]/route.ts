import { NextRequest, NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { attempts, answers, questions, quizQuestions, quizzes } from "@/db/schema";
import { getSetting } from "@/lib/settings-store";
import { resolveScoringMethod, scoreQuestion, SCORING_SETTING_KEY, SERVER_DEFAULT_SCORING } from "@/lib/scoring";
import { SubmitAttemptSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/attempts/[id] — fetch an attempt with its answers joined to
 * the questions (through the quiz_questions junction). Used by the
 * results page.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { id } = await context.params;

  const attempt = db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, id), eq(attempts.userId, userId)))
    .get();
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
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
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

  const attempt = db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, id), eq(attempts.userId, userId)))
    .get();
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  if (attempt.completedAt) {
    return NextResponse.json(
      { error: "Attempt is already submitted" },
      { status: 409 },
    );
  }

  // Scoring method: the quiz's override, else the account default from
  // Settings, else UMCH. Recorded on the attempt so results always show
  // how it was scored, even if the setting changes later.
  const quizRow = db.select({ settings: quizzes.settings }).from(quizzes).where(eq(quizzes.id, attempt.quizId)).get();
  const scoringMethod = resolveScoringMethod(
    quizRow?.settings?.scoringMethod,
    getSetting(userId, SCORING_SETTING_KEY),
    SERVER_DEFAULT_SCORING,
  );

  // Load the quiz's questions through the junction
  const quizQuestionRows = db
    .select({
      id: questions.id,
      type: questions.type,
      options: questions.options,
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
    const points = q
      ? scoreQuestion(scoringMethod, q.type, q.correctAnswer, submitted.userAnswer, q.options.length)
      : 0;
    return {
      attemptId: id,
      questionId: submitted.questionId,
      userAnswer: submitted.userAnswer,
      // "Correct" = full marks; partial credit lives in `points`.
      isCorrect: points === 1,
      points,
      timeMs: submitted.timeMs,
    };
  });

  // Score = average fraction over ALL quiz questions (unanswered ones
  // count 0), so it stays comparable with older attempts.
  const total = quizQuestionRows.length;
  const correct = scoredAnswers.filter((a) => a.isCorrect).length;
  const earned = scoredAnswers.reduce((sum, a) => sum + a.points, 0);
  const score = total > 0 ? earned / total : 0;

  const tx = sqlite.transaction(() => {
    db.insert(answers).values(scoredAnswers).run();
    db.update(attempts)
      .set({ completedAt: now, score, scoringMethod })
      .where(eq(attempts.id, id))
      .run();
  });
  tx();

  return NextResponse.json({
    attemptId: id,
    score,
    correct,
    total,
    scoringMethod,
    // Exam-style totals: points out of 10 per question.
    pointsEarned: Math.round(earned * 100) / 10,
    maxPoints: total * 10,
    completedAt: now,
    answers: scoredAnswers,
  });
}
