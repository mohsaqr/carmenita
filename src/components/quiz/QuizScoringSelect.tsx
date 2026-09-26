"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isScoringMethod, SCORING_LABELS, SCORING_METHODS, type ScoringMethod } from "@/lib/scoring";

export interface ScoringInfo {
  /** Method in effect for this quiz. */
  method: ScoringMethod;
  /** This quiz's own override, or null = follows the account default. */
  override: ScoringMethod | null;
  accountDefault: ScoringMethod;
}

const ACCOUNT_DEFAULT = "__account_default__";

/**
 * "Scoring" picker for one quiz (runner header and results page).
 * Changing it saves the quiz's override AND re-scores the quiz's finished
 * attempts, so results can be compared across methods by switching.
 *
 * Pass `initial` when the parent already has the quiz's scoring info;
 * otherwise it is fetched. Renders nothing in the static build if the
 * quiz response carries no scoring info.
 */
export function QuizScoringSelect({
  quizId,
  initial,
  onChanged,
}: {
  quizId: string;
  initial?: ScoringInfo | null;
  onChanged?: (scoring: ScoringInfo, rescored: number) => void;
}) {
  const [scoring, setScoring] = useState<ScoringInfo | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch(`/api/quizzes/${quizId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { scoring?: ScoringInfo } | null) => {
        if (!cancelled && data?.scoring && isScoringMethod(data.scoring.method)) setScoring(data.scoring);
      })
      .catch(() => {
        // Quiz gone (e.g. deleted) — no picker, results still render.
      });
    return () => {
      cancelled = true;
    };
  }, [quizId, initial]);

  const change = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/quizzes/${quizId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scoringMethod: value === ACCOUNT_DEFAULT ? null : value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Could not change scoring (${res.status})`);
        setScoring(data.scoring);
        const n: number = data.rescored ?? 0;
        toast.success(
          `Scoring: ${SCORING_LABELS[data.scoring.method as ScoringMethod].name}` +
            (n > 0 ? ` — re-scored ${n} finished attempt${n === 1 ? "" : "s"}` : ""),
        );
        onChanged?.(data.scoring, n);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change scoring");
      } finally {
        setBusy(false);
      }
    },
    [quizId, onChanged],
  );

  if (!scoring) return null;
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="hidden sm:inline text-xs text-muted-foreground">Scoring</span>
      <Select value={scoring.override ?? ACCOUNT_DEFAULT} onValueChange={(v) => void change(v)} disabled={busy}>
        <SelectTrigger size="sm" className="w-60" aria-label="Scoring method for this quiz">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ACCOUNT_DEFAULT}>Default: {SCORING_LABELS[scoring.accountDefault].name}</SelectItem>
          {SCORING_METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              {SCORING_LABELS[m].name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
