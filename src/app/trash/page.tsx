"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Trash2, Inbox, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /trash — soft-deleted quizzes, with Restore and Permanent Delete.
 *
 * A "trashed" quiz keeps all its attempts, answers, and question-link
 * rows intact. Restoring is cheap (flips `deleted_at` back to NULL).
 * Permanent deletion cascades away the quiz row and its attempts,
 * but never the bank questions themselves.
 */

interface TrashedQuiz {
  id: string;
  title: string;
  deletedAt: string;
  createdAt: string;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
  documentFilename: string | null;
}

export default function TrashPage() {
  const [rows, setRows] = useState<TrashedQuiz[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trash");
      if (!res.ok) throw new Error(`Failed to load trash (${res.status})`);
      const data = (await res.json()) as { quizzes: TrashedQuiz[] };
      setRows(data.quizzes);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load trash",
      );
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestore(id: string, title: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/trash/${id}`, { method: "POST" });
      if (!res.ok) throw new Error(`Restore failed (${res.status})`);
      toast.success(`Restored "${title}"`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  }

  async function handlePermanentDelete(id: string, title: string) {
    const confirmed = confirm(
      `Permanently delete "${title}"? This removes the quiz, all its attempts and answers. The bank questions will NOT be touched. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/trash/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Permanent delete failed (${res.status})`);
      toast.success(`Permanently deleted "${title}"`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Permanent delete failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Trash</h1>
        <p className="text-muted-foreground">
          Deleted quizzes land here. Restore any to bring it back to the
          dashboard with all its attempts intact, or permanently delete it
          to free up the row. Bank questions are never touched by quiz
          deletion.
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              Trash is empty
            </CardTitle>
            <CardDescription>
              Quizzes you delete will appear here. Nothing has been
              soft-deleted yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className="underline underline-offset-2 text-sm">
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      )}

      {rows !== null && rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rows.length} quiz{rows.length === 1 ? "" : "zes"} in trash
            </CardTitle>
            <CardDescription>
              Click Restore to bring a quiz back, or Permanent to remove it
              forever.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {rows.map((q) => {
                const deletedAt = new Date(q.deletedAt);
                return (
                  <div
                    key={q.id}
                    className="flex items-center gap-3 py-3 flex-wrap"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{q.title}</span>
                        <Badge variant="secondary" className="text-xs">
                          {q.questionCount} Qs
                        </Badge>
                        {q.attemptCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {q.attemptCount} trial
                            {q.attemptCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {q.bestScore !== null && (
                          <Badge className="text-xs">
                            best {Math.round(q.bestScore * 100)}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        deleted {deletedAt.toLocaleString()}
                        {q.documentFilename && ` · from ${q.documentFilename}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void handleRestore(q.id, q.title)}
                        disabled={busy === q.id}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void handlePermanentDelete(q.id, q.title)
                        }
                        disabled={busy === q.id}
                      >
                        <Trash2 className="h-4 w-4" />
                        Permanent
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Permanent deletion also removes all attempts and answers for
                that quiz. Questions in the bank are always preserved.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
