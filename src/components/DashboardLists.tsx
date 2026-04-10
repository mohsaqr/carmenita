"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface QuizRow {
  id: string;
  title: string;
  documentFilename: string;
  provider: string;
  model: string;
  createdAt: string;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
  lastAttemptAt: string | null;
}

interface Overview {
  quizCount: number;
  attemptCount: number;
  documentCount: number;
  avgScore: number | null;
}

export function DashboardLists() {
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    void fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [qRes, oRes] = await Promise.all([
        fetch("/api/quizzes"),
        fetch("/api/analytics/overview"),
      ]);
      if (!qRes.ok) throw new Error(`Failed to list quizzes (${qRes.status})`);
      if (!oRes.ok) throw new Error(`Failed to load overview (${oRes.status})`);
      const qData = await qRes.json();
      const oData = await oRes.json();
      setQuizzes(qData.quizzes);
      setOverview(oData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this quiz and all its attempts? This cannot be undone.")) return;
    const res = await fetch(`/api/quizzes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Quiz deleted");
    void fetchAll();
  }

  return (
    <div className="space-y-6">
      {overview && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatTile
            label="Quizzes"
            value={overview.quizCount}
            href="#quizzes-list"
          />
          <StatTile
            label="Attempts"
            value={overview.attemptCount}
            href="/attempts"
          />
          <StatTile
            label="Documents"
            value={overview.documentCount}
            href="/create"
          />
          <StatTile
            label="Avg score"
            value={
              overview.avgScore != null && Number.isFinite(overview.avgScore)
                ? `${Math.round(overview.avgScore * 100)}%`
                : "—"
            }
            href="/analytics"
          />
        </div>
      )}

      <Card id="quizzes-list">
        <CardHeader>
          <CardTitle>Your quizzes</CardTitle>
          <CardDescription>
            Past quizzes and their history — retake any to improve your score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quizzes === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {quizzes && quizzes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t taken any quizzes yet. Pick a subject above and start one,
              or create one from a document.
            </p>
          )}
          {quizzes && quizzes.length > 0 && (
            <div className="divide-y">
              {quizzes.map((q) => (
                <div key={q.id} className="flex items-center gap-4 py-3">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/quiz?id=${q.id}`}
                        className="font-medium hover:underline truncate"
                      >
                        {q.title}
                      </Link>
                      <Badge variant="secondary" className="text-xs">
                        {q.questionCount} Qs
                      </Badge>
                      {q.attemptCount > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {q.attemptCount} trial{q.attemptCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {q.bestScore !== null && (
                        <Badge className="text-xs">
                          best {Math.round(q.bestScore * 100)}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      from {q.documentFilename} · {q.provider}/{q.model}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/quiz?id=${q.id}`}>
                      <Button variant="default" size="sm">
                        Retake
                      </Button>
                    </Link>
                    <Link href={`/quiz/analytics?id=${q.id}`}>
                      <Button variant="ghost" size="sm">
                        Analytics
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(q.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg transition hover:ring-2 hover:ring-ring focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <Card className="hover:bg-accent/30 transition">
        <CardContent className="p-4">
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
            {label}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
