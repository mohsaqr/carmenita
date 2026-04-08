"use client";

import { Suspense, useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2,
  Download,
  BookOpen,
  Tags,
  Plus,
  MessageSquareQuote,
  Wand2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { Question } from "@/types";
import { ChatbotPromptPanel } from "@/components/ChatbotPromptPanel";
import { VariationDialog } from "@/components/VariationDialog";
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { CreateQuestionDialog } from "@/components/CreateQuestionDialog";
import { ImportCard } from "@/components/ImportCard";
import { QuestionRow } from "@/components/QuestionRow";
import { BankGroupedView } from "@/components/BankGroupedView";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { useAppStore } from "@/lib/store";

/**
 * Question Bank page — list every question across all quizzes, filter,
 * preview, delete, import from GIFT/Aiken, export to GIFT/Aiken, or
 * assemble a new quiz from a selection.
 */
export default function BankPage() {
  // Wrap in Suspense because useSearchParams requires it under
  // `output: "export"`.
  return (
    <Suspense fallback={null}>
      <BankPageInner />
    </Suspense>
  );
}

function BankPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const provider = useActiveProvider();
  const systemSettings = useAppStore((s) => s.systemSettings);
  const [all, setAll] = useState<Question[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({
    topic: "",
    subject: "any",
    lesson: "any",
    tag: "any",
    difficulty: "any",
    bloomLevel: "any",
    sourceType: "any",
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [variationTarget, setVariationTarget] = useState<Question | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /** "flat" = the classic divide-y list; "grouped" = three-level
   * subject/lesson/topic accordion via BankGroupedView. Local state only —
   * intentionally not persisted; a fresh session starts flat. */
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  /** Set of expanded group keys (subject, subject|lesson, subject|lesson|topic)
   * kept at the page level so expand/collapse state survives re-renders
   * (e.g. after a bulk re-tag reloads the bank). */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  /** Tracks which enhance action is currently running — used to disable
   * the Explain / Re-tag buttons during the request and show a spinner. */
  const [enhanceBusy, setEnhanceBusy] = useState<"explain" | "retag" | null>(null);
  const [taxonomy, setTaxonomy] = useState<{
    subjects: string[];
    lessons: string[];
    topics: string[];
    tags: string[];
  }>({ subjects: [], lessons: [], topics: [], tags: [] });

  // Stable reference so callbacks that depend on `reload` (like handleDeleteRow)
  // don't get new identities on every render. Declared BEFORE the useEffect
  // that calls it because `const` declarations aren't hoisted (unlike the
  // old `async function` declaration form that was here previously).
  const reload = useCallback(async () => {
    try {
      const [bankRes, taxRes] = await Promise.all([
        fetch("/api/bank/questions"),
        fetch("/api/bank/taxonomy"),
      ]);
      if (!bankRes.ok) throw new Error(`Failed to load bank (${bankRes.status})`);
      const data = await bankRes.json();
      setAll(data.questions);
      if (taxRes.ok) {
        const tax = await taxRes.json();
        setTaxonomy(tax);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Handle deep-link from /create Import tab:
   *   /bank?ids=id1,id2,id3&action=explain
   * Preselects the listed ids so the user can immediately hit the
   * Explain or Re-tag button. Runs once after the bank finishes loading.
   */
  useEffect(() => {
    if (all === null) return;
    const idsParam = searchParams.get("ids");
    if (!idsParam) return;
    const ids = idsParam.split(",").filter(Boolean);
    if (ids.length === 0) return;
    // Only preselect ids that actually exist in the current bank view.
    const existing = new Set(all.map((q) => q.id));
    const valid = ids.filter((id) => existing.has(id));
    if (valid.length === 0) return;
    setSelected(new Set(valid));
    // Clear the query string so a refresh doesn't re-trigger the preselect.
    router.replace("/bank");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const filtered = useMemo(() => {
    if (!all) return [];
    return all.filter((q) => {
      if (filter.topic && !q.topic.toLowerCase().includes(filter.topic.toLowerCase())) return false;
      if (filter.subject !== "any" && q.subject !== filter.subject) return false;
      if (filter.lesson !== "any" && q.lesson !== filter.lesson) return false;
      if (filter.tag !== "any" && !(q.tags ?? []).includes(filter.tag)) return false;
      if (filter.difficulty !== "any" && q.difficulty !== filter.difficulty) return false;
      if (filter.bloomLevel !== "any" && q.bloomLevel !== filter.bloomLevel) return false;
      if (filter.sourceType !== "any" && q.sourceType !== filter.sourceType) return false;
      return true;
    });
  }, [all, filter]);

  // ── Row-level callbacks (STABLE via useCallback) ──────────────────────
  //
  // These are the callbacks passed to every <QuestionRow /> (flat and
  // grouped views). They MUST have stable identities across renders for
  // React.memo on QuestionRow to actually bail out on non-affected rows.
  // The functional form of setState is used everywhere so the callbacks
  // don't close over the current state value.

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  }, []);

  const handleDeleteRow = useCallback(
    async (id: string) => {
      if (!confirm("Delete this question from the bank? It will be removed from all quizzes.")) return;
      const res = await fetch(`/api/bank/questions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Delete failed");
        return;
      }
      toast.success("Question deleted");
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      void reload();
    },
    [reload],
  );

  // `setVariationTarget` is already a stable React setter — can be passed
  // directly to QuestionRow as the onGenerateVariations handler.

  // Non-row handlers — no need for useCallback since they're not prop drilled.
  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const q of filtered) next.add(q.id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (
      !confirm(
        `Delete ${count} question${count === 1 ? "" : "s"} from the bank?\n\n` +
          "They will be removed from any quizzes that reference them. Attempts and answers are preserved but will reference deleted question ids.",
      )
    ) return;
    try {
      const res = await fetch("/api/bank/questions/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      toast.success(`Deleted ${data.deleted} question${data.deleted === 1 ? "" : "s"}`);
      setSelected(new Set());
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  /**
   * Bulk add explanations to selected questions. Calls the
   * /api/bank/questions/explain route which loops per question with
   * per-question error handling. Default `onlyIfMissing=true` so
   * repeat clicks are cheap / idempotent.
   */
  async function handleBulkExplain() {
    if (selected.size === 0 || !provider) return;
    setEnhanceBusy("explain");
    try {
      const res = await fetch("/api/bank/questions/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          provider,
          temperature: systemSettings.temperature ?? 0.3,
          onlyIfMissing: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Explain failed (${res.status})`);
      const parts: string[] = [];
      if (data.updated > 0) parts.push(`added ${data.updated} explanation${data.updated === 1 ? "" : "s"}`);
      if (data.skipped > 0) parts.push(`${data.skipped} already had one`);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        parts.push(`${data.errors.length} failed`);
      }
      toast.success(parts.length > 0 ? parts.join(", ") : "No changes");
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Explain failed");
    } finally {
      setEnhanceBusy(null);
    }
  }

  /**
   * Bulk re-derive subject / lesson / topic / tags for selected questions.
   * Replaces (not merges) existing values — the LLM is asked to produce a
   * complete tagging.
   */
  async function handleBulkRetag() {
    if (selected.size === 0 || !provider) return;
    if (
      !confirm(
        `Re-derive subject / lesson / topic / tags for ${selected.size} question${
          selected.size === 1 ? "" : "s"
        }?\n\nExisting values will be REPLACED with the LLM's derivation.`,
      )
    ) {
      return;
    }
    setEnhanceBusy("retag");
    try {
      const res = await fetch("/api/bank/questions/retag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          provider,
          temperature: systemSettings.temperature ?? 0.3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Re-tag failed (${res.status})`);
      const errorCount = Array.isArray(data.errors) ? data.errors.length : 0;
      toast.success(
        `Re-tagged ${data.updated} question${data.updated === 1 ? "" : "s"}` +
          (errorCount > 0 ? ` (${errorCount} failed)` : ""),
      );
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-tag failed");
    } finally {
      setEnhanceBusy(null);
    }
  }

  async function handleBuildQuiz() {
    if (selected.size === 0) {
      toast.error("Select at least one question first");
      return;
    }
    const title = prompt(`Name this quiz (${selected.size} questions):`);
    if (!title) return;
    try {
      const res = await fetch("/api/bank/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          questionIds: Array.from(selected),
          immediateFeedback: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to build quiz");
      toast.success(`Quiz "${title}" created`);
      router.push(`/quiz?id=${data.quizId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Build failed");
    }
  }

  /**
   * Grouped-view "Take N" handler. Called from BankGroupedView with a
   * flat id list and a human-readable path hint ("biology / plant
   * physiology / photosynthesis"). Posts to /api/bank/quick-quiz with
   * candidateIds so the server trusts our selection (no re-filtering),
   * then navigates to the newly-created quiz. API caps at 50 questions.
   */
  async function handleTakeGroup(ids: string[], titleHint: string) {
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/bank/quick-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Quick exam — ${titleHint}`,
          count: Math.min(ids.length, 50),
          candidateIds: ids,
          shuffle: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      toast.success(`Starting quiz (${data.questionCount} questions)`);
      router.push(`/quiz?id=${data.quizId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start quiz");
    }
  }

  /** Merge a batch of ids into the current selection set. Used by
   * BankGroupedView's per-group "Select all" button. */
  const selectMany = (ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  };

  /** Toggle a group key in the expandedGroups set. */
  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  function buildExportUrl(format: "markdown" | "gift" | "aiken") {
    const params = new URLSearchParams({ format });
    if (selected.size > 0) {
      params.set("ids", Array.from(selected).join(","));
    } else {
      if (filter.topic) params.set("topic", filter.topic);
      if (filter.subject !== "any") params.set("subject", filter.subject);
      if (filter.lesson !== "any") params.set("lesson", filter.lesson);
      if (filter.tag !== "any") params.set("tag", filter.tag);
      if (filter.difficulty !== "any") params.set("difficulty", filter.difficulty);
      if (filter.bloomLevel !== "any") params.set("bloomLevel", filter.bloomLevel);
      if (filter.sourceType !== "any") params.set("sourceType", filter.sourceType);
    }
    return `/api/bank/export?${params.toString()}`;
  }

  const counts = useMemo(() => {
    if (!all)
      return {
        total: 0,
        gift: 0,
        aiken: 0,
        markdown: 0,
        document: 0,
        manual: 0,
        variation: 0,
      };
    return {
      total: all.length,
      gift: all.filter((q) => q.sourceType === "gift-import").length,
      aiken: all.filter((q) => q.sourceType === "aiken-import").length,
      markdown: all.filter((q) => q.sourceType === "markdown-import").length,
      document: all.filter((q) => q.sourceType === "document").length,
      manual: all.filter((q) => q.sourceType === "manual").length,
      variation: all.filter((q) => q.sourceType === "variation").length,
    };
  }, [all]);

  // Build a lookup of parent → variation count for the lineage badges
  const variationChildCount = useMemo(() => {
    const m = new Map<string, number>();
    if (!all) return m;
    for (const q of all) {
      if (q.parentQuestionId) {
        m.set(q.parentQuestionId, (m.get(q.parentQuestionId) ?? 0) + 1);
      }
    }
    return m;
  }, [all]);

  // Parent lookup by id — for "variation of X" hint on child rows
  const byId = useMemo(() => {
    const m = new Map<string, Question>();
    if (!all) return m;
    for (const q of all) m.set(q.id, q);
    return m;
  }, [all]);

  return (
    // suppressHydrationWarning: password-manager extensions like Proton Pass
    // inject a `data-protonpass-form` attribute on any element they find form
    // inputs inside. That lands between server render and client hydration,
    // producing a benign but noisy hydration mismatch on this wrapper. The
    // flag only suppresses attribute warnings on THIS div, not its children.
    <div className="mx-auto max-w-6xl space-y-6" suppressHydrationWarning>
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            <h1 className="text-2xl font-bold tracking-tight">Question Bank</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Every question ever generated or imported. Filter, build quizzes, import, or export.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{counts.total} total</Badge>
          {counts.document > 0 && <Badge variant="secondary">{counts.document} from documents</Badge>}
          {counts.markdown > 0 && <Badge variant="secondary">{counts.markdown} from Markdown</Badge>}
          {counts.gift > 0 && <Badge variant="secondary">{counts.gift} from GIFT</Badge>}
          {counts.aiken > 0 && <Badge variant="secondary">{counts.aiken} from Aiken</Badge>}
          {counts.variation > 0 && <Badge variant="secondary">{counts.variation} variations</Badge>}
        </div>
      </header>

      <ChatbotPromptPanel />

      <ImportCard onImported={() => void reload()} />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow the bank. Applies to delete, build-quiz, and export.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Select
              value={filter.subject}
              onValueChange={(v) => setFilter({ ...filter, subject: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {taxonomy.subjects.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lesson</Label>
            <Select
              value={filter.lesson}
              onValueChange={(v) => setFilter({ ...filter, lesson: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {taxonomy.lessons.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topic">Topic contains</Label>
            <Input
              id="topic"
              value={filter.topic}
              onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
              placeholder="photosynthesis"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tag</Label>
            <Select
              value={filter.tag}
              onValueChange={(v) => setFilter({ ...filter, tag: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {taxonomy.tags.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Difficulty</Label>
            <Select
              value={filter.difficulty}
              onValueChange={(v) => setFilter({ ...filter, difficulty: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Bloom level</Label>
            <Select
              value={filter.bloomLevel}
              onValueChange={(v) => setFilter({ ...filter, bloomLevel: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="remember">Remember</SelectItem>
                <SelectItem value="understand">Understand</SelectItem>
                <SelectItem value="apply">Apply</SelectItem>
                <SelectItem value="analyze">Analyze</SelectItem>
                <SelectItem value="evaluate">Evaluate</SelectItem>
                <SelectItem value="create">Create</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select
              value={filter.sourceType}
              onValueChange={(v) => setFilter({ ...filter, sourceType: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="markdown-import">Markdown import</SelectItem>
                <SelectItem value="gift-import">GIFT import</SelectItem>
                <SelectItem value="aiken-import">Aiken import</SelectItem>
                <SelectItem value="variation">Variation</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>
              {filtered.length} question{filtered.length === 1 ? "" : "s"}
              {selected.size > 0 && ` · ${selected.size} selected`}
            </CardTitle>
            <CardDescription>Click a row to expand; use checkboxes to select.</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New question
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Button variant="outline" size="sm" onClick={selectAllVisible}>
              Select visible
            </Button>
            <Button variant="outline" size="sm" onClick={clearSelection} disabled={selected.size === 0}>
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkTagOpen(true)}
              disabled={selected.size === 0}
            >
              <Tags className="h-4 w-4" />
              Tag ({selected.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkExplain}
              disabled={selected.size === 0 || !provider || enhanceBusy !== null}
              title={
                !provider
                  ? "Requires an active LLM provider"
                  : "Generate missing explanations via the LLM"
              }
            >
              {enhanceBusy === "explain" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquareQuote className="h-4 w-4" />
              )}
              Explain ({selected.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkRetag}
              disabled={selected.size === 0 || !provider || enhanceBusy !== null}
              title={
                !provider
                  ? "Requires an active LLM provider"
                  : "Re-derive subject / lesson / topic / tags via the LLM"
              }
            >
              {enhanceBusy === "retag" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Re-tag ({selected.size})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={selected.size === 0}
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selected.size})
            </Button>
            <Button size="sm" onClick={handleBuildQuiz} disabled={selected.size === 0}>
              Build quiz ({selected.size})
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <a href={buildExportUrl("markdown")} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Export MD
              </Button>
            </a>
            <a href={buildExportUrl("gift")} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Export GIFT
              </Button>
            </a>
            <a href={buildExportUrl("aiken")} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Export Aiken
              </Button>
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* View toggle: flat list vs grouped accordion. The toolbar
              above always stays visible regardless of mode. */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as "flat" | "grouped")}
            >
              <TabsList>
                <TabsTrigger value="flat">Flat</TabsTrigger>
                <TabsTrigger value="grouped">Grouped</TabsTrigger>
              </TabsList>
            </Tabs>
            {viewMode === "grouped" && filtered.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Grouped by subject → lesson → topic. Click a group to expand;
                hit &ldquo;Take N&rdquo; to start a quick quiz from that group.
              </p>
            )}
          </div>

          {all === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {all && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No questions match these filters.
            </p>
          )}

          {viewMode === "flat" && (
            <div className="divide-y">
              {filtered.map((q) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  selected={selected.has(q.id)}
                  expanded={expanded === q.id}
                  variationCount={variationChildCount.get(q.id) ?? 0}
                  parent={q.parentQuestionId ? byId.get(q.parentQuestionId) ?? null : null}
                  onSelect={toggleSelected}
                  onToggleExpand={toggleExpanded}
                  onDelete={handleDeleteRow}
                  onGenerateVariations={setVariationTarget}
                />
              ))}
            </div>
          )}

          {viewMode === "grouped" && filtered.length > 0 && (
            <BankGroupedView
              questions={filtered}
              selected={selected}
              onToggleSelected={toggleSelected}
              onSelectMany={selectMany}
              onTakeQuiz={handleTakeGroup}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
              expandedQuestionId={expanded}
              onToggleQuestion={toggleExpanded}
              onDeleteQuestion={handleDeleteRow}
              onGenerateVariations={setVariationTarget}
              variationChildCount={variationChildCount}
              byId={byId}
            />
          )}
        </CardContent>
      </Card>

      <VariationDialog
        question={variationTarget}
        open={variationTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVariationTarget(null);
        }}
        onCreated={() => {
          void reload();
        }}
      />

      <BulkTagDialog
        selectedIds={Array.from(selected)}
        open={bulkTagOpen}
        onOpenChange={setBulkTagOpen}
        onUpdated={() => {
          void reload();
        }}
      />

      <CreateQuestionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void reload();
        }}
        defaultSubject={filter.subject !== "any" ? filter.subject : undefined}
        defaultLesson={filter.lesson !== "any" ? filter.lesson : undefined}
      />
    </div>
  );
}

// QuestionRow and DifficultyBadge were lifted out into
// src/components/QuestionRow.tsx so BankGroupedView can reuse them.
