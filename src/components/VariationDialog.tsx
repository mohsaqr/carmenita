"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { VARIATION_TYPE_LABELS } from "@/lib/llm-variations";
import type { Question, VariationType } from "@/types";

/**
 * Dialog that lets the student generate N variations of a bank
 * question via the LLM.
 */
export function VariationDialog({
  question,
  open,
  onOpenChange,
  onCreated,
}: {
  question: Question | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (count: number) => void;
}) {
  const provider = useActiveProvider();
  const [variationType, setVariationType] = useState<VariationType>("topic");
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);

  async function handleGenerate() {
    if (!question || !provider) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bank/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          variationType,
          count,
          provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Variation generation failed (${res.status})`);
      }
      toast.success(
        `Generated ${data.created} ${VARIATION_TYPE_LABELS[variationType].label.toLowerCase()}`,
      );
      onCreated(data.created);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <DialogTitle>Generate variations</DialogTitle>
          </div>
          <DialogDescription>
            {question ? (
              <span>
                Creating new questions based on:{" "}
                <span className="italic">&ldquo;{question.question.slice(0, 90)}
                  {question.question.length > 90 ? "…" : ""}&rdquo;</span>
              </span>
            ) : (
              "Select a variation type and count."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!provider && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              No active LLM provider. Open <strong>Settings</strong> to configure one.
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Variation type</Label>
            <Select
              value={variationType}
              onValueChange={(v) => setVariationType(v as VariationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["topic", "distractors", "paraphrase", "harder", "easier"] as const
                ).map((t) => (
                  <SelectItem key={t} value={t}>
                    {VARIATION_TYPE_LABELS[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {VARIATION_TYPE_LABELS[variationType].description}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="count">Number of variations</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 3)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={!provider || !question || busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate {count}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
