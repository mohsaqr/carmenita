"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Inline dashboard picker: choose a slice of the bank (subject / topic /
 * difficulty / count) and start a quiz in one click. No intermediate
 * screens. Used inside the "Take an exam" dashboard card.
 *
 * Lives in the card body, so it stays intentionally compact: two columns
 * of selects, then a count input, then a prominent full-width start
 * button. Empty-bank state replaces the whole form with "create or
 * import" prompts.
 */

interface Taxonomy {
  subjects: string[];
  lessons: string[];
  topics: string[];
  tags: string[];
}

const ANY_VALUE = "__any__";

export function ExamPickerCard() {
  const router = useRouter();

  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  const [subject, setSubject] = useState<string>(ANY_VALUE);
  const [topic, setTopic] = useState<string>(ANY_VALUE);
  const [difficulty, setDifficulty] = useState<string>(ANY_VALUE);
  const [count, setCount] = useState<number>(10);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bank/taxonomy");
        if (!res.ok) throw new Error(`Taxonomy load failed (${res.status})`);
        const data = (await res.json()) as Taxonomy;
        if (!cancelled) setTaxonomy(data);
      } catch (err) {
        if (!cancelled) {
          setTaxonomyError(
            err instanceof Error ? err.message : "Failed to load taxonomy",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Bank is "empty" only when every taxonomy axis has zero entries. A
   * bank with untagged questions still has topics (topic is required),
   * so this check is effectively "no topic rows at all".
   */
  const bankIsEmpty = useMemo(() => {
    if (!taxonomy) return false;
    return (
      taxonomy.subjects.length === 0 &&
      taxonomy.lessons.length === 0 &&
      taxonomy.topics.length === 0 &&
      taxonomy.tags.length === 0
    );
  }, [taxonomy]);

  async function handleStart() {
    // Build the request body, omitting any "__any__" selections so the
    // server treats them as unconstrained. Count is always sent.
    const body: Record<string, unknown> = { count };
    if (subject !== ANY_VALUE) body.subject = subject;
    if (topic !== ANY_VALUE) body.topic = topic;
    if (difficulty !== ANY_VALUE) body.difficulty = difficulty;

    // Derive a display title that mirrors the server's default but
    // lets the user see the filter context in their quiz list later.
    const titleParts: string[] = ["Quick exam"];
    if (subject !== ANY_VALUE) titleParts.push(`— ${subject}`);
    if (topic !== ANY_VALUE) titleParts.push(`/ ${topic}`);
    if (difficulty !== ANY_VALUE) titleParts.push(`(${difficulty})`);
    body.title = titleParts.join(" ");

    setLoading(true);
    try {
      const res = await fetch("/api/bank/quick-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 404) {
        toast.error(
          data?.error ?? "No questions matched those filters.",
          {
            description:
              "Try broadening your filters or import more questions.",
          },
        );
        return;
      }
      if (!res.ok) {
        toast.error(data?.error ?? `Failed to start exam (${res.status})`);
        return;
      }
      if (!data?.quizId) {
        toast.error("Server returned no quiz id.");
        return;
      }
      router.push(`/quiz/${data.quizId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start exam",
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────
  if (taxonomy === null && !taxonomyError) {
    return (
      <p className="text-sm text-muted-foreground">Loading your bank…</p>
    );
  }

  // ── Taxonomy fetch error ───────────────────────────────────────────
  if (taxonomyError) {
    return (
      <p className="text-sm text-destructive">{taxonomyError}</p>
    );
  }

  // ── Empty bank ─────────────────────────────────────────────────────
  if (bankIsEmpty) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your bank is empty. Create questions or import some first.
        </p>
        <div className="flex gap-2">
          <Link href="/create" className="flex-1">
            <Button variant="default" className="w-full">
              Create
            </Button>
          </Link>
          <Link href="/import" className="flex-1">
            <Button variant="outline" className="w-full">
              Import
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Normal picker form ─────────────────────────────────────────────
  const subjects = taxonomy!.subjects;
  // Filter topics by selected subject if we have enough info. The
  // taxonomy endpoint returns flat lists without parent links, so we
  // fall back to the full topic list when no subject is selected.
  // (A more granular filter would require an extra request; keeping
  // it simple here because the picker is meant to be quick.)
  const topics = taxonomy!.topics;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="exam-picker-subject" className="text-xs">
            Subject
          </Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="exam-picker-subject" className="w-full">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exam-picker-topic" className="text-xs">
            Topic
          </Label>
          <Select value={topic} onValueChange={setTopic}>
            <SelectTrigger id="exam-picker-topic" className="w-full">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any</SelectItem>
              {topics.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="exam-picker-difficulty" className="text-xs">
            Difficulty
          </Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger id="exam-picker-difficulty" className="w-full">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any</SelectItem>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exam-picker-count" className="text-xs">
            Questions
          </Label>
          <Input
            id="exam-picker-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => {
              const raw = Number(e.target.value);
              if (Number.isNaN(raw)) return;
              // Clamp into the API-accepted range so the server never
              // has to reject on count alone.
              const clamped = Math.max(1, Math.min(50, Math.floor(raw)));
              setCount(clamped);
            }}
          />
        </div>
      </div>

      <Button
        className="w-full"
        onClick={handleStart}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting…
          </>
        ) : (
          "Start exam"
        )}
      </Button>
    </div>
  );
}
