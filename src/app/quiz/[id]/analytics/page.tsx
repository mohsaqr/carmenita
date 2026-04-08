"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatsCard } from "@/components/analytics/StatsCard";
import { ImprovementChart } from "@/components/analytics/ImprovementChart";
import { BreakdownBars } from "@/components/analytics/BreakdownBars";
import type {
  ImprovementPoint,
  TopicStat,
  DifficultyStat,
  BloomStat,
} from "@/lib/analytics";

export default function QuizAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: quizId } = use(params);

  const [quiz, setQuiz] = useState<{ title: string } | null>(null);
  const [curve, setCurve] = useState<ImprovementPoint[]>([]);
  const [topics, setTopics] = useState<TopicStat[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyStat[]>([]);
  const [bloom, setBloom] = useState<BloomStat[]>([]);

  useEffect(() => {
    async function load() {
      const [qRes, cRes, tRes, dRes, bRes] = await Promise.all([
        fetch(`/api/quizzes/${quizId}`).then((r) => r.json()),
        fetch(`/api/analytics/improvement/${quizId}`).then((r) => r.json()),
        fetch(`/api/analytics/topics?quizId=${quizId}`).then((r) => r.json()),
        fetch(`/api/analytics/difficulty?quizId=${quizId}`).then((r) => r.json()),
        fetch(`/api/analytics/bloom?quizId=${quizId}`).then((r) => r.json()),
      ]);
      setQuiz(qRes.quiz ? { title: qRes.quiz.title } : null);
      setCurve(cRes.curve ?? []);
      setTopics(tRes.topics ?? []);
      setDifficulty(dRes.difficulty ?? []);
      setBloom(bRes.bloom ?? []);
    }
    void load();
  }, [quizId]);

  const best =
    curve.length > 0 ? Math.max(...curve.map((p) => p.score)) : null;
  const latest = curve.length > 0 ? curve[curve.length - 1].score : null;
  const improvement =
    curve.length > 1 ? curve[curve.length - 1].score - curve[0].score : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Quiz analytics</p>
          <h1 className="text-2xl font-bold tracking-tight">{quiz?.title ?? "…"}</h1>
        </div>
        <Link href={`/quiz/${quizId}`}>
          <Button>Retake quiz</Button>
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatsCard
          label="Trials"
          value={curve.length}
          sublabel={curve.length === 0 ? "No attempts yet" : undefined}
        />
        <StatsCard
          label="Best score"
          value={best !== null ? `${Math.round(best * 100)}%` : "—"}
        />
        <StatsCard
          label="Latest"
          value={latest !== null ? `${Math.round(latest * 100)}%` : "—"}
          sublabel={
            improvement !== null
              ? `${improvement >= 0 ? "+" : ""}${Math.round(improvement * 100)}% since first`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Improvement over trials</CardTitle>
          <CardDescription>
            Score for each retake in chronological order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImprovementChart points={curve} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By topic</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle>By difficulty</CardTitle>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By Bloom&apos;s taxonomy level</CardTitle>
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
  );
}
