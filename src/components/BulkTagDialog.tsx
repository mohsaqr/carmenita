"use client";

import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tags, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Dialog for bulk-assigning subject/lesson/topic/tags to multiple
 * selected bank questions. Supports:
 *   • Set subject (null/empty = clear)
 *   • Set lesson (null/empty = clear)
 *   • Set topic (non-empty required if provided)
 *   • Add tags (chip input)
 *   • Remove tags (chip input)
 *
 * Datalists populate from /api/bank/taxonomy for autocomplete.
 */
export function BulkTagDialog({
  selectedIds,
  open,
  onOpenChange,
  onUpdated,
}: {
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (count: number) => void;
}) {
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");
  const [topic, setTopic] = useState("");
  const [addTagsStr, setAddTagsStr] = useState("");
  const [removeTagsStr, setRemoveTagsStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [taxonomy, setTaxonomy] = useState<{
    subjects: string[];
    lessons: string[];
    topics: string[];
    tags: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/bank/taxonomy")
      .then((r) => r.json())
      .then(setTaxonomy)
      .catch(() => setTaxonomy({ subjects: [], lessons: [], topics: [], tags: [] }));
  }, [open]);

  // Reset inputs when the dialog opens
  useEffect(() => {
    if (open) {
      setSubject("");
      setLesson("");
      setTopic("");
      setAddTagsStr("");
      setRemoveTagsStr("");
    }
  }, [open]);

  async function handleApply() {
    const body: Record<string, unknown> = { ids: selectedIds };
    // Only include fields the user actually touched. Empty string means
    // "clear" (explicit null); undefined means "leave as is".
    if (subject.trim() !== "") body.subject = subject.trim();
    if (lesson.trim() !== "") body.lesson = lesson.trim();
    if (topic.trim() !== "") body.topic = topic.trim();
    const add = parseTagCsv(addTagsStr);
    const remove = parseTagCsv(removeTagsStr);
    if (add.length > 0) body.addTags = add;
    if (remove.length > 0) body.removeTags = remove;

    if (
      body.subject === undefined &&
      body.lesson === undefined &&
      body.topic === undefined &&
      body.addTags === undefined &&
      body.removeTags === undefined
    ) {
      toast.error("Fill in at least one field");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/bank/questions/bulk-tag", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Bulk tag failed (${res.status})`);
      }
      toast.success(`Updated ${data.updated} question${data.updated === 1 ? "" : "s"}`);
      onUpdated(data.updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            <DialogTitle>Tag {selectedIds.length} question{selectedIds.length === 1 ? "" : "s"}</DialogTitle>
          </div>
          <DialogDescription>
            Assign subject, lesson, topic, or tags to every selected question.
            Leave any field blank to leave it unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <datalist id="subject-options">
            {taxonomy?.subjects.map((s) => <option key={s} value={s} />)}
          </datalist>
          <datalist id="lesson-options">
            {taxonomy?.lessons.map((l) => <option key={l} value={l} />)}
          </datalist>
          <datalist id="topic-options">
            {taxonomy?.topics.map((t) => <option key={t} value={t} />)}
          </datalist>
          <datalist id="tag-options">
            {taxonomy?.tags.map((t) => <option key={t} value={t} />)}
          </datalist>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-subject">Subject</Label>
              <Input
                id="bulk-subject"
                list="subject-options"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. biology"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-lesson">Lesson</Label>
              <Input
                id="bulk-lesson"
                list="lesson-options"
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                placeholder="e.g. photosynthesis"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-topic">Topic</Label>
            <Input
              id="bulk-topic"
              list="topic-options"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. light reactions"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-add-tags">Add tags (comma-separated)</Label>
            <Input
              id="bulk-add-tags"
              value={addTagsStr}
              onChange={(e) => setAddTagsStr(e.target.value)}
              placeholder="chlorophyll, pigments"
            />
            <TagPreview tags={parseTagCsv(addTagsStr)} variant="add" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-remove-tags">Remove tags (comma-separated)</Label>
            <Input
              id="bulk-remove-tags"
              value={removeTagsStr}
              onChange={(e) => setRemoveTagsStr(e.target.value)}
              placeholder="old-tag"
            />
            <TagPreview tags={parseTagCsv(removeTagsStr)} variant="remove" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying…
              </>
            ) : (
              `Apply to ${selectedIds.length}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseTagCsv(s: string): string[] {
  return s
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function TagPreview({ tags, variant }: { tags: string[]; variant: "add" | "remove" }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map((t) => (
        <Badge
          key={t}
          variant={variant === "add" ? "default" : "destructive"}
          className="text-xs"
        >
          {variant === "remove" && <X className="h-3 w-3" />}
          {t}
        </Badge>
      ))}
    </div>
  );
}
