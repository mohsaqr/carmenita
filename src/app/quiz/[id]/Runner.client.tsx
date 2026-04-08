"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QuestionCard } from "@/components/quiz/QuestionCard";
import { useQuizRunner } from "@/hooks/useQuizRunner";
import type { Quiz, Question } from "@/types";

/**
 * Quiz-taking client component. Loads the quiz, starts an attempt,
 * runs the quiz runner state machine, submits on finish, and redirects
 * to results.
 *
 * The server wrapper in `page.tsx` extracts the `id` from the URL
 * params (needed for `generateStaticParams`) and passes it as a prop,
 * so this component stays "use client"-safe without calling `use()`.
 */
export default function Runner({ id }: { id: string }) {
  const router = useRouter();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local selection buffer: null = nothing selected for current question
  const [pendingSelection, setPendingSelection] = useState<number | number[] | null>(null);

  const runner = useQuizRunner(questions);

  // Load quiz + start attempt
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const qRes = await fetch(`/api/quizzes/${id}`);
        if (!qRes.ok) throw new Error(`Quiz not found (${qRes.status})`);
        const qData = await qRes.json();
        if (cancelled) return;
        setQuiz(qData.quiz);
        setQuestions(qData.questions);

        const aRes = await fetch("/api/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quizId: id }),
        });
        if (!aRes.ok) {
          const errBody = await aRes.json();
          throw new Error(errBody.error || `Failed to start attempt (${aRes.status})`);
        }
        const aData = await aRes.json();
        if (cancelled) return;
        setAttemptId(aData.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSubmit = useCallback(async () => {
    if (!attemptId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: runner.answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Submit failed (${res.status})`);
      // Navigate to the query-param results shell so the same static
      // page works for every (quizId, attemptId) pair — attemptIds
      // are runtime and can't be pre-rendered.
      router.push(`/quiz/results?quizId=${id}&attemptId=${attemptId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
    }
  }, [attemptId, runner.answers, router, id]);

  // When runner finishes (last question answered + next), submit
  useEffect(() => {
    if (!runner.finished || !attemptId || submitting) return;
    void handleSubmit();
  }, [runner.finished, attemptId, submitting, handleSubmit]);

  // Reset pending selection when moving to a new question
  useEffect(() => {
    setPendingSelection(null);
  }, [runner.index]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-destructive font-medium">{error}</p>
        <Link href="/" className="text-sm text-muted-foreground underline mt-2 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!quiz || !attemptId || questions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        Loading quiz…
      </div>
    );
  }

  if (submitting || runner.finished) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        Scoring your attempt…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight truncate">{quiz.title}</h1>
            <p className="text-xs text-muted-foreground">
              Question {runner.index + 1} of {runner.total}
            </p>
          </div>
          <Link href="/">
            <Button variant="ghost" size="sm">
              Exit
            </Button>
          </Link>
        </div>
        <Progress value={runner.progress * 100} />
      </header>

      {runner.question && (
        <QuestionCard
          question={runner.question}
          index={runner.index}
          total={runner.total}
          selected={runner.revealed ? (runner.currentAnswer?.userAnswer ?? null) : pendingSelection}
          revealed={runner.revealed}
          onSelect={setPendingSelection}
          onSubmit={() => runner.submitAnswer(pendingSelection)}
        />
      )}

      {/* Persistent nav. Always visible so the user can browse/skip
          without being forced to answer. If the user HAS answered,
          they see "Next →"; otherwise "Skip →". On the final question
          the Next button becomes "Finish" and triggers the submit. */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="outline"
          size="lg"
          onClick={runner.previous}
          disabled={runner.index === 0}
        >
          <ArrowLeft className="h-4 w-4" />
          Previous
        </Button>
        <div className="text-xs text-muted-foreground tabular-nums">
          {runner.index + 1} / {runner.total}
        </div>
        <Button
          size="lg"
          onClick={runner.next}
          variant={runner.revealed ? "default" : "secondary"}
        >
          {runner.index + 1 === runner.total ? (
            <>
              <Flag className="h-4 w-4" />
              Finish quiz
            </>
          ) : runner.revealed ? (
            <>
              Next
              <ArrowRight className="h-4 w-4" />
            </>
          ) : (
            <>
              Skip
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
