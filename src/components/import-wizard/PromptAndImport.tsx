import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  buildChatbotPrompt,
  FORMAT_DESCRIPTIONS,
  type ChatbotPromptFormat,
} from "@/lib/formats/chatbot-prompts";
import { IMPORT_PLACEHOLDERS } from "@/components/ImportCard";
import type { ImportResult } from "@/components/ImportCard";
import type { MetadataValues } from "./MetadataForm";

interface PromptAndImportProps {
  format: ChatbotPromptFormat;
  metadata: MetadataValues;
  importText: string;
  importSourceLabel: string;
  onImportTextChange: (text: string) => void;
  onImportSourceLabelChange: (label: string) => void;
  onImported: (result: ImportResult) => void;
}

export function PromptAndImport({
  format,
  metadata,
  importText,
  importSourceLabel,
  onImportTextChange,
  onImportSourceLabelChange,
  onImported,
}: PromptAndImportProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const prompt = useMemo(
    () => buildChatbotPrompt(format, metadata),
    [format, metadata],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success("Prompt copied. Paste it into your chatbot.");
      setTimeout(() => setCopied((c) => (c ? false : c)), 3000);
    } catch (err) {
      toast.error(
        `Clipboard write failed: ${err instanceof Error ? err.message : "unknown error"}. Try selecting the text manually.`,
      );
    }
  }

  async function handleImport() {
    if (!importText.trim()) {
      toast.error("Paste the chatbot's output first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bank/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          text: importText,
          sourceLabel: importSourceLabel || undefined,
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

  function handleFile(file: File) {
    void file.text().then((text) => {
      onImportTextChange(text);
      if (!importSourceLabel) onImportSourceLabelChange(file.name);
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* ── Left: Generated prompt ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">1. Copy this prompt to your chatbot</h3>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
          {prompt}
        </pre>
        <Button onClick={handleCopy} variant="outline" className="w-full">
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy prompt to clipboard
            </>
          )}
        </Button>

        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-medium">How this works</p>
          <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
            <li>Click the button above — the full prompt is copied to your clipboard.</li>
            <li>Paste it into ChatGPT / Claude / Gemini / any other chatbot.</li>
            <li>
              If you didn&apos;t fill in <strong>Source material</strong> in the
              previous step, replace the placeholder at the bottom of the prompt
              with your actual content.
            </li>
            <li>Send the prompt. The chatbot will produce formatted questions.</li>
            <li>Copy the chatbot&apos;s output and paste it into the panel on the right.</li>
          </ol>
        </div>
      </div>

      {/* ── Right: Import ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">2. Paste the chatbot&apos;s output here</h3>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label>Format</Label>
            <div>
              <Badge variant="secondary">{FORMAT_DESCRIPTIONS[format].label}</Badge>
            </div>
          </div>
          <div className="space-y-1.5 flex-1 min-w-[160px]">
            <Label htmlFor="wiz-source-label">Source label (optional)</Label>
            <Input
              id="wiz-source-label"
              value={importSourceLabel}
              onChange={(e) => onImportSourceLabelChange(e.target.value)}
              placeholder="e.g. biology-final-2025"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Or upload file</Label>
            <Input
              type="file"
              accept=".txt,.gift,.aiken,.md,.markdown,.text"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        </div>

        <Textarea
          value={importText}
          onChange={(e) => onImportTextChange(e.target.value)}
          rows={12}
          className="font-mono text-xs"
          placeholder={IMPORT_PLACEHOLDERS[format]}
        />

        <div className="flex items-center justify-end">
          <Button onClick={handleImport} disabled={busy || !importText.trim()}>
            {busy ? "Importing\u2026" : "Import into bank"}
          </Button>
        </div>
      </div>
    </div>
  );
}
