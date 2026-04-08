"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { QuestionType, Difficulty, BloomLevel } from "@/types";

/**
 * Dialog for creating a new bank question manually. Mirrors the fields
 * of PortableQuestion so the form output maps 1:1 to /api/bank/questions
 * POST body.
 *
 * UX:
 *   • Type selector switches the options editor between mcq-single /
 *     mcq-multi (dynamic 2-8 options with radio/checkbox correctness)
 *     and true-false (locked to ["True","False"] with a radio to pick
 *     the correct one).
 *   • Optional subject/lesson inputs pre-fill from defaultSubject/
 *     defaultLesson props, so opening the dialog while a bank filter
 *     is active auto-tags new questions into the right bucket.
 *   • Datalist autocomplete on subject/lesson/topic/tag inputs
 *     populated from /api/bank/taxonomy.
 *   • Save button is disabled until the form is structurally valid
 *     (stem non-empty, >=2 options, correct answer matches type rules).
 */
export function CreateQuestionDialog({
  open,
  onOpenChange,
  onCreated,
  defaultSubject,
  defaultLesson,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  defaultSubject?: string;
  defaultLesson?: string;
}) {
  const [type, setType] = useState<QuestionType>("mcq-single");
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  // For mcq-single and true-false, correct is a number. For mcq-multi,
  // we track it as a Set<number> internally and serialize to number[].
  const [correctSingle, setCorrectSingle] = useState<number>(0);
  const [correctMulti, setCorrectMulti] = useState<Set<number>>(new Set());
  const [explanation, setExplanation] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [bloomLevel, setBloomLevel] = useState<BloomLevel>("understand");
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");
  const [topic, setTopic] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [sourcePassage, setSourcePassage] = useState("");
  const [busy, setBusy] = useState(false);
  const [taxonomy, setTaxonomy] = useState<{
    subjects: string[];
    lessons: string[];
    topics: string[];
    tags: string[];
  }>({ subjects: [], lessons: [], topics: [], tags: [] });

  // Load taxonomy datalists + reset form whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    void fetch("/api/bank/taxonomy")
      .then((r) => r.json())
      .then(setTaxonomy)
      .catch(() => {});

    setType("mcq-single");
    setStem("");
    setOptions(["", "", "", ""]);
    setCorrectSingle(0);
    setCorrectMulti(new Set());
    setExplanation("");
    setDifficulty("medium");
    setBloomLevel("understand");
    setSubject(defaultSubject ?? "");
    setLesson(defaultLesson ?? "");
    setTopic("");
    setTagsStr("");
    setSourcePassage("");
  }, [open, defaultSubject, defaultLesson]);

  // When type changes, snap the options list into a sensible shape
  useEffect(() => {
    if (type === "true-false") {
      setOptions(["True", "False"]);
      setCorrectSingle(0);
      setCorrectMulti(new Set());
    } else if (options.length < 2) {
      setOptions(["", "", "", ""]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Wrapped in useMemo so the reference is stable across renders and
  // the downstream useMemo for formErrors doesn't flag it as a changing dep.
  const effectiveOptions = useMemo(
    () => (type === "true-false" ? ["True", "False"] : options),
    [type, options],
  );

  // Structural validation — used to enable/disable the Save button.
  const formErrors = useMemo(() => {
    const errs: string[] = [];
    if (stem.trim().length < 5) errs.push("Stem must be at least 5 characters");
    if (!topic.trim()) errs.push("Topic is required");
    if (type === "true-false") {
      // Always valid as long as a correct is picked — and correctSingle
      // defaults to 0 which is valid.
    } else {
      const nonEmpty = effectiveOptions.filter((o) => o.trim()).length;
      if (nonEmpty < 2) errs.push("Need at least 2 non-empty options");
      if (type === "mcq-single") {
        if (correctSingle < 0 || correctSingle >= effectiveOptions.length)
          errs.push("Pick a correct answer");
        if (!effectiveOptions[correctSingle]?.trim())
          errs.push("Correct option must be non-empty");
      }
      if (type === "mcq-multi") {
        if (correctMulti.size < 2) errs.push("Multi-answer needs ≥2 correct");
        if (correctMulti.size >= effectiveOptions.length)
          errs.push("At least one option must be wrong");
        for (const idx of correctMulti) {
          if (!effectiveOptions[idx]?.trim())
            errs.push("Every correct option must be non-empty");
        }
      }
    }
    return errs;
  }, [stem, topic, type, effectiveOptions, correctSingle, correctMulti]);

  const canSave = formErrors.length === 0 && !busy;

  function addOption() {
    if (options.length >= 8) return;
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    // Clean up correct-answer selections that pointed at the removed row
    if (type === "mcq-single" && correctSingle >= idx && correctSingle > 0) {
      setCorrectSingle(correctSingle - 1);
    }
    if (type === "mcq-multi") {
      const next = new Set<number>();
      for (const i of correctMulti) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      setCorrectMulti(next);
    }
  }

  function toggleMulti(idx: number) {
    const next = new Set(correctMulti);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setCorrectMulti(next);
  }

  async function handleSave() {
    const correctAnswer: number | number[] =
      type === "mcq-multi"
        ? Array.from(correctMulti).sort((a, b) => a - b)
        : correctSingle;

    const tags = tagsStr
      .split(/[,;]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const body = {
      type,
      question: stem.trim(),
      options: effectiveOptions.map((o) => o.trim()),
      correctAnswer,
      explanation: explanation.trim(),
      difficulty,
      bloomLevel,
      subject: subject.trim() || null,
      lesson: lesson.trim() || null,
      topic: topic.trim(),
      tags,
      sourcePassage: sourcePassage.trim(),
    };

    setBusy(true);
    try {
      const res = await fetch("/api/bank/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data.details)
          ? data.details.map((d: { message?: string }) => d.message).join("; ")
          : "";
        throw new Error(
          data.error + (detail ? `: ${detail}` : "") || `Create failed (${res.status})`,
        );
      }
      toast.success("Question added to bank");
      onCreated(data.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <PencilLine className="h-5 w-5" />
            <DialogTitle>New question</DialogTitle>
          </div>
          <DialogDescription>
            Create a question manually. It will be tagged as{" "}
            <code className="font-mono text-xs">source: manual</code> in the bank.
          </DialogDescription>
        </DialogHeader>

        <datalist id="cq-subjects">
          {taxonomy.subjects.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id="cq-lessons">
          {taxonomy.lessons.map((l) => <option key={l} value={l} />)}
        </datalist>
        <datalist id="cq-topics">
          {taxonomy.topics.map((t) => <option key={t} value={t} />)}
        </datalist>
        <datalist id="cq-tags">
          {taxonomy.tags.map((t) => <option key={t} value={t} />)}
        </datalist>

        <div className="space-y-4 py-2">
          {/* Type + difficulty + bloom */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as QuestionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq-single">MCQ (single answer)</SelectItem>
                  <SelectItem value="mcq-multi">MCQ (multiple answers)</SelectItem>
                  <SelectItem value="true-false">True / False</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <Select
                value={difficulty}
                onValueChange={(v) => setDifficulty(v as Difficulty)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Bloom level</Label>
              <Select
                value={bloomLevel}
                onValueChange={(v) => setBloomLevel(v as BloomLevel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remember">Remember</SelectItem>
                  <SelectItem value="understand">Understand</SelectItem>
                  <SelectItem value="apply">Apply</SelectItem>
                  <SelectItem value="analyze">Analyze</SelectItem>
                  <SelectItem value="evaluate">Evaluate</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Question stem */}
          <div className="space-y-1.5">
            <Label htmlFor="cq-stem">Question</Label>
            <Textarea
              id="cq-stem"
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              placeholder="What is the capital of France?"
              rows={2}
            />
          </div>

          {/* Options */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Options {type === "mcq-multi" && "(check all that apply)"}</Label>
              {type !== "true-false" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addOption}
                  disabled={options.length >= 8}
                >
                  <Plus className="h-4 w-4" />
                  Add option
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {effectiveOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  {type === "mcq-multi" ? (
                    <input
                      type="checkbox"
                      checked={correctMulti.has(i)}
                      onChange={() => toggleMulti(i)}
                      className="h-4 w-4 shrink-0"
                      aria-label={`Mark option ${i + 1} as correct`}
                    />
                  ) : (
                    <input
                      type="radio"
                      name="cq-correct"
                      checked={correctSingle === i}
                      onChange={() => setCorrectSingle(i)}
                      className="h-4 w-4 shrink-0"
                      aria-label={`Mark option ${i + 1} as correct`}
                    />
                  )}
                  <span className="font-mono text-xs text-muted-foreground w-5">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <Input
                    value={opt}
                    onChange={(e) => {
                      if (type === "true-false") return;
                      const next = [...options];
                      next[i] = e.target.value;
                      setOptions(next);
                    }}
                    placeholder={type === "true-false" ? opt : `Option ${String.fromCharCode(65 + i)}`}
                    disabled={type === "true-false"}
                    className={cn(
                      (type === "mcq-multi" ? correctMulti.has(i) : correctSingle === i) &&
                        "border-green-600/60",
                    )}
                  />
                  {type !== "true-false" && options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeOption(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Taxonomy */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cq-subject">Subject</Label>
              <Input
                id="cq-subject"
                list="cq-subjects"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="biology"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cq-lesson">Lesson</Label>
              <Input
                id="cq-lesson"
                list="cq-lessons"
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                placeholder="plant physiology"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cq-topic">
                Topic<span className="text-destructive">*</span>
              </Label>
              <Input
                id="cq-topic"
                list="cq-topics"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="photosynthesis"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cq-tags">Tags (comma-separated)</Label>
            <Input
              id="cq-tags"
              list="cq-tags"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="chlorophyll, light, pigments"
            />
          </div>

          {/* Explanation + source */}
          <div className="space-y-1.5">
            <Label htmlFor="cq-explanation">Explanation</Label>
            <Textarea
              id="cq-explanation"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Why the correct answer is correct."
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cq-source">Source passage (optional)</Label>
            <Textarea
              id="cq-source"
              value={sourcePassage}
              onChange={(e) => setSourcePassage(e.target.value)}
              placeholder="Verbatim quote from the source material."
              rows={2}
            />
          </div>

          {formErrors.length > 0 && (
            <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
              {formErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Add to bank"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
