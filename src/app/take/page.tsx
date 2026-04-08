"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  BloomLevel,
  Difficulty,
  Question,
  QuestionType,
} from "@/types";

/**
 * /take — dedicated take-quiz surface with faceted filtering.
 *
 * Clicking any chip gives IMMEDIATE visible feedback via:
 *   1. Pool summary count update in the right column
 *   2. The matching-questions preview list re-renders below it
 *   3. The chip itself highlights, and an "active filters" strip at the
 *      top shows a removable × for each selected filter
 *
 * Filter axes:
 *   - lessons   (e.g., Lecture 1..14) — primary axis, shown first
 *   - topics    (125+ fine-grained topics, scrollable)
 *   - difficulty (easy/medium/hard)
 *   - Bloom level (6 levels)
 *   - question type (single/multi/true-false)
 *
 * Axes whose values collapse to one option in the current bank are
 * hidden (e.g., Subject filter disappears when there's only "genetics").
 *
 * On Start, we pre-shuffle client-side, slice to `count`, and POST
 * candidate ids to `/api/bank/quick-quiz` which handles the persist.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const BLOOMS: BloomLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];
const TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: "mcq-single", label: "Single" },
  { value: "mcq-multi", label: "Multi" },
  { value: "true-false", label: "True / False" },
];
const DEFAULT_COUNT = 10;
const MIN_COUNT = 1;
const MAX_COUNT = 2000;
const PREVIEW_LIMIT = 50;

// ─── Local types ────────────────────────────────────────────────────────────

interface QuizHistoryRow {
  id: string;
  title: string;
  documentFilename: string | null;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

// ─── Label formatters ───────────────────────────────────────────────────────

/**
 * Format a slug like `heredity-and-variability` into a displayable
 * label `Heredity and variability`. Keeps lower-case except for the
 * first character, so "dna-structure" becomes "Dna structure" — fine
 * for our domain. Replaces hyphens with spaces.
 */
