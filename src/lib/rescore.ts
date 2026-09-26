import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { answers, attempts, questions, quizQuestions, quizzes } from "@/db/schema";
import { getSetting } from "@/lib/settings-store";
import {
  resolveScoringMethod,
  scoreQuestion,
  SCORING_SETTING_KEY,
  SERVER_DEFAULT_SCORING,
} from "@/lib/scoring";

/**
 * Re-score a user's FINISHED attempts with the scoring method currently
 * in effect (quiz override > account default > UMCH).
 *
 * Called whenever the method changes, so past results always reflect the
 * current choice: flip the setting and every result, list, best score and
 * analytics figure follows. Answers store exactly what was picked, so no
 * information is lost — re-scoring back restores the earlier numbers.
 *
 * `quizId` limits it to one quiz (a per-quiz override changed). Returns
 * the number of attempts re-scored. Only this user's attempts are read or
 * written.
 */
export function rescoreAttempts(userId: string, opts: { quizId?: string } = {}): number {
  const accountDefault = getSetting(userId, SCORING_SETTING_KEY);
  const rows = db
    .select({ id: attempts.id, quizId: attempts.quizId, settings: quizzes.settings })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .where(
      and(
        eq(attempts.userId, userId),
        isNotNull(attempts.completedAt),
        ...(opts.quizId ? [eq(attempts.quizId, opts.quizId)] : []),
      ),
    )
    .all();
  if (rows.length === 0) return 0;

  // Questions of every affected quiz, loaded once.
  const quizIds = [...new Set(rows.map((r) => r.quizId))];
  const qRows = db
    .select({
      quizId: quizQuestions.quizId,
      id: questions.id,
      type: questions.type,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
    })
    .from(quizQuestions)
    .innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .where(inArray(quizQuestions.quizId, quizIds))
    .all();
  const byQuiz = new Map<string, Map<string, (typeof qRows)[number]>>();
  qRows.forEach((q) => {
    const m = byQuiz.get(q.quizId) ?? new Map();
    m.set(q.id, q);
    byQuiz.set(q.quizId, m);
  });

  db.transaction((tx) => {
    rows.forEach((attempt) => {
      const method = resolveScoringMethod(attempt.settings?.scoringMethod, accountDefault, SERVER_DEFAULT_SCORING);
      const quizQs = byQuiz.get(attempt.quizId) ?? new Map();
      const given = tx.select().from(answers).where(eq(answers.attemptId, attempt.id)).all();
      const earned = given.reduce((sum, a) => {
        const q = quizQs.get(a.questionId);
        const points = q ? scoreQuestion(method, q.type, q.correctAnswer, a.userAnswer, q.options.length) : 0;
        tx.update(answers)
          .set({ points, isCorrect: points === 1 })
          .where(and(eq(answers.attemptId, attempt.id), eq(answers.questionId, a.questionId)))
          .run();
        return sum + points;
      }, 0);
      // Same definition as on submit: average over ALL quiz questions.
      const total = quizQs.size;
      tx.update(attempts)
        .set({ score: total > 0 ? earned / total : 0, scoringMethod: method })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.userId, userId)))
        .run();
    });
  });
  return rows.length;
}
