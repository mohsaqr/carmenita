import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, Copy } from "lucide-react";
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
  onMetadataChange: (patch: Partial<MetadataValues>) => void;
  importText: string;
  importSourceLabel: string;
  onImportTextChange: (text: string) => void;
  onImportSourceLabelChange: (label: string) => void;
  onImported: (result: ImportResult) => void;
}

export function PromptAndImport({
  format,
  metadata,
  onMetadataChange,
  importText,
  importSourceLabel,
  onImportTextChange,
  onImportSourceLabelChange,
  onImported,
}: PromptAndImportProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);

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
    <div className="space-y-4">
      {/* ── Prompt section: metadata + copy + collapsible preview ── */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">1. Copy this prompt to your chatbot</h3>
          <div className="flex items-center gap-2">
            <Button onClick={handleCopy} variant="outline" size="sm">
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy prompt
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPrompt((v) => !v)}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showPrompt ? "rotate-180" : ""}`}
              />
              {showPrompt ? "Hide" : "Preview"}
            </Button>
          </div>
        </div>

        {/* Customize prompt details — collapsed */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
          />
          Customize prompt (topic, source material, number of questions)
        </button>
        {showDetails && (
          <div className="space-y-3 pt-1">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="wiz-n">Questions</Label>
                <Input
                  id="wiz-n"
                  type="number"
                  min="1"
                  max="50"
                  value={metadata.n}
                  onChange={(e) => onMetadataChange({ n: parseInt(e.target.value, 10) || 10 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiz-subject">Subject</Label>
                <Input
                  id="wiz-subject"
                  value={metadata.subject}
                  onChange={(e) => onMetadataChange({ subject: e.target.value })}
                  placeholder="biology"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiz-lesson">Lesson</Label>
                <Input
                  id="wiz-lesson"
                  value={metadata.lesson}
                  onChange={(e) => onMetadataChange({ lesson: e.target.value })}
                  placeholder="photosynthesis"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiz-topic">Topic</Label>
                <Input
                  id="wiz-topic"
                  value={metadata.topic}
                  onChange={(e) => onMetadataChange({ topic: e.target.value })}
                  placeholder="light reactions"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiz-source">Source material (optional)</Label>
              <Textarea
                id="wiz-source"
                value={metadata.source}
                onChange={(e) => onMetadataChange({ source: e.target.value })}
                rows={3}
                placeholder="Paste your notes, textbook excerpt, or article here."
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        {showPrompt && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            {prompt}
          </pre>
        )}

        {/* How this works — collapsed */}
        <button
          type="button"
          onClick={() => setShowHowTo((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showHowTo ? "rotate-180" : ""}`}
          />
          How this works
        </button>
        {showHowTo && (
          <ol className="list-decimal list-inside space-y-0.5 text-xs text-muted-foreground pl-1">
            <li>Click <strong>Copy prompt</strong> above — the full prompt goes to your clipboard.</li>
            <li>Paste it into ChatGPT / Claude / Gemini / any other chatbot.</li>
            <li>
              If you didn&apos;t fill in <strong>Source material</strong> earlier,
              replace the placeholder at the bottom of the prompt.
            </li>
            <li>Send the prompt. The chatbot will produce formatted questions.</li>
            <li>Copy the chatbot&apos;s output and paste it below.</li>
          </ol>
        )}
      </div>

      {/* ── Import: full width ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">2. Paste the chatbot&apos;s output here</h3>

        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary">{FORMAT_DESCRIPTIONS[format].label}</Badge>
          <div className="space-y-1.5 flex-1 min-w-[200px]">
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
          rows={14}
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
