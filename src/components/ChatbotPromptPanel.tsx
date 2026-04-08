"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import {
  buildChatbotPrompt,
  FORMAT_DESCRIPTIONS,
  type ChatbotPromptFormat,
} from "@/lib/formats/chatbot-prompts";

/**
 * Panel that lets students generate a ready-to-paste chatbot prompt.
 *
 * Workflow:
 *   1. Student fills in N, topic, and (optionally) pastes source material
 *   2. Clicks one of the three "Copy prompt" buttons
 *   3. Carmenita substitutes placeholders and writes the full prompt to
 *      the clipboard via navigator.clipboard.writeText
 *   4. Student pastes it into ChatGPT/Claude/Gemini/etc.
 *   5. The chatbot produces formatted questions
 *   6. Student copies the chatbot's output back into the Import card
 *
 * The prompt includes a complete worked example + strict rules so even
 * weaker models produce parseable output on the first try.
 */
export function ChatbotPromptPanel() {
  const [n, setN] = useState(10);
  const [topic, setTopic] = useState("");
  const [subject, setSubject] = useState("");
  const [lesson, setLesson] = useState("");
  const [source, setSource] = useState("");
  const [lastCopied, setLastCopied] = useState<ChatbotPromptFormat | null>(null);

  async function handleCopy(format: ChatbotPromptFormat) {
    const prompt = buildChatbotPrompt(format, { n, topic, subject, lesson, source });
    try {
      await navigator.clipboard.writeText(prompt);
      setLastCopied(format);
      toast.success(
        `${FORMAT_DESCRIPTIONS[format].label} prompt copied. Paste it into your chatbot.`,
      );
      // Reset the "copied" indicator after 3 seconds
      setTimeout(() => {
        setLastCopied((c) => (c === format ? null : c));
      }, 3000);
    } catch (err) {
      toast.error(
        `Clipboard write failed: ${err instanceof Error ? err.message : "unknown error"}. Try selecting the text manually.`,
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <CardTitle>Get questions from a chatbot</CardTitle>
        </div>
        <CardDescription>
          Copy one of these prompts into ChatGPT, Claude, Gemini, or any LLM.
          Fill in your source material, send it, then paste the chatbot&apos;s
          output back into the <strong>Import questions</strong> card below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="prompt-n">Number of questions</Label>
            <Input
              id="prompt-n"
              type="number"
              min="1"
              max="50"
              value={n}
              onChange={(e) => setN(parseInt(e.target.value, 10) || 10)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt-subject">Subject</Label>
            <Input
              id="prompt-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="biology"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt-lesson">Lesson</Label>
            <Input
              id="prompt-lesson"
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="photosynthesis"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prompt-topic">Topic</Label>
            <Input
              id="prompt-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="light reactions"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prompt-source">
            Source material (optional — you can also paste it directly into the chatbot after)
          </Label>
          <Textarea
            id="prompt-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={4}
            placeholder="Paste your notes, textbook excerpt, or article here. Leave blank to fill in inside the chatbot."
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2 pt-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Choose a format
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <FormatButton
              format="markdown"
              recommended
              copied={lastCopied === "markdown"}
              onCopy={handleCopy}
            />
            <FormatButton
              format="gift"
              copied={lastCopied === "gift"}
              onCopy={handleCopy}
            />
            <FormatButton
              format="aiken"
              copied={lastCopied === "aiken"}
              onCopy={handleCopy}
            />
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-medium">How this works</p>
          <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
            <li>Click a format above — the full prompt is copied to your clipboard.</li>
            <li>Paste it into ChatGPT / Claude / Gemini / any other chatbot.</li>
            <li>
              If you didn&apos;t fill in <strong>Source material</strong> above, replace the{" "}
              <code className="font-mono">(Paste your notes … here)</code> placeholder at the bottom of the prompt with your actual content.
            </li>
            <li>Send the prompt. The chatbot will produce formatted questions.</li>
            <li>
              Copy the chatbot&apos;s output and paste it into the{" "}
              <strong>Import questions</strong> card below, matching format.
            </li>
            <li>Click <strong>Import into bank</strong>.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function FormatButton({
  format,
  copied,
  recommended,
  onCopy,
}: {
  format: ChatbotPromptFormat;
  copied: boolean;
  recommended?: boolean;
  onCopy: (f: ChatbotPromptFormat) => void;
}) {
  const info = FORMAT_DESCRIPTIONS[format];
  return (
    <button
      type="button"
      onClick={() => onCopy(format)}
      className="text-left rounded-md border p-3 hover:border-primary hover:bg-primary/5 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm">{info.label}</span>
          {recommended && (
            <Badge className="text-[10px] h-4 px-1">Recommended</Badge>
          )}
        </div>
        {copied ? (
          <Check className="h-4 w-4 text-green-600 shrink-0" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{info.long}</p>
    </button>
  );
}
