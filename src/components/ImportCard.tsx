"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * ImportCard — paste-and-import UI for GIFT / Aiken / Markdown MCQ files.
 *
 * Shared between the `/bank` page (for ad-hoc imports into the bank)
 * and the `/create` page (as the "Import" tab of the unified creation
 * hub). The two callers differ only in what they do with the imported
 * ids in the success handler:
 *
 *   - /bank    : just reload the list
 *   - /create  : offer to navigate to /bank?ids=...&action=explain|retag
 *                so the user can enhance the freshly-imported set
 *
 * The `onImported` callback receives `{ count, ids, warnings }` so the
 * caller can decide how to route the follow-up flow.
 */

export type ImportFormat = "markdown" | "gift" | "aiken";

export interface ImportResult {
  count: number;
  ids: string[];
  warnings: string[];
}

export interface ImportCardProps {
  onImported: (result: ImportResult) => void;
}

const IMPORT_PLACEHOLDERS: Record<ImportFormat, string> = {
  markdown: `## Q1
**Type:** mcq-single
**Difficulty:** easy
**Bloom:** remember
**Topic:** european capitals

**Question:** What is the capital of France?

- [ ] Berlin
- [x] Paris
- [ ] London
- [ ] Madrid

**Explanation:** Paris has been the capital of France since 987 AD.
**Source:** "Paris is the capital and most populous city of France."`,
  gift: `$CATEGORY: european capitals

::Capital of France:: What is the capital of France? {
\t~Berlin
\t=Paris
\t~London
\t~Madrid
}####Paris has been the capital of France since 987 AD.`,
  aiken: `What is the capital of France?
A. Berlin
B. Paris
C. London
D. Madrid
ANSWER: B`,
};

export function ImportCard({ onImported }: ImportCardProps) {
  const [format, setFormat] = useState<ImportFormat>("markdown");
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    if (!text.trim()) {
      toast.error("Paste some text first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bank/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          text,
          sourceLabel: sourceLabel || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || `Import failed (${res.status})`;
        const warnings =
          Array.isArray(data.warnings) && data.warnings.length > 0
            ? `\n\nWarnings:\n${data.warnings.slice(0, 3).join("\n")}`
            : "";
        throw new Error(msg + warnings);
      }
      toast.success(
        `Imported ${data.imported} questions` +
          (data.warnings?.length > 0 ? ` (${data.warnings.length} warnings)` : ""),
      );
      setText("");
      setSourceLabel("");
      onImported({
        count: data.imported ?? 0,
        ids: Array.isArray(data.ids) ? data.ids : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    const fileText = await file.text();
    setText(fileText);
    if (!sourceLabel) setSourceLabel(file.name);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          <CardTitle>Import questions</CardTitle>
        </div>
        <CardDescription>
          Paste Markdown, Moodle GIFT, or Moodle Aiken text here. Or upload a
          file. <strong>Markdown is recommended</strong> — it&apos;s what Carmenita&apos;s
          chatbot prompts produce and supports all metadata (difficulty,
          Bloom level, topic, explanation, source citation).{" "}
          <strong>Aiken does not support feedback</strong> — imported Aiken
          questions will have empty explanations, which you can fill in
          afterward with the <em>Explain</em> bank action.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="markdown">Markdown (recommended)</SelectItem>
                <SelectItem value="gift">Moodle GIFT</SelectItem>
                <SelectItem value="aiken">Moodle Aiken</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label htmlFor="source">Source label (optional)</Label>
            <Input
              id="source"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. biology-final-2025.gift"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Or upload file</Label>
            <Input
              type="file"
              accept=".txt,.gift,.aiken,.md,.markdown,.text"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder={IMPORT_PLACEHOLDERS[format]}
        />
        <div className="flex items-center justify-end">
          <Button onClick={handleImport} disabled={busy || !text.trim()}>
            {busy ? "Importing…" : "Import into bank"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
