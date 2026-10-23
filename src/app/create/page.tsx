"use client";

import { Suspense, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UploadCloud,
  FileText,
  Loader2,
  Sparkles,
  BookOpenCheck,
  Presentation,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { useActiveProvider } from "@/hooks/useActiveProvider";
import { NoProviderWarning } from "@/components/NoProviderWarning";
import { useAppStore } from "@/lib/store";
import type { GenerationJobState } from "@/types";
import { batchSizes, MAX_QUESTIONS } from "@/lib/topic-batches";
import { pollGenerationJob, readJson } from "@/lib/generation-poll";
import { reportClientError } from "@/lib/client-errors";
import { addDrops, dropsMessage, NO_DROPS, type QualityDrops } from "@/lib/question-quality";
import {
  DEFAULT_PURPOSE,
  DEFAULT_STYLE,
  PURPOSE_DIFFICULTY,
  PURPOSE_LABELS,
  QUESTION_PURPOSES,
  QUESTION_STYLES,
  STYLE_LABELS,
  type QuestionPurpose,
  type QuestionStyle,
} from "@/lib/question-purpose";
import {
  DEFAULT_MULTI_SHARE,
  MAX_MULTI_CORRECT,
  MIN_MULTI_CORRECT,
  OPTION_COUNT,
  generationTypes,
} from "@/lib/answer-format";

/**
 * Unified creation hub. Four paths to getting questions into the bank:
 *
 *   Document tab  — upload PDF / DOCX / TXT → /api/generate-quiz
 *   Lecture tab   — upload PPTX → /api/generate-quiz (server detects .pptx
 *                   and switches the prompt to carmenita.mcq.lecture)
 *   Topic tab     — typed topic + structured context → /api/generate-from-topic
 *   Import tab    — paste GIFT/Aiken/Markdown → /api/bank/import
 *
 * A single shared settings panel at the bottom configures count, allowed
 * types, difficulty mix, title, and taxonomy defaults — these apply to
 * every generation tab. The Import tab ignores them (imported questions
 * keep whatever metadata the source file had).
 *
 * Replaces the old /upload page which only supported documents.
 */

const LEVELS = [
  { value: "intro", label: "Introductory" },
  { value: "undergrad", label: "Undergraduate" },
  { value: "grad", label: "Graduate" },
  { value: "professional", label: "Professional / expert" },
];

type TabValue = "document" | "lecture" | "topic" | "import";

export default function CreatePage() {
  // useSearchParams requires a Suspense boundary when the page is
  // statically prerendered — otherwise Next's export mode bails out.
  return (
    <Suspense fallback={null}>
      <CreatePageInner />
    </Suspense>
  );
}

function CreatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const provider = useActiveProvider();
  const systemSettings = useAppStore((s) => s.systemSettings);

  const initialTab = (searchParams.get("mode") as TabValue) || "document";
  const [tab, setTab] = useState<TabValue>(
    (["document", "lecture", "topic", "import"].includes(initialTab)
      ? initialTab
      : "document") as TabValue,
  );

  // ── Shared settings (apply to all generation tabs) ────────────────────
  const [title, setTitle] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  // Share of multiple-answer questions, in percent; the rest are single-answer.
  const [multiPercent, setMultiPercent] = useState(Math.round(DEFAULT_MULTI_SHARE * 100));
  // The user's instructions for the questions (every generation tab).
  const [instructions, setInstructions] = useState("");
  const [immediateFeedback, setImmediateFeedback] = useState(true);
  const [difficultyEasy, setDifficultyEasy] = useState(0.3);
  const [difficultyMedium, setDifficultyMedium] = useState(0.5);
  const [difficultyHard, setDifficultyHard] = useState(0.2);
  const [defaultSubject, setDefaultSubject] = useState("");
  const [defaultLesson, setDefaultLesson] = useState("");
  const [defaultTags, setDefaultTags] = useState(""); // comma-separated
  const [purpose, setPurpose] = useState<QuestionPurpose>(DEFAULT_PURPOSE);
  const [style, setStyle] = useState<QuestionStyle>(DEFAULT_STYLE);

  // A purpose pre-sets the difficulty mix; the fields stay editable after.
  const choosePurpose = (next: QuestionPurpose) => {
    setPurpose(next);
    const mix = PURPOSE_DIFFICULTY[next];
    setDifficultyEasy(mix.easy);
    setDifficultyMedium(mix.medium);
    setDifficultyHard(mix.hard);
  };

  const parsedDefaultTags = useMemo(
    () =>
      defaultTags
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [defaultTags],
  );

  // ── Document tab state ────────────────────────────────────────────────
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docInfo, setDocInfo] = useState<{
    id: string;
    filename: string;
    charCount: number;
    truncated: boolean;
  } | null>(null);

  // ── Topic tab state ───────────────────────────────────────────────────
  const [topicName, setTopicName] = useState("");
  const [topicSubject, setTopicSubject] = useState("");
  const [topicLevel, setTopicLevel] = useState("undergrad");
  const [topicObjectives, setTopicObjectives] = useState("");

  // ── Job state ─────────────────────────────────────────────────────────
  const [job, setJob] = useState<GenerationJobState>({ status: "idle" });
  const busy = job.status === "extracting" || job.status === "generating";

  const settingsPayload = () => ({
    questionCount,
    allowedTypes: generationTypes(multiPercent / 100),
    multiAnswerShare: multiPercent / 100,
    immediateFeedback,
    purpose,
    style,
    difficultyMix: {
      easy: difficultyEasy,
      medium: difficultyMedium,
      hard: difficultyHard,
    },
  });

  // ── Shared helpers ────────────────────────────────────────────────────

  const commonGenerateBody = () => ({
    title: title || (tab === "topic" ? topicName : docInfo?.filename || "Untitled quiz"),
    settings: settingsPayload(),
    provider,
    temperature: systemSettings.temperature ?? 0.3,
    defaultSubject: defaultSubject.trim() || undefined,
    defaultLesson: defaultLesson.trim() || undefined,
    defaultTags: parsedDefaultTags.length > 0 ? parsedDefaultTags : undefined,
    customInstructions: instructions.trim() || undefined,
  });

  // ── Document tab handlers ─────────────────────────────────────────────

  const onDropDocument = useCallback(
    (accepted: File[]) => {
      const f = accepted[0];
      if (!f) return;
      setDocFile(f);
      if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
      setDocInfo(null);
    },
    [title],
  );

  const documentDropzone = useDropzone({
    onDrop: onDropDocument,
    multiple: false,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        [".pptx"],
      "text/plain": [".txt", ".md"],
      "text/markdown": [".md"],
      "text/csv": [".csv"],
      "application/json": [".json"],
    },
  });

  async function handleExtract() {
    if (!docFile) return;
    setJob({ status: "extracting", filename: docFile.name });
    try {
      const buf = await docFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const base64 = arrayBufferToBase64(bytes);
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: docFile.name, contentBase64: base64 }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? `Upload failed (${res.status})`));
      const data = body as unknown as {
        id: string;
        filename: string;
        charCount: number;
        truncated: boolean;
        failedPages?: number;
      };
      setDocInfo(data);
      setJob({ status: "idle" });
      toast.success(
        `Extracted ${data.charCount.toLocaleString()} characters${
          data.truncated ? " (truncated to 50k)" : ""
        }`,
        {
          description: data.failedPages
            ? `${data.failedPages} page${data.failedPages === 1 ? "" : "s"} could not be read and ${data.failedPages === 1 ? "is" : "are"} missing.`
            : undefined,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      reportClientError("create.upload", err);
      setJob({ status: "error", message: msg });
      toast.error(msg);
    }
  }

  async function handleGenerateDocument() {
    if (!docInfo || !provider) return;
    setJob({ status: "generating", filename: docInfo.filename });
    try {
      const res = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: docInfo.id,
          ...commonGenerateBody(),
        }),
      });
      const started = await readJson(res);
      if (!res.ok) throw new Error(String(started.error ?? `Generation failed (${res.status})`));
      // Generation runs as a server job (it can outlast the tunnel's
      // ~100 s request limit); poll it until the quiz is saved.
      const data = await pollGenerationJob(String(started.jobId), {
        onProgress: (done, total) =>
          setJob({
            status: "generating",
            filename: docInfo.filename,
            progress: total > 1 ? `${done} of ${total} parts done` : undefined,
          }),
      });
      setJob({ status: "success", quizId: data.quizId });
      toast.success(`Generated ${data.questionCount} questions`, {
        description: dropsMessage((data.dropped as QualityDrops | undefined) ?? NO_DROPS) || undefined,
      });
      router.push(`/quiz?id=${data.quizId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      reportClientError("create.generate", err);
      setJob({ status: "error", message: msg });
      toast.error(msg);
    }
  }

  // ── Topic tab handler ─────────────────────────────────────────────────

  async function handleGenerateTopic() {
    if (!provider) return;
    if (!topicName.trim()) {
      toast.error("Topic name is required");
      return;
    }
    const sizes = batchSizes(questionCount);
    const label = `topic: ${topicName}`;
    const base = {
      topic: topicName,
      subject: topicSubject.trim() || undefined,
      level: topicLevel,
      objectives: topicObjectives.trim() || undefined,
      ...commonGenerateBody(),
    };

    // One request per batch, so no single request outlives the tunnel's
    // ~100 s limit. The first creates the quiz; the rest append to it and
    // list what was already asked so batches don't repeat each other.
    let quizId: string | null = null;
    let made = 0;
    let dropped: QualityDrops = NO_DROPS;
    const asked: string[] = [];
    // Sequential on purpose: each batch needs the quiz id and the
    // questions of the batches before it.
    for (const [i, batchCount] of sizes.entries()) {
      setJob({
        status: "generating",
        filename: label,
        progress: sizes.length > 1 ? `batch ${i + 1} of ${sizes.length} (${made} of ${questionCount} done)` : undefined,
      });
      try {
        const res = await fetch("/api/generate-from-topic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...base,
            batchCount,
            ...(quizId ? { appendToQuizId: quizId, avoid: asked } : {}),
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(String(data.error ?? `Generation failed (${res.status})`));
        quizId = data.quizId as string;
        made += data.questionCount as number;
        dropped = addDrops(dropped, (data.dropped as QualityDrops | undefined) ?? NO_DROPS);
        asked.push(...((data.questions as string[] | undefined) ?? []));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        reportClientError("create.topic", err);
        if (quizId) {
          // Earlier batches are saved — keep them rather than throw them away.
          toast.error(`Stopped after ${made} of ${questionCount} questions: ${msg}`);
          setJob({ status: "success", quizId });
          router.push(`/quiz?id=${quizId}`);
        } else {
          setJob({ status: "error", message: msg });
          toast.error(msg);
        }
        return;
      }
    }

    if (!quizId) return;
    setJob({ status: "success", quizId });
    toast.success(`Generated ${made} questions`, { description: dropsMessage(dropped) || undefined });
    router.push(`/quiz?id=${quizId}`);
  }

  return (
    // suppressHydrationWarning: password-manager extensions (Proton Pass,
    // 1Password, Dashlane) inject data attributes on any element that
    // contains form inputs. The /create page is form-heavy across every
    // tab, so the injected attributes trigger hydration mismatch warnings
    // on this wrapper div. Element-scoped — children still warn normally.
    <div className="mx-auto max-w-4xl space-y-6" suppressHydrationWarning>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Create questions</h1>
        <p className="text-sm text-muted-foreground">
          Generate MCQs from a document, a typed topic, or a PPTX lecture — or
          import existing questions from GIFT / Aiken / Markdown.
        </p>
      </header>

      {!provider && tab !== "import" && <NoProviderWarning />}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="document">
            <BookOpenCheck className="h-4 w-4" /> Document
          </TabsTrigger>
          <TabsTrigger value="lecture">
            <Presentation className="h-4 w-4" /> Lecture (PPTX)
          </TabsTrigger>
          <TabsTrigger value="topic">
            <Sparkles className="h-4 w-4" /> Topic
          </TabsTrigger>
          <TabsTrigger value="import">
            <Inbox className="h-4 w-4" /> Import
          </TabsTrigger>
        </TabsList>

        {/* ──────────── Document tab ──────────── */}
        <TabsContent value="document" className="mt-4 space-y-6">
          <DocumentTabCard
            label="Upload a PDF, DOCX, or text file"
            description="Carmenita will extract the text (max 50 000 chars) and generate source-faithful questions from it."
            dropzone={documentDropzone}
            file={docFile}
            docInfo={docInfo}
            onExtract={handleExtract}
            job={job}
          />
        </TabsContent>

        {/* ──────────── Lecture (PPTX) tab ──────────── */}
        <TabsContent value="lecture" className="mt-4 space-y-6">
          <DocumentTabCard
            label="Upload a PowerPoint (.pptx) lecture deck"
            description="Carmenita extracts each slide's bullets, preserves slide boundaries, and uses the lecture-specific prompt that reconstructs concepts across adjacent slides."
            dropzone={documentDropzone}
            file={docFile}
            docInfo={docInfo}
            onExtract={handleExtract}
            job={job}
            pptxOnly
          />
        </TabsContent>

        {/* ──────────── Topic tab ──────────── */}
        <TabsContent value="topic" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Topic</CardTitle>
              <CardDescription>
                Generate questions from a concept you type. The LLM uses its
                training knowledge — give it structured context for best results.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="topic-name">
                  Topic <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="topic-name"
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  placeholder="e.g. mitochondrial respiration"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="topic-subject">Subject area (optional)</Label>
                  <Input
                    id="topic-subject"
                    value={topicSubject}
                    onChange={(e) => setTopicSubject(e.target.value)}
                    placeholder="e.g. cell biology"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="topic-level">Target level</Label>
                  <Select value={topicLevel} onValueChange={setTopicLevel}>
                    <SelectTrigger id="topic-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="topic-objectives">Learning objectives (optional)</Label>
                <Textarea
                  id="topic-objectives"
                  value={topicObjectives}
                  onChange={(e) => setTopicObjectives(e.target.value)}
                  rows={3}
                  placeholder="e.g. Students should understand how ATP is produced via oxidative phosphorylation and distinguish it from substrate-level phosphorylation."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ──────────── Import tab ──────────── */}
        <TabsContent value="import" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Import questions</CardTitle>
              <CardDescription>
                Importing has its own dedicated hub with post-import
                enhancement options — take as-is, add explanations, or
                generate variations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/import">
                <Button>
                  Go to import hub
                  <Inbox className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ──────────── Shared settings panel ──────────── */}
      {tab !== "import" && (
        <Card>
          <CardHeader>
            <CardTitle>Quiz settings</CardTitle>
            <CardDescription>
              These apply to Document, Lecture, and Topic generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Quiz title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Chapter 3 Review"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="count">Number of questions</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  max={MAX_QUESTIONS}
                  value={questionCount}
                  onChange={(e) =>
                    setQuestionCount(Math.min(MAX_QUESTIONS, parseInt(e.target.value, 10) || 10))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="purpose">Purpose</Label>
                <Select value={purpose} onValueChange={(v) => choosePurpose(v as QuestionPurpose)}>
                  <SelectTrigger id="purpose">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_PURPOSES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PURPOSE_LABELS[p].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{PURPOSE_LABELS[purpose].description}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="style">Style</Label>
                <Select value={style} onValueChange={(v) => setStyle(v as QuestionStyle)}>
                  <SelectTrigger id="style">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_STYLES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {STYLE_LABELS[st].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{STYLE_LABELS[style].description}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="multi-percent">Multiple-answer questions (%)</Label>
              <Input
                id="multi-percent"
                type="number"
                min={0}
                max={100}
                step={5}
                value={multiPercent}
                onChange={(e) =>
                  setMultiPercent(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))
                }
                className="w-28"
              />
              <p className="text-xs text-muted-foreground">
                Every question has {OPTION_COUNT} options. {multiPercent}% are multiple-answer ({MIN_MULTI_CORRECT}–
                {MAX_MULTI_CORRECT} correct, never all {OPTION_COUNT}); {100 - multiPercent}% are single-answer (one correct).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructions">Instructions for the questions (optional)</Label>
              <Textarea
                id="instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                placeholder="Anything the questions must do, e.g. use clinical case vignettes; focus on the mechanism of GABA-A receptors; avoid asking for drug brand names"
              />
              <p className="text-xs text-muted-foreground">
                Followed in every question, ahead of the defaults. The answer format above always applies.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Difficulty mix (proportions, should sum to ~1.0)</Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Easy</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    value={difficultyEasy}
                    onChange={(e) =>
                      setDifficultyEasy(parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Medium</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    value={difficultyMedium}
                    onChange={(e) =>
                      setDifficultyMedium(parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Hard</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    value={difficultyHard}
                    onChange={(e) =>
                      setDifficultyHard(parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Taxonomy defaults (applied when the LLM doesn&apos;t set them itself)</Label>
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={defaultSubject}
                  onChange={(e) => setDefaultSubject(e.target.value)}
                  placeholder="Subject (e.g. biology)"
                />
                <Input
                  value={defaultLesson}
                  onChange={(e) => setDefaultLesson(e.target.value)}
                  placeholder="Lesson (e.g. plant physiology)"
                />
                <Input
                  value={defaultTags}
                  onChange={(e) => setDefaultTags(e.target.value)}
                  placeholder="Tags (comma-separated)"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="immediate"
                checked={immediateFeedback}
                onCheckedChange={setImmediateFeedback}
              />
              <Label htmlFor="immediate">
                Immediate feedback (reveal correct answer after each question)
              </Label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ──────────── Generate button ──────────── */}
      {tab !== "import" && (
        <div className="flex items-center justify-end gap-3">
          {job.status === "generating" && (
            <div className="flex-1 space-y-1">
              <p className="text-sm text-muted-foreground">
                Generating questions — this can take a minute or two depending on the model
                {job.progress ? ` · ${job.progress}` : ""}.
              </p>
              <Progress value={undefined} />
            </div>
          )}
          <Button
            onClick={tab === "topic" ? handleGenerateTopic : handleGenerateDocument}
            disabled={
              busy ||
              !provider ||
              (tab === "topic" ? !topicName.trim() : !docInfo)
            }
            size="lg"
          >
            {job.status === "generating" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate quiz"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentTabCard — shared dropzone + extract UI used by both Document and
// Lecture tabs. The only difference is the dropzone's accepted file types
// (controlled by `pptxOnly`) and the copy in the header.
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentTabCardProps {
  label: string;
  description: string;
  dropzone: ReturnType<typeof useDropzone>;
  file: File | null;
  docInfo: {
    id: string;
    filename: string;
    charCount: number;
    truncated: boolean;
  } | null;
  onExtract: () => void;
  job: GenerationJobState;
  pptxOnly?: boolean;
}

function DocumentTabCard({
  label,
  description,
  dropzone,
  file,
  docInfo,
  onExtract,
  job,
  pptxOnly = false,
}: DocumentTabCardProps) {
  const { getRootProps, getInputProps, isDragActive } = dropzone;
  const extracting = job.status === "extracting";
  return (
    <Card>
      <CardHeader>
        <CardTitle>1. {label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          {...getRootProps()}
          className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          {file ? (
            <>
              <p className="font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB — click or drop to replace
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                {isDragActive ? "Drop it here" : "Click or drag a file here"}
              </p>
              <p className="text-xs text-muted-foreground">
                {pptxOnly
                  ? "Filter set for .pptx in the dropzone — other files go to the Document tab."
                  : "Max 50 000 characters"}
              </p>
            </>
          )}
        </div>

        {file && !docInfo && (
          <Button onClick={onExtract} disabled={extracting}>
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting…
              </>
            ) : (
              "Extract text"
            )}
          </Button>
        )}

        {docInfo && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm flex items-center gap-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">{docInfo.filename}</div>
              <div className="text-xs text-muted-foreground">
                {docInfo.charCount.toLocaleString()} characters
                {docInfo.truncated && " (truncated)"}
              </div>
            </div>
            <Badge variant="secondary">Ready</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Convert Uint8Array → base64 string without blowing the call stack. */
function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