function formatSlug(s: string): string {
  if (!s) return s;
  const spaced = s.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Sort lessons numerically (lecture-1, lecture-2, ..., lecture-14)
 * rather than lexicographically (which would put lecture-10 before
 * lecture-2).
 */
function lessonNumber(lesson: string): number {
  const m = lesson.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function formatLesson(lesson: string): string {
  return formatSlug(lesson).replace(/^Lecture /i, "Lecture ");
}

/**
 * Given a pool size and a 1-based start index + requested count,
 * return the effective number of questions the exam will contain.
 * Used to compute the label on the Start button so it never lies
 * about what the range-slice will actually deliver.
 */
function sliceSize(poolLen: number, fromIdx: number, count: number): number {
  if (poolLen === 0) return 0;
  const start = Math.max(0, Math.min(poolLen - 1, fromIdx - 1));
  const end = Math.min(poolLen, start + count);
  return Math.max(0, end - start);
}

// ─── Filter-chip primitive (inline, scoped to this page) ────────────────────

function FilterChip({
  label,
  active,
  count,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <span className="truncate max-w-[16rem]">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            "tabular-nums text-[10px]",
            active ? "opacity-80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Page component ─────────────────────────────────────────────────────────

export default function TakeQuizPage() {
  const router = useRouter();

  const [allQuestions, setAllQuestions] = useState<Question[] | null>(null);
  const [history, setHistory] = useState<QuizHistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selLessons, setSelLessons] = useState<Set<string>>(new Set());
  const [selTopics, setSelTopics] = useState<Set<string>>(new Set());
  const [selDifficulties, setSelDifficulties] = useState<Set<Difficulty>>(
    new Set(),
  );
  const [selBlooms, setSelBlooms] = useState<Set<BloomLevel>>(new Set());
  const [selTypes, setSelTypes] = useState<Set<QuestionType>>(new Set());
  const [count, setCount] = useState<number>(DEFAULT_COUNT);
  const [fromIdx, setFromIdx] = useState<number>(1); // 1-based start index into the (possibly shuffled) pool
  const [shuffle, setShuffle] = useState<boolean>(true);
  const [starting, setStarting] = useState<boolean>(false);

  // ── Initial parallel loads ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qRes, hRes] = await Promise.all([
          fetch("/api/bank/questions?limit=2000"),
          fetch("/api/quizzes"),
        ]);
        if (!qRes.ok) throw new Error(`Bank load failed (${qRes.status})`);
        if (!hRes.ok) throw new Error(`History load failed (${hRes.status})`);
        const qData = (await qRes.json()) as { questions: Question[] };
        const hData = (await hRes.json()) as { quizzes: QuizHistoryRow[] };
        if (cancelled) return;
        setAllQuestions(qData.questions);
        setHistory(hData.quizzes);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load take-quiz data",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived: distinct values and counts per axis ──────────────────────────

  const { lessonChips, topicChips, uniqueTypes, uniqueBlooms } = useMemo(() => {
    if (!allQuestions) {
      return {
        lessonChips: [] as string[],
        topicChips: [] as string[],
        uniqueTypes: new Set<QuestionType>(),
        uniqueBlooms: new Set<BloomLevel>(),
      };
    }

    const lessonFreq = new Map<string, number>();
    const topicFreq = new Map<string, number>();
    const typ = new Set<QuestionType>();
    const bl = new Set<BloomLevel>();

    for (const q of allQuestions) {
      if (q.lesson) lessonFreq.set(q.lesson, (lessonFreq.get(q.lesson) ?? 0) + 1);
      if (q.topic) topicFreq.set(q.topic, (topicFreq.get(q.topic) ?? 0) + 1);
      typ.add(q.type);
      bl.add(q.bloomLevel);
    }

    const lessons = [...lessonFreq.keys()].sort(
      (a, b) => lessonNumber(a) - lessonNumber(b),
    );
    const topics = [...topicFreq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label]) => label);

    return {
      lessonChips: lessons,
      topicChips: topics,
      uniqueTypes: typ,
      uniqueBlooms: bl,
    };
  }, [allQuestions]);

  // ── Filter predicate + matching pool ──────────────────────────────────────

  const matchesFilters = useCallback(
    (q: Question): boolean => {
      if (selLessons.size > 0 && !(q.lesson && selLessons.has(q.lesson))) {
        return false;
      }
      if (selTopics.size > 0 && !(q.topic && selTopics.has(q.topic))) {
        return false;
      }
      if (selDifficulties.size > 0 && !selDifficulties.has(q.difficulty)) {
        return false;
      }
      if (selBlooms.size > 0 && !selBlooms.has(q.bloomLevel)) {
        return false;
      }
      if (selTypes.size > 0 && !selTypes.has(q.type)) {
        return false;
      }
      return true;
    },
    [selLessons, selTopics, selDifficulties, selBlooms, selTypes],
  );

  const matchingPool = useMemo(() => {
    if (!allQuestions) return [];
    return allQuestions.filter(matchesFilters);
  }, [allQuestions, matchesFilters]);

  // Count how many questions would still match if one MORE value were
  // toggled on an axis. Used to show a live count next to every chip so
  // the user sees "30" next to "Lecture 1" meaning "clicking this gives
  // you 30 extra questions in the pool".
  const poolCountByLesson = useMemo(() => {
    if (!allQuestions) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const q of allQuestions) {
      // Simulate adding this lesson to selLessons while keeping the
      // other axes as they currently are.
      if (selTopics.size > 0 && !(q.topic && selTopics.has(q.topic))) continue;
      if (selDifficulties.size > 0 && !selDifficulties.has(q.difficulty)) continue;
      if (selBlooms.size > 0 && !selBlooms.has(q.bloomLevel)) continue;
      if (selTypes.size > 0 && !selTypes.has(q.type)) continue;
      if (q.lesson) m.set(q.lesson, (m.get(q.lesson) ?? 0) + 1);
    }
    return m;
  }, [allQuestions, selTopics, selDifficulties, selBlooms, selTypes]);

  const poolCountByTopic = useMemo(() => {
    if (!allQuestions) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const q of allQuestions) {
      if (selLessons.size > 0 && !(q.lesson && selLessons.has(q.lesson))) continue;
      if (selDifficulties.size > 0 && !selDifficulties.has(q.difficulty)) continue;
      if (selBlooms.size > 0 && !selBlooms.has(q.bloomLevel)) continue;
      if (selTypes.size > 0 && !selTypes.has(q.type)) continue;
      if (q.topic) m.set(q.topic, (m.get(q.topic) ?? 0) + 1);
    }
    return m;
  }, [allQuestions, selLessons, selDifficulties, selBlooms, selTypes]);

  // ── Pool breakdown (difficulty counts) for the summary card ──────────────

  const poolBreakdown = useMemo(() => {
    const by: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
    const byLesson = new Map<string, number>();
    for (const q of matchingPool) {
      by[q.difficulty] += 1;
      if (q.lesson) byLesson.set(q.lesson, (byLesson.get(q.lesson) ?? 0) + 1);
    }
    return { by, byLesson };
  }, [matchingPool]);

  // ── Toggle helpers ────────────────────────────────────────────────────────

  function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const resetFilters = () => {
    setSelLessons(new Set());
    setSelTopics(new Set());
    setSelDifficulties(new Set());
    setSelBlooms(new Set());
    setSelTypes(new Set());
    setFromIdx(1);
  };

  const hasActiveFilters =
    selLessons.size +
      selTopics.size +
      selDifficulties.size +
      selBlooms.size +
      selTypes.size >
    0;

  // ── Start exam ────────────────────────────────────────────────────────────

  async function handleStart() {
    if (matchingPool.length === 0) return;

    const working = matchingPool.map((q) => q.id);
    if (shuffle) {
      for (let i = working.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [working[i], working[j]] = [working[j], working[i]];
      }
    }
    // Apply range: take `count` questions starting at position `fromIdx` (1-based).
    // Clamps to pool length so the user can't pick a slice beyond the end.
    const start = Math.max(0, Math.min(working.length - 1, fromIdx - 1));
    const end = Math.min(working.length, start + count);
    const candidateIds = working.slice(start, end);
    if (candidateIds.length === 0) {
      toast.error("Empty slice. Adjust 'From' or 'Count'.");
      return;
    }

    const title = buildTitle({
      selLessons,
      selTopics,
      selDifficulties,
      selBlooms,
      selTypes,
      count: candidateIds.length,
    });

    setStarting(true);
    try {
      const res = await fetch("/api/bank/quick-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          count: candidateIds.length,
          candidateIds,
          shuffle: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.quizId) {
        toast.error(data?.error ?? `Failed to start exam (${res.status})`);
        return;
      }
      router.push(`/quiz/${data.quizId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start exam",
      );
    } finally {
      setStarting(false);
    }
  }

  // ── Render branches ───────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">
              Couldn&apos;t load your bank
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
              Reload page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (allQuestions === null || history === null) {
    return <TakePageSkeleton />;
  }

  if (allQuestions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader />
        <Card>
          <CardHeader>
            <CardTitle>Your bank is empty</CardTitle>
            <CardDescription>
              Add questions before you can take a quiz. Create from a document
              or topic, or import an MCQ file.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Link href="/create" className="flex-1">
              <Button className="w-full">
                <Sparkles className="h-4 w-4" />
                Create questions
              </Button>
            </Link>
            <Link href="/import" className="flex-1">
              <Button variant="outline" className="w-full">
                <Upload className="h-4 w-4" />
                Import MCQs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canStart = matchingPool.length > 0 && !starting;
  const showTypeFilter = uniqueTypes.size > 1;
  const showBloomFilter = uniqueBlooms.size > 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader />

      {/* STICKY ACTION BAR — two rows, always visible.
          Row 1: pool count, active filter chips (removable), Reset
          Row 2: Difficulty quick-chips, Shuffle, From/Count/All, Start exam
          This keeps all the primary controls above the fold and away
          from the sidebar. */}
      <div className="sticky top-0 z-10 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-2">
          {/* Row 1: pool count + active filters + reset */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-2xl font-bold tabular-nums">
                {matchingPool.length}
              </span>
              <span className="text-xs text-muted-foreground">
                {matchingPool.length === 1 ? "question" : "questions"}
                {matchingPool.length > 0 &&
                  ` · ${poolBreakdown.by.easy}e / ${poolBreakdown.by.medium}m / ${poolBreakdown.by.hard}h`}
              </span>
            </div>
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {[...selLessons]
                  .sort((a, b) => lessonNumber(a) - lessonNumber(b))
                  .map((l) => (
                    <ActiveFilterChip
                      key={`lesson:${l}`}
                      label={formatLesson(l)}
                      onRemove={() =>
                        setSelLessons((p) => {
                          const n = new Set(p);
                          n.delete(l);
                          return n;
                        })
                      }
                    />
                  ))}
                {[...selTopics].map((t) => (
                  <ActiveFilterChip
                    key={`topic:${t}`}
                    label={formatSlug(t)}
                    onRemove={() =>
                      setSelTopics((p) => {
                        const n = new Set(p);
                        n.delete(t);
                        return n;
                      })
                    }
                  />
                ))}
                {[...selDifficulties].map((d) => (
                  <ActiveFilterChip
                    key={`diff:${d}`}
                    label={d.charAt(0).toUpperCase() + d.slice(1)}
                    onRemove={() =>
                      setSelDifficulties((p) => {
                        const n = new Set(p);
                        n.delete(d);
                        return n;
                      })
                    }
                  />
                ))}
                {[...selBlooms].map((b) => (
                  <ActiveFilterChip
                    key={`bloom:${b}`}
                    label={b.charAt(0).toUpperCase() + b.slice(1)}
                    onRemove={() =>
                      setSelBlooms((p) => {
                        const n = new Set(p);
                        n.delete(b);
                        return n;
                      })
                    }
                  />
                ))}
                {[...selTypes].map((t) => (
                  <ActiveFilterChip
                    key={`type:${t}`}
                    label={t}
                    onRemove={() =>
                      setSelTypes((p) => {
                        const n = new Set(p);
                        n.delete(t);
                        return n;
                      })
                    }
                  />
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              </div>
            )}
          </div>

          {/* Row 2: Difficulty quick-chips, Shuffle, From/Count/All, Start exam */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Difficulty quick-chips, always shown regardless of bank diversity */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-1">Diff:</span>
              {DIFFICULTIES.map((d) => (
                <FilterChip
                  key={`bar-d:${d}`}
                  label={d.charAt(0).toUpperCase() + d.slice(1)}
                  active={selDifficulties.has(d)}
                  onClick={() =>
                    setSelDifficulties((prev) => toggleInSet(prev, d))
                  }
                />
              ))}
            </div>

            {/* Shuffle toggle */}
            <div className="flex items-center gap-1.5 ml-2">
              <Switch
                id="take-shuffle-bar"
                checked={shuffle}
                onCheckedChange={setShuffle}
              />
              <Label
                htmlFor="take-shuffle-bar"
                className="text-xs cursor-pointer"
              >
                Random
              </Label>
            </div>

            {/* Range + count + start — pinned to the right */}
            <div className="ml-auto flex items-center gap-2">
              <Label
                htmlFor="take-from-bar"
                className="text-xs text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="take-from-bar"
                type="number"
                min={1}
                max={Math.max(1, matchingPool.length)}
                value={fromIdx}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (Number.isNaN(raw)) return;
                  setFromIdx(Math.max(1, Math.floor(raw)));
                }}
                className="h-9 w-16 tabular-nums"
                title="Start from this question index in the pool (1-based)"
              />
              <Label
                htmlFor="take-count-bar"
                className="text-xs text-muted-foreground"
              >
                Count
              </Label>
              <Input
                id="take-count-bar"
                type="number"
                min={MIN_COUNT}
                max={MAX_COUNT}
                value={count}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (Number.isNaN(raw)) return;
                  setCount(
                    Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.floor(raw))),
                  );
                }}
                className="h-9 w-20 tabular-nums"
                title="How many questions to include in the exam"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  setFromIdx(1);
                  setCount(Math.max(MIN_COUNT, matchingPool.length));
                }}
                disabled={matchingPool.length === 0}
                title={`Take all ${matchingPool.length} matching questions from the start`}
              >
                All
              </Button>
              <Button
                size="lg"
                disabled={!canStart}
                onClick={handleStart}
              >
                {starting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <BookOpen className="h-4 w-4" />
                    Start exam ({sliceSize(matchingPool.length, fromIdx, count)} Qs)
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* ── Filter sidebar ───────────────────────────────────────────── */}
        <aside>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Filters</CardTitle>
              <CardDescription>
                Click any chip to toggle. Multi-select on every axis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Lessons — primary axis */}
              {lessonChips.length > 0 && (
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Lecture
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {lessonChips.map((l) => (
                      <FilterChip
                        key={l}
                        label={formatLesson(l)}
                        active={selLessons.has(l)}
                        count={poolCountByLesson.get(l) ?? 0}
                        onClick={() =>
                          setSelLessons((prev) => toggleInSet(prev, l))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Topics — all inline, no inner scroll. Page scroll handles overflow. */}
              {topicChips.length > 0 && (
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Topics ({topicChips.length})
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {topicChips.map((t) => {
                      const c = poolCountByTopic.get(t) ?? 0;
                      return (
                        <FilterChip
                          key={t}
                          label={formatSlug(t)}
                          active={selTopics.has(t)}
                          count={c}
                          title={t}
                          onClick={() =>
                            setSelTopics((prev) => toggleInSet(prev, t))
                          }
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {(showBloomFilter || showTypeFilter) && <Separator />}

              {/* Bloom */}
              {showBloomFilter && (
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Bloom level
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {BLOOMS.filter((b) => uniqueBlooms.has(b)).map((b) => (
                      <FilterChip
                        key={b}
                        label={b.charAt(0).toUpperCase() + b.slice(1)}
                        active={selBlooms.has(b)}
                        onClick={() =>
                          setSelBlooms((prev) => toggleInSet(prev, b))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Type */}
              {showTypeFilter && (
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Type
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {TYPES.filter((t) => uniqueTypes.has(t.value)).map((t) => (
                      <FilterChip
                        key={t.value}
                        label={t.label}
                        active={selTypes.has(t.value)}
                        onClick={() =>
                          setSelTypes((prev) => toggleInSet(prev, t.value))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              <Separator />

              {/* Shuffle only — count lives in the sticky top bar */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="take-shuffle" className="text-xs">
                    Shuffle question order
                  </Label>
                  <Switch
                    id="take-shuffle"
                    checked={shuffle}
                    onCheckedChange={setShuffle}
                  />
                </div>
              </section>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={resetFilters}
                >
                  Reset filters
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* ── Right column: preview + history (Start is in the sticky top bar) ── */}
        <section className="space-y-6 min-w-0">
          {/* Matching questions preview — lets the user SEE the effect */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Matching questions preview
              </CardTitle>
              <CardDescription>
                {matchingPool.length > PREVIEW_LIMIT
                  ? `Showing the first ${PREVIEW_LIMIT} of ${matchingPool.length}.`
                  : matchingPool.length === 0
                    ? "Nothing to preview. Try removing a filter."
                    : `All ${matchingPool.length} shown.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {matchingPool.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Use the chips on the left to add filters. Matching questions
                  will appear here.
                </p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {matchingPool.slice(0, PREVIEW_LIMIT).map((q, i) => (
                    <li
                      key={q.id}
                      className="flex items-start gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                    >
                      <span className="tabular-nums text-xs text-muted-foreground mt-0.5 w-8 shrink-0">
                        {i + 1}.
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-foreground">
                          {q.question}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {q.lesson && (
                            <Badge variant="outline" className="text-[10px]">
                              {formatLesson(q.lesson)}
                            </Badge>
                          )}
                          {q.topic && (
                            <Badge variant="secondary" className="text-[10px]">
                              {formatSlug(q.topic)}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {q.difficulty}
                          </Badge>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-muted-foreground" />
                Your quiz history
              </CardTitle>
              <CardDescription>
                Retake any previous quiz.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You haven&apos;t taken any quizzes yet. Filter above and
                  start one.
                </p>
              ) : (
                <div className="divide-y">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/quiz/${h.id}`}
                            className="font-medium truncate hover:underline"
                          >
                            {h.title}
                          </Link>
                          <Badge variant="secondary" className="text-xs">
                            {h.questionCount} Qs
                          </Badge>
                          {h.attemptCount > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {h.attemptCount} trial
                              {h.attemptCount === 1 ? "" : "s"}
                            </Badge>
                          )}
                          {h.bestScore !== null && (
                            <Badge className="text-xs">
                              best {Math.round(h.bestScore * 100)}%
                            </Badge>
                          )}
                        </div>
                        {h.documentFilename && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            from {h.documentFilename}
                          </p>
                        )}
                      </div>
                      <Link href={`/quiz/${h.id}`} className="shrink-0">
                        <Button size="sm">Retake</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ActiveFilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition"
    >
      <span>{label}</span>
      <X className="h-3 w-3" />
    </button>
  );
}

function PageHeader() {
  return (
    <header className="space-y-1">
      <h1 className="text-3xl font-bold tracking-tight">Take a quiz</h1>
      <p className="text-muted-foreground">
        Click any chip to filter. The preview updates live — tap Start exam
        when you&apos;re happy with the pool.
      </p>
    </header>
  );
}

function TakePageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Skeleton className="h-[28rem]" />
        <div className="space-y-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-80" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}

// ─── Title builder ──────────────────────────────────────────────────────────

function buildTitle(args: {
  selLessons: Set<string>;
  selTopics: Set<string>;
  selDifficulties: Set<Difficulty>;
  selBlooms: Set<BloomLevel>;
  selTypes: Set<QuestionType>;
  count: number;
}): string {
  const parts: string[] = ["Take"];
  const facets: string[] = [];
  if (args.selLessons.size)
    facets.push(
      [...args.selLessons]
        .sort((a, b) => lessonNumber(a) - lessonNumber(b))
        .map(formatLesson)
        .join("+"),
    );
  if (args.selTopics.size)
    facets.push([...args.selTopics].map(formatSlug).join("+"));
  if (args.selDifficulties.size)
    facets.push([...args.selDifficulties].join("+"));
  if (args.selBlooms.size) facets.push([...args.selBlooms].join("+"));
  if (facets.length > 0) parts.push("-", facets.join(" · "));
  parts.push(`x ${args.count}`);
  return parts.join(" ");
}
