"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Question, RunnerAnswer } from "@/types";

/**
 * State machine for taking a quiz. Owns:
 *  - which question is currently shown
 *  - the user's answers so far (including per-question time)
 *  - whether the current answer has been revealed (immediate-feedback mode)
 *  - a timer marker so we can compute `timeMs` per question
 *
 * Scoring happens server-side on submit — this hook never decides
 * whether an answer is correct.
 */
export interface QuizRunnerState {
  index: number;
  total: number;
  question: Question | null;
  answers: RunnerAnswer[];
  revealed: boolean;
  finished: boolean;
  progress: number; // 0..1
}

export function useQuizRunner(questions: Question[]) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<RunnerAnswer[]>([]);
  // Lazy init — performance.now() is impure so we can't call it in the
  // render body. Initialize to 0 and set it on the first submitAnswer.
  const timerStart = useRef<number>(0);

  const total = questions.length;
  const question = questions[index] ?? null;
  const finished = index >= total;

  const resetTimer = useCallback(() => {
    timerStart.current = performance.now();
  }, []);

  /** Answer for the current question, if already submitted. */
  const currentAnswer = useMemo(
    () => (question ? answers.find((a) => a.questionId === question.id) ?? null : null),
    [answers, question],
  );

  /**
   * `revealed` is derived: a question is "revealed" iff it has a
   * recorded answer. This means navigating back to a previously
   * answered question shows its stored state automatically, and
   * submitting an answer flips the UI into the feedback state
   * without a separate state variable.
   */
  const revealed = currentAnswer !== null;

  /** Submit an answer for the current question. Does not advance. */
  const submitAnswer = useCallback(
    (userAnswer: number | number[] | null) => {
      if (!question) return;
      // Initialize the timer on first call (lazy — avoids impure calls in render)
      if (timerStart.current === 0) timerStart.current = performance.now();
      const timeMs = Math.round(performance.now() - timerStart.current);
      setAnswers((prev) => {
        // Overwrite if the user is changing their answer on the same question
        const filtered = prev.filter((a) => a.questionId !== question.id);
        return [
          ...filtered,
          { questionId: question.id, userAnswer, timeMs },
        ];
      });
    },
    [question],
  );

  /** Advance to the next question (or finish if at the end). */
  const next = useCallback(() => {
    if (index >= total - 1) {
      setIndex(total); // past the end → finished
      return;
    }
    setIndex((i) => i + 1);
    resetTimer();
  }, [index, total, resetTimer]);

  /** Go back to the previous question (without losing its answer). */
  const previous = useCallback(() => {
    if (index === 0) return;
    setIndex((i) => i - 1);
    resetTimer();
  }, [index, resetTimer]);

  /** Jump directly to a question by index. Used by the minimap/finish button. */
  const jumpTo = useCallback(
    (n: number) => {
      if (n < 0 || n > total) return;
      setIndex(n);
      resetTimer();
    },
    [total, resetTimer],
  );

  /** Restart from the beginning. Clears answers. */
  const restart = useCallback(() => {
    setIndex(0);
    setAnswers([]);
    resetTimer();
  }, [resetTimer]);

  const state: QuizRunnerState = {
    index,
    total,
    question,
    answers,
    revealed,
    finished,
    progress: total > 0 ? Math.min(1, index / total) : 0,
  };

  return {
    ...state,
    currentAnswer,
    submitAnswer,
    next,
    previous,
    jumpTo,
    restart,
  };
}
