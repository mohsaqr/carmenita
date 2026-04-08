"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Question } from "@/types";

/**
 * Single row in the question bank list. Used by both the flat list view
 * and the grouped accordion view on the bank page. Purely presentational
 * — all state (selected, expanded) and actions (select/delete/variations)
 * are injected via props so the parent owns the source of truth.
 *
 * Wrapped in React.memo so a click on one row doesn't re-render every
 * other row in the bank. For this to actually help, the parent MUST pass
 * STABLE callback references — i.e. `useCallback` for each of the four
 * handlers, which take the question's id / the question object as the
 * first argument instead of closing over it inline. See bank/page.tsx
 * and BankGroupedView.tsx for the stable-callback pattern.
 *
 * Lifted out of `src/app/bank/page.tsx` so the grouped view
 * (`BankGroupedView`) can reuse it without duplication.
 */
export interface QuestionRowProps {
  question: Question;
  selected: boolean;
  expanded: boolean;
  variationCount: number;
  parent: Question | null;
  /** Called with the row's question id. Should be a stable reference. */
  onSelect: (id: string) => void;
  /** Called with the row's question id. Should be a stable reference. */
  onToggleExpand: (id: string) => void;
  /** Called with the row's question id. Should be a stable reference. */
  onDelete: (id: string) => void;
  /** Called with the row's Question object. Should be a stable reference. */
  onGenerateVariations: (q: Question) => void;
}

function QuestionRowImpl({
  question,
  selected,
  expanded,
  variationCount,
  parent,
  onSelect,
  onToggleExpand,
  onDelete,
  onGenerateVariations,
}: QuestionRowProps) {
  const correctIdx = question.correctAnswer;
  // These are intentionally NOT memoized per render — they're thin
  // closures over stable props, and React.memo's bailout only checks
  // the props above, not these local wrappers.
  const handleSelect = () => onSelect(question.id);
  const handleToggleExpand = () => onToggleExpand(question.id);
  const handleDelete = () => onDelete(question.id);
  const handleGenerateVariations = () => onGenerateVariations(question);
  return (
    <div className={cn("py-3 transition-colors", selected && "bg-primary/5")}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={handleSelect}
          className="h-4 w-4 mt-1.5 shrink-0"
          aria-label="Select question"
        />
        <div className="flex-1 min-w-0 cursor-pointer" onClick={handleToggleExpand}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className="text-xs capitalize">
              {question.type.replace("mcq-", "")}
            </Badge>
            <DifficultyBadge difficulty={question.difficulty} />
            <Badge variant="outline" className="text-xs capitalize">
              {question.bloomLevel}
            </Badge>
            {question.subject && (
              <Badge className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 hover:bg-blue-500/20">
                {question.subject}
              </Badge>
            )}
            {question.lesson && (
              <Badge className="text-xs bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 hover:bg-purple-500/20">
                {question.lesson}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {question.topic}
            </Badge>
            {(question.tags ?? []).map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                #{t}
              </Badge>
            ))}
            <Badge variant="outline" className="text-xs opacity-70">
              {question.sourceType}
              {question.variationType ? ` · ${question.variationType}` : ""}
            </Badge>
            {variationCount > 0 && (
              <Badge className="text-xs">
                <GitBranch className="h-3 w-3" />
                {variationCount} variation{variationCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium line-clamp-2">{question.question}</p>
          {parent && (
            <p className="text-xs text-muted-foreground italic mt-0.5 line-clamp-1">
              variation of: &ldquo;{parent.question.slice(0, 70)}
              {parent.question.length > 70 ? "…" : ""}&rdquo;
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleGenerateVariations}
          title="Generate variations"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete from bank">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 ml-7 space-y-2 text-sm">
          <ol className="space-y-1">
            {question.options.map((opt, i) => {
              const isCorrect = Array.isArray(correctIdx)
                ? correctIdx.includes(i)
                : correctIdx === i;
              return (
                <li
                  key={i}
                  className={cn(
                    "rounded border px-3 py-1.5 flex items-center gap-2",
                    isCorrect && "border-green-600 bg-green-500/10 font-medium",
                  )}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <span>{opt}</span>
                  {isCorrect && <span className="text-xs text-green-700 dark:text-green-400">✓</span>}
                </li>
              );
            })}
          </ol>
          {question.explanation && (
            <div className="rounded-md border bg-muted/30 p-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Explanation</p>
              <p className="text-sm">{question.explanation}</p>
            </div>
          )}
          {question.sourcePassage && (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
              &ldquo;{question.sourcePassage}&rdquo;
            </blockquote>
          )}
          {question.sourceLabel && (
            <p className="text-xs text-muted-foreground">
              Source: <span className="font-mono">{question.sourceLabel}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized public export. React.memo does a shallow prop equality check;
 * combined with stable `useCallback` handlers in the parent, this means
 * a click on any single row only re-renders THAT row (because only its
 * `selected` or `expanded` prop changed), not all N rows in the bank.
 *
 * For a bank of ~500 questions, this is the difference between a
 * 400-500ms re-render on every checkbox click and a <5ms one.
 */
export const QuestionRow = memo(QuestionRowImpl);

function DifficultyBadge({ difficulty }: { difficulty: "easy" | "medium" | "hard" }) {
  const className =
    difficulty === "easy"
      ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
      : difficulty === "medium"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30";
  return (
    <Badge variant="outline" className={cn("text-xs capitalize", className)}>
      {difficulty}
    </Badge>
  );
}
