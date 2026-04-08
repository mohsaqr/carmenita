"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Inbox,
  Loader2,
  PlayCircle,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { ImportCard, type ImportResult } from "@/components/ImportCard";
import { NoProviderWarning } from "@/components/NoProviderWarning";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useAppStore } from "@/lib/store";

/**
 * /import — dedicated import-first hub.
 *
 * This page is front-and-center for pulling pre-made MCQs into Carmenita.
 * It reuses <ImportCard /> for the actual upload/paste flow, then switches
 * to a post-import "what next" screen with four large action cards:
 *
 *   1. Take as-is now        → POST /api/bank/quick-quiz (candidateIds)
 *   2. Add explanations      → POST /api/bank/questions/explain (onlyIfMissing)
 *   3. Add variations        → POST /api/bank/variations-batch
 *   4. Send to bank          → navigate to /bank?ids=<csv>
 *
 * The "Add explanations" action doesn't navigate away — it updates in
 * place so users can chain it with "Take as-is now". Variation generation
 * can take minutes, so it shows a spinner and disables while running.
 *
 * ?from=bank in the URL renders a back-to-bank link for users who deep-
 * linked from the bank page's "Import more" action.
 */

type VariationType = "topic" | "distractors" | "paraphrase" | "harder" | "easier";

const VARIATION_TYPES: { value: VariationType; label: string }[] = [
  { value: "paraphrase", label: "Paraphrase (same meaning, new wording)" },
  { value: "topic", label: "Topic (related concept, same difficulty)" },
  { value: "distractors", label: "Distractors (new wrong answers)" },
  { value: "harder", label: "Harder (increase difficulty)" },
  { value: "easier", label: "Easier (decrease difficulty)" },
];

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportPageInner />
    </Suspense>
  );
}

function ImportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const provider = useActiveProvider();
  const systemSettings = useAppStore((s) => s.systemSettings);

  const fromBank = searchParams.get("from") === "bank";

  const [imported, setImported] = useState<ImportResult | null>(null);
  const [importedLabel, setImportedLabel] = useState<string>("");

  // Per-action state: we need independent loading / success flags so
  // users can run them in any order (explain → then take, etc).
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainResult, setExplainResult] = useState<{
    updated: number;
    skipped: number;
  } | null>(null);

  const [variationType, setVariationType] = useState<VariationType>("paraphrase");
  const [countPerParent, setCountPerParent] = useState(3);
  const [variationsBusy, setVariationsBusy] = useState(false);
  const [variationsResult, setVariationsResult] = useState<{
    created: number;
  } | null>(null);

  const [quickQuizBusy, setQuickQuizBusy] = useState(false);

  const postImportRef = useRef<HTMLDivElement | null>(null);
  const importSectionRef = useRef<HTMLDivElement | null>(null);

  // After a successful import, smooth-scroll down to the action cards so
  // the user doesn't have to hunt for them. Runs once per import event.
  useEffect(() => {
    if (imported && postImportRef.current) {
      postImportRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [imported]);

  function handleImported(result: ImportResult) {
    if (result.count === 0) {
      toast.error("No questions were imported — check the format and try again.");
      return;
    }
    setImported(result);
    setImportedLabel(new Date().toLocaleString());
    // Reset any previous enhance results from a prior import.
    setExplainResult(null);
    setVariationsResult(null);
  }

  function handleImportMore() {
    setImported(null);
    setExplainResult(null);
    setVariationsResult(null);
    // Scroll back to the import section so users can paste/upload again.
    setTimeout(() => {
      importSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  // ── Action 1: Take as-is now ──────────────────────────────────────────

  async function handleTakeAsIs() {
    if (!imported) return;
    setQuickQuizBusy(true);
    try {
      const res = await fetch("/api/bank/quick-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Imported set — ${importedLabel || new Date().toLocaleString()}`,
          count: imported.count,
          candidateIds: imported.ids,
          immediateFeedback: true,
          shuffle: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Quick quiz failed (${res.status})`);
      }
      toast.success(`Built quiz with ${data.questionCount} questions`);
      router.push(`/quiz?id=${data.quizId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
      setQuickQuizBusy(false);
    }
  }

  // ── Action 2: Add explanations ────────────────────────────────────────

  async function handleAddExplanations() {
    if (!imported || !provider) return;
    setExplainBusy(true);
    try {
      const res = await fetch("/api/bank/questions/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: imported.ids,
          provider,
          temperature: systemSettings.temperature ?? 0.3,
          onlyIfMissing: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Explanations failed (${res.status})`);
      }
      setExplainResult({
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
      });
      toast.success(
        `Added explanations: ${data.updated} updated, ${data.skipped} already had one`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
    } finally {
      setExplainBusy(false);
    }
  }

  // ── Action 3: Add variations ──────────────────────────────────────────

  async function handleAddVariations() {
    if (!imported || !provider) return;
    setVariationsBusy(true);
    try {
      const res = await fetch("/api/bank/variations-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentIds: imported.ids,
          variationType,
          countPerParent,
          provider,
          temperature: systemSettings.temperature ?? 0.3,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Variations failed (${res.status})`);
      }
      setVariationsResult({ created: data.created ?? 0 });
      const errorCount = Array.isArray(data.errors) ? data.errors.length : 0;
      toast.success(
        `Created ${data.created} variation${data.created === 1 ? "" : "s"}` +
          (errorCount > 0 ? ` (${errorCount} errors)` : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
    } finally {
      setVariationsBusy(false);
    }
  }

  // ── Action 4: Send to bank ────────────────────────────────────────────

  function handleSendToBank() {
    if (!imported) return;
    const idsParam = encodeURIComponent(imported.ids.join(","));
    router.push(`/bank?ids=${idsParam}`);
  }

  return (
    // suppressHydrationWarning: the ImportCard has form inputs inside
    // a CardContent div, which password-manager extensions (Proton Pass,
    // 1Password, Dashlane) tag with data-* attributes between server
    // render and client hydration. Element-scoped — children still warn
    // normally on real mismatches.
    <div className="mx-auto max-w-5xl space-y-6" suppressHydrationWarning>
      {fromBank && (
        <Link
          href="/bank"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bank
        </Link>
      )}

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-6 w-6" />
          <h1 className="text-2xl font-bold tracking-tight">Import questions</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring existing MCQs into Carmenita from Markdown, Moodle GIFT, or
          Moodle Aiken. After import, you can take them as a quiz right away,
          grow the bank with AI-generated variations, fill in missing
          explanations, or send them straight to the bank.
        </p>
      </header>

      {/* ─────────────── Section 1: Import card ─────────────── */}
      {!imported && (
        <div ref={importSectionRef}>
          <ImportCard onImported={handleImported} />
        </div>
      )}

      {/* ─────────────── Section 2: Post-import actions ─────────────── */}
      {imported && (
        <div ref={postImportRef} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Imported {imported.count} question
                {imported.count === 1 ? "" : "s"}. What next?
              </h2>
              {imported.warnings.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  {imported.warnings.length} warning
                  {imported.warnings.length === 1 ? "" : "s"} during import
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleImportMore}>
              Import more
            </Button>
          </div>

          {!provider && <NoProviderWarning />}

          <div className="grid gap-4 md:grid-cols-2">
            {/* ── 1. Take as-is now ── */}
            <Card className="border-primary/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-5 w-5 text-primary" />
                  <CardTitle>Take as-is now</CardTitle>
                </div>
                <CardDescription>
                  Start a quiz with these questions immediately. They&apos;re
                  already in your bank.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  onClick={handleTakeAsIs}
                  disabled={quickQuizBusy}
                  className="w-full"
                >
                  {quickQuizBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Building quiz…
                    </>
                  ) : (
                    <>
                      Start quiz
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>

            {/* ── 2. Add explanations ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  <CardTitle>Add explanations</CardTitle>
                </div>
                <CardDescription>
                  Generate a 1–2 sentence explanation for any question that&apos;s
                  missing one. Uses your active LLM provider.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {explainResult && (
                  <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Explanations added: {explainResult.updated}
                    {explainResult.skipped > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({explainResult.skipped} already had one)
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  variant="secondary"
                  onClick={handleAddExplanations}
                  disabled={explainBusy || !provider}
                  className="w-full"
                >
                  {explainBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Adding explanations…
                    </>
                  ) : explainResult ? (
                    "Run again"
                  ) : (
                    "Add explanations"
                  )}
                </Button>
              </CardFooter>
            </Card>

            {/* ── 3. Add variations ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5" />
                  <CardTitle>Add variations</CardTitle>
                </div>
                <CardDescription>
                  Generate new variations of each imported question (same
                  topic, different wording) using your active LLM provider.
                  This grows your bank.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="var-type">Variation type</Label>
                    <Select
                      value={variationType}
                      onValueChange={(v) => setVariationType(v as VariationType)}
                    >
                      <SelectTrigger id="var-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VARIATION_TYPES.map((v) => (
                          <SelectItem key={v.value} value={v.value}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="var-count">Per question</Label>
                    <Input
                      id="var-count"
                      type="number"
                      min={1}
                      max={10}
                      value={countPerParent}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) {
                          setCountPerParent(Math.max(1, Math.min(10, n)));
                        }
                      }}
                    />
                  </div>
                </div>
                {variationsResult && (
                  <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Variations created: {variationsResult.created}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Will create up to {imported.count * countPerParent} new
                  questions. This can take a few minutes.
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  variant="secondary"
                  onClick={handleAddVariations}
                  disabled={variationsBusy || !provider}
                  className="w-full"
                >
                  {variationsBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating variations…
                    </>
                  ) : variationsResult ? (
                    "Run again"
                  ) : (
                    "Add variations"
                  )}
                </Button>
              </CardFooter>
            </Card>

            {/* ── 4. Send to bank ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Inbox className="h-5 w-5" />
                  <CardTitle>Send to bank</CardTitle>
                </div>
                <CardDescription>
                  Done. View the imported questions in the bank.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  variant="outline"
                  onClick={handleSendToBank}
                  className="w-full"
                >
                  Go to bank
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
