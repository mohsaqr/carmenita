"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, BookOpen } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /attempts — chronological list of every quiz attempt.
 *
 * Each row is clickable:
 *   • quiz title → /quiz/{quizId}         (retake that quiz)
 *   • "View result" → /quiz/{quizId}/results/{attemptId}
 *
 * Attempts on trashed (soft-deleted) quizzes are excluded at the API
 * level, not here. Restoring a quiz from /trash brings its attempts
 * back into this view automatically.
 */

interface AttemptRow {
  id: string;
  quizId: string;
  quizTitle: string;
  startedAt: string;
  completedAt: string | null;
  score: number | null;
  questionCount: number;
}

export default function AttemptsPage() {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/attempts");
        if (!res.ok) throw new Error(`Failed to load attempts (${res.status})`);
        const data = (await res.json()) as { attempts: AttemptRow[] };
        if (!cancelled) setRows(data.attempts);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Failed to load attempts",
          );
          setRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const completed = rows?.filter((r) => r.completedAt !== null) ?? [];
  const inProgress = rows?.filter((r) => r.completedAt === null) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Your attempts</h1>
        <p className="text-muted-foreground">
          Every quiz attempt you&apos;ve started, sorted by most recent. Click
          any row to view its result or retake the quiz.
        </p>
      </header>

      {rows === null && (
        <Card>
          <CardContent className="space-y-2 p-6">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {rows !== null && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No attempts yet</CardTitle>
            <CardDescription>
              Start a quiz from the dashboard or the{" "}
              <Link href="/take" className="underline">
                take-quiz page
              </Link>{" "}
              and your attempts will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {inProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              In progress ({inProgress.length})
            </CardTitle>
            <CardDescription>
              Attempts you&apos;ve started but haven&apos;t submitted yet.
              Resume by clicking the quiz title.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {inProgress.map((a) => (
                <AttemptRowItem key={a.id} attempt={a} inProgress />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {completed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Completed ({completed.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {completed.map((a) => (
                <AttemptRowItem key={a.id} attempt={a} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AttemptRowItem({
  attempt: a,
  inProgress = false,
}: {
  attempt: AttemptRow;
  inProgress?: boolean;
}) {
  const startedAt = new Date(a.startedAt);
  const completedAt = a.completedAt ? new Date(a.completedAt) : null;

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/quiz/${a.quizId}`}
            className="font-medium hover:underline truncate"
          >
            {a.quizTitle}
          </Link>
          <Badge variant="secondary" className="text-xs">
            {a.questionCount} Qs
          </Badge>
          {a.score !== null && (
            <Badge className="text-xs">
              {Math.round(a.score * 100)}%
            </Badge>
          )}
          {inProgress && (
            <Badge variant="outline" className="text-xs">
              in progress
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          started {startedAt.toLocaleString()}
          {completedAt && ` · completed ${completedAt.toLocaleString()}`}
        </p>
      </div>
      {!inProgress && (
        <Link
          href={`/quiz/${a.quizId}/results/${a.id}`}
          className="shrink-0 text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
        >
          View result
        </Link>
      )}
    </div>
  );
}
