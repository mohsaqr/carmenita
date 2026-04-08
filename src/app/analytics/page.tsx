"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/analytics/StatsCard";
import { BreakdownBars } from "@/components/analytics/BreakdownBars";
import type {
  TopicStat,
  DifficultyStat,
  BloomStat,
  Overview,
  SlowestQuestion,
} from "@/lib/analytics";

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topics, setTopics] = useState<TopicStat[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyStat[]>([]);
  const [bloom, setBloom] = useState<BloomStat[]>([]);
  const [slowest, setSlowest] = useState<SlowestQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [ov, t, d, b, s] = await Promise.all([
          fetch("/api/analytics/overview").then((r) => r.json()),
          fetch("/api/analytics/topics").then((r) => r.json()),
          fetch("/api/analytics/difficulty").then((r) => r.json()),
          fetch("/api/analytics/bloom").then((r) => r.json()),
          fetch("/api/analytics/slowest?limit=5").then((r) => r.json()),
        ]);
        setOverview(ov);
        setTopics(t.topics ?? []);
        setDifficulty(d.difficulty ?? []);
        setBloom(b.bloom ?? []);
        setSlowest(s.slowest ?? []);
      } finally {
        setLoading(false);
      }
    }
    void fetchAll();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Aggregated performance across every quiz and attempt.
        </p>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {overview && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatsCard label="Quizzes" value={overview.quizCount} />
          <StatsCard label="Attempts" value={overview.attemptCount} />
          <StatsCard label="Documents" value={overview.documentCount} />
          <StatsCard
            label="Avg score"
            value={
              overview.avgScore !== null
                ? `${Math.round(overview.avgScore * 100)}%`
                : "—"
            }
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By difficulty</CardTitle>
            <CardDescription>How you do on easy vs hard questions.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={difficulty.map((d) => ({
                label: d.difficulty,
                total: d.total,
                correct: d.correct,
                rate: d.rate,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By Bloom&apos;s taxonomy level</CardTitle>
            <CardDescription>Remember → Create pyramid.</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={bloom.map((b) => ({
                label: b.bloomLevel,
                total: b.total,
                correct: b.correct,
                rate: b.rate,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By topic</CardTitle>
          <CardDescription>
            Topics with the lowest accuracy are your weakest areas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BreakdownBars
            rows={topics.map((t) => ({
              label: t.topic,
              total: t.total,
              correct: t.correct,
              rate: t.rate,
            }))}
          />
        </CardContent>
      </Card>

      {slowest.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Slowest questions</CardTitle>
            <CardDescription>
              Top questions by average answer time — these are the ones you spent the most effort on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {slowest.map((q) => (
              <div key={q.questionId} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="line-clamp-1 flex-1">{q.question}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {(q.avgMs / 1000).toFixed(1)}s · {q.answered}×
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
