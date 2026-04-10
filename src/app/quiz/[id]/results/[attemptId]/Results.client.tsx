"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Minus, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Attempt, Question, Answer } from "@/types";

interface QuestionWithAnswer extends Question {
  answer: Answer | null;
}

interface AttemptData {
  attempt: Attempt;
  questions: QuestionWithAnswer[];
}

/**
 * Results page for a completed attempt. Shows score, per-question
 * breakdown with explanation + source citation for each wrong answer.
 */
export default function Results({
  quizId,
  attemptId,
}: {
  quizId: string;
  attemptId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<AttemptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retakeWrongBusy, setRetakeWrongBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `Failed to load attempt (${res.status})`);
        }
        const body = await res.json();
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-destructive font-medium">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        Loading results…
      </div>
    );
  }

  const { questions } = data;
  const correctCount = questions.filter((q) => q.answer?.isCorrect).length;
  const skippedCount = questions.filter((q) => q.answer?.userAnswer === null || q.answer?.userAnswer === undefined).length;
  const wrongCount = questions.length - correctCount - skippedCount;
  const total = questions.length;
  const pct = total > 0 ? (correctCount / total) * 100 : 0;
  const missedIds = questions
    .filter((q) => !q.answer?.isCorrect)
    .map((q) => q.id);

  async function handleRetakeMissed() {
    if (missedIds.length === 0) return;
    setRetakeWrongBusy(true);
    try {
      const res = await fetch("/api/bank/quick-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Review missed — ${new Date().toLocaleString()}`,
          count: missedIds.length,
          candidateIds: missedIds,
          immediateFeedback: true,
          shuffle: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      toast.success(`Quiz created with ${body.questionCount} questions to review`);
      router.push(`/quiz?id=${body.quizId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review quiz");
      setRetakeWrongBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Attempt results</p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">{Math.round(pct)}%</h1>
          <span className="text-muted-foreground">
            {correctCount} of {total} correct
            {wrongCount > 0 && <> · <span className="text-red-600">{wrongCount} wrong</span></>}
            {skippedCount > 0 && <> · <span className="text-amber-600">{skippedCount} skipped</span></>}
          </span>
        </div>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/quiz?id=${quizId}`}>
          <Button>Retake all</Button>
        </Link>
        {missedIds.length > 0 && (
          <Button
            variant="secondary"
            onClick={handleRetakeMissed}
            disabled={retakeWrongBusy}
          >
            {retakeWrongBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Retake {missedIds.length} missed
          </Button>
        )}
        <Link href={`/quiz/analytics?id=${quizId}`}>
          <Button variant="outline">Improvement</Button>
        </Link>
        <Link href="/">
          <Button variant="ghost">Dashboard</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionResult key={q.id} question={q} index={i} answer={q.answer} />
        ))}
      </div>
    </div>
  );
}

function QuestionResult({
  question,
  index,
  answer,
}: {
  question: Question;
  index: number;
  answer: Answer | null;
}) {
  const isCorrect = answer?.isCorrect ?? false;
  const userAnswer = answer?.userAnswer ?? null;
  const isSkipped = userAnswer === null || userAnswer === undefined;
  const correct = question.correctAnswer;

  const isOptionSelected = (i: number): boolean => {
    if (userAnswer === null || userAnswer === undefined) return false;
    if (Array.isArray(userAnswer)) return userAnswer.includes(i);
    return userAnswer === i;
  };
  const isOptionCorrect = (i: number): boolean => {
    if (Array.isArray(correct)) return correct.includes(i);
    return correct === i;
  };

  return (
    <Card className={cn(
      isSkipped && "border-amber-500/40",
      !isCorrect && !isSkipped && "border-red-500/30",
    )}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>
              Question {index + 1} · {question.topic} · {question.difficulty}
            </CardDescription>
            <CardTitle className="text-base mt-1 leading-relaxed">
              {question.question}
            </CardTitle>
          </div>
          {isCorrect ? (
            <Badge variant="default" className="shrink-0">
              <Check className="h-3 w-3" /> Correct
            </Badge>
          ) : isSkipped ? (
            <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-600">
              <Minus className="h-3 w-3" /> Skipped
            </Badge>
          ) : (
            <Badge variant="destructive" className="shrink-0">
              <X className="h-3 w-3" /> Wrong
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {question.options.map((opt, i) => {
            const sel = isOptionSelected(i);
            const cor = isOptionCorrect(i);
            return (
              <div
                key={i}
                className={cn(
                  "rounded border px-3 py-2 text-sm",
                  cor && "border-green-600 bg-green-500/10",
                  !cor && sel && "border-red-600 bg-red-500/10",
                  isSkipped && cor && "border-green-600 bg-green-500/10",
                  !cor && !sel && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <span className="flex-1">{opt}</span>
                  {cor && <Check className="h-4 w-4 text-green-600 shrink-0" />}
                  {!cor && sel && <X className="h-4 w-4 text-red-600 shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
            Explanation
          </p>
          <p>{question.explanation}</p>
        </div>
        {question.sourcePassage && (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
            &ldquo;{question.sourcePassage}&rdquo;
          </blockquote>
        )}
        {answer && !isSkipped && (
          <p className="text-xs text-muted-foreground">
            Answered in {(answer.timeMs / 1000).toFixed(1)}s
          </p>
        )}
      </CardContent>
    </Card>
  );
}
