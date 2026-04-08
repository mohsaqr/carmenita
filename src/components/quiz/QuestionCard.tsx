"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, NotebookPen, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Question } from "@/types";

/**
 * Renders one question. Supports mcq-single, mcq-multi, and true-false.
 * In immediate-feedback mode the parent sets `revealed=true` after the
 * user submits, and we highlight correct/incorrect options with
 * explanation + source citation.
 */
export interface QuestionCardProps {
  question: Question;
  index: number;
  total: number;
  selected: number | number[] | null;
  revealed: boolean;
  onSelect: (answer: number | number[] | null) => void;
  onSubmit: () => void;
}

export function QuestionCard({
  question,
  index,
  total,
  selected,
  revealed,
  onSelect,
  onSubmit,
}: QuestionCardProps) {
  const isMulti = question.type === "mcq-multi";
  const correct = question.correctAnswer;

  const isOptionSelected = (i: number): boolean => {
    if (selected === null) return false;
    if (Array.isArray(selected)) return selected.includes(i);
    return selected === i;
  };

  const isOptionCorrect = (i: number): boolean => {
    if (Array.isArray(correct)) return correct.includes(i);
    return correct === i;
  };

  const handleClick = (i: number) => {
    if (revealed) return;
    if (isMulti) {
      const curr = Array.isArray(selected) ? selected : [];
      const next = curr.includes(i) ? curr.filter((x) => x !== i) : [...curr, i];
      onSelect(next);
    } else {
      onSelect(i);
    }
  };

  const canSubmit =
    selected !== null &&
    (!Array.isArray(selected) || selected.length > 0) &&
    !revealed;

  // Determine if the user's final answer is correct (used when revealed)
  const userIsCorrect = (() => {
    if (selected === null) return false;
    if (isMulti) {
      if (!Array.isArray(selected) || !Array.isArray(correct)) return false;
      if (selected.length !== correct.length) return false;
      return selected.every((v) => correct.includes(v));
    }
    if (typeof selected !== "number" || typeof correct !== "number") return false;
    return selected === correct;
  })();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Question {index + 1} of {total}
          </span>
          <div className="flex items-center gap-1.5">
            <DifficultyBadge difficulty={question.difficulty} />
            <Badge variant="outline" className="text-xs capitalize">
              {question.bloomLevel}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {question.topic}
            </Badge>
          </div>
        </div>
        <h2 className="text-lg font-medium mt-3 leading-relaxed">
          {question.question}
        </h2>
        {isMulti && !revealed && (
          <p className="text-xs text-muted-foreground">Select all that apply.</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {question.options.map((opt, i) => {
            const selectedNow = isOptionSelected(i);
            const correctOpt = isOptionCorrect(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => handleClick(i)}
                disabled={revealed}
                className={cn(
                  "w-full rounded-md border px-4 py-3 text-left text-sm transition-colors",
                  !revealed && "hover:bg-accent hover:border-primary/50 cursor-pointer",
                  !revealed && selectedNow && "border-primary bg-primary/5",
                  revealed && correctOpt && "border-green-600 bg-green-500/10",
                  revealed && !correctOpt && selectedNow && "border-red-600 bg-red-500/10",
                  revealed && !correctOpt && !selectedNow && "opacity-60",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs text-muted-foreground mt-0.5">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <span className="flex-1">{opt}</span>
                  {revealed && correctOpt && (
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                  )}
                  {revealed && !correctOpt && selectedNow && (
                    <X className="h-4 w-4 text-red-600 shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {!revealed && (
          <Button onClick={onSubmit} disabled={!canSubmit} className="w-full">
            Submit answer
          </Button>
        )}

        {revealed && (
          <div className="space-y-3 pt-2">
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                userIsCorrect
                  ? "border-green-600/40 bg-green-500/10"
                  : "border-red-600/40 bg-red-500/10",
              )}
            >
              <div className="flex items-center gap-2 font-medium mb-1">
                {userIsCorrect ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" /> Correct
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-red-600" /> Not quite
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{question.explanation}</p>
            </div>
            {question.sourcePassage && (
              <blockquote className="border-l-4 border-muted-foreground/30 pl-3 text-xs italic text-muted-foreground">
                &ldquo;{question.sourcePassage}&rdquo;
              </blockquote>
            )}
          </div>
        )}

        <NotesSection
          questionId={question.id}
          initialNotes={question.notes ?? ""}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Per-question study notes. Loads the existing note from the question
 * row and persists changes to the bank via PATCH
 * /api/bank/questions/[id]. Saves on blur (when the textarea loses
 * focus) — no debouncing/auto-save, so the network traffic is bounded
 * by how often the user switches question.
 *
 * The note is stored on the question row itself, so it follows the
 * question across quizzes (same question appearing in multiple quizzes
 * shares its note).
 */
function NotesSection({
  questionId,
  initialNotes,
}: {
  questionId: string;
  initialNotes: string;
}) {
  const [value, setValue] = useState(initialNotes);
  const [lastSaved, setLastSaved] = useState(initialNotes);
  const [saving, setSaving] = useState(false);

  // Re-sync when the parent swaps to a different question
  useEffect(() => {
    setValue(initialNotes);
    setLastSaved(initialNotes);
  }, [questionId, initialNotes]);

  const dirty = value !== lastSaved;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/bank/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      setLastSaved(value);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5 pt-3 border-t">
      <div className="flex items-center justify-between">
        <label
          htmlFor={`note-${questionId}`}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <NotebookPen className="h-3.5 w-3.5" />
          Your notes
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {saving ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </span>
          ) : dirty ? (
            "Unsaved"
          ) : lastSaved ? (
            "Saved"
          ) : (
            ""
          )}
        </span>
      </div>
      <Textarea
        id={`note-${questionId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        placeholder="Jot anything about this question — mnemonics, context, why you got it wrong, links. Saved automatically when you click away."
        rows={3}
        className="text-sm resize-y min-h-[72px]"
      />
    </div>
  );
}

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
