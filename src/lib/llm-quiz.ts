import { callLLM, settingsFromProvider } from "@/lib/ai/llm";
import { getPrompt, purposeStyleBlock, renderPrompt } from "@/lib/prompts";
import { parseQuestionArray, type ParsedQuestion } from "@/lib/question-schema";
import { addDrops, NO_DROPS, reviewGenerated, type QualityDrops, type ReviewedBatch } from "@/lib/question-quality";
import { answerFormatBlock, generationTypes, splitTypeCounts, typeCounts } from "@/lib/answer-format";
import { customInstructionsBlock } from "@/lib/llm-topic";
import { chunkText, distributeQuestions, type Chunk } from "@/lib/chunk";
import { batchSizes, TOPIC_BATCH_SIZE } from "@/lib/topic-batches";
import type { ProviderConfig, QuizSettings } from "@/types";

/**
 * High-level question generation.
 *
 * - Splits the document into one part per TOPIC_BATCH_SIZE (20) questions
 *   (`planGeneration`), so every LLM call asks for at most 20 and each
 *   covers its own stretch of the document — 100 questions on a 95-slide
 *   lecture become 5 calls over ~19 slides each, not one call that hits
 *   the output-token cap.
 * - Allocates questions per part proportional to its length, generates
 *   the parts in parallel, and concatenates the results.
 * - Per-chunk failures don't abort the whole job — we collect results
 *   from successful chunks and only throw if *no* chunk succeeded.
 * - Drops duplicate questions (exact `question` text match) across
 *   chunks to guard against obvious redundancy.
 */
export interface GenerateQuizArgs {
  docText: string;
  provider: ProviderConfig;
  settings: QuizSettings;
  /**
   * Which prompt id to use. Defaults to `carmenita.mcq.document` for the
   * generic "uploaded document" flow. Passing `carmenita.mcq.lecture`
   * switches to the PPTX-aware prompt (same call shape, different
   * instructions to the LLM about slide boundaries).
   */
  promptId?: string;
  systemPromptOverride?: string; // for /api/generate-quiz to forward a user-edited prompt
  temperature?: number;
  /** The user's instructions for the questions; appended last, overriding. */
  customInstructions?: string;
  /** Optional taxonomy hints injected into the prompt as default values. */
  defaultSubject?: string | null;
  defaultLesson?: string | null;
  /** Called each time a chunk's LLM call finishes, with (finished, total). */
  onProgress?: (finished: number, total: number) => void;
}

/** LLM calls in flight at once for one document quiz. */
export const CHUNK_CONCURRENCY = 3;

/**
 * `Promise.all(items.map(fn))` with at most `limit` calls running at once.
 * Results keep the input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Largest part a document is split into, whatever the question count. */
export const MAX_PART_CHARS = 40_000;

export interface GenerationTask {
  chunk: Chunk;
  /** Questions this call asks for (≤ TOPIC_BATCH_SIZE). */
  count: number;
}

/**
 * The LLM calls for `questionCount` questions from `docText`: one part per
 * TOPIC_BATCH_SIZE questions (at most MAX_PART_CHARS each), each part's
 * share split again into calls of ≤ TOPIC_BATCH_SIZE when a part is too
 * short to divide further. Pure — the route uses it for the job's total.
 */
export function planGeneration(docText: string, questionCount: number): GenerationTask[] {
  const parts = Math.max(1, Math.ceil(questionCount / TOPIC_BATCH_SIZE));
  const maxChars = Math.max(1000, Math.min(MAX_PART_CHARS, Math.ceil(docText.length / parts)));
  const chunks = chunkText(docText, { maxChars, overlap: Math.min(1000, Math.floor(maxChars / 10)) });
  const counts = distributeQuestions(chunks, questionCount);
  return chunks.flatMap((chunk, i) => batchSizes(counts[i]).map((count) => ({ chunk, count })));
}

/**
 * Document / lecture generation, one LLM call per chunk, run in parallel. Each chunk's
 * questions go through the quality gate against THAT chunk's text (so
 * copied sentences are caught) and against every question kept so far
 * (so chunks don't repeat each other).
 */
export async function generateQuizQuestions(
  args: GenerateQuizArgs,
): Promise<ReviewedBatch> {
  const {
    docText,
    provider,
    settings,
    promptId = "carmenita.mcq.document",
    systemPromptOverride,
    temperature,
    defaultSubject,
    defaultLesson,
    onProgress,
    customInstructions,
  } = args;

  if (!provider.apiKey && provider.providerType !== "ollama" && provider.providerType !== "lmstudio") {
    throw new Error(
      `Provider "${provider.displayName}" is missing an API key. Configure it in Settings.`,
    );
  }

  const template = systemPromptOverride ?? getPrompt(promptId);
  // Types and mix come from the multiple-answer share (answer-format.ts).
  const share = settings.multiAnswerShare;
  const allowedTypes = generationTypes(share);
  const purposeBlock = purposeStyleBlock(settings.purpose, settings.style);
  const difficultyMixJson = JSON.stringify(
    settings.difficultyMix ?? { easy: 0.3, medium: 0.5, hard: 0.2 },
  );
  const allowedTypesCsv = allowedTypes.join(", ");

  const tasks = planGeneration(docText, settings.questionCount);
  // Each part asks for its own exact multi/single split; together they
  // make the quiz's mix.
  const partMix = splitTypeCounts(tasks.map((t) => t.count), share);
  const instructions = customInstructions?.trim();

  const results: ParsedQuestion[] = [];
  const errors: string[] = [];
  let dropped: QualityDrops = NO_DROPS;

  // The LLM calls run in parallel (at most CHUNK_CONCURRENCY at a time) —
  // one after another, two ~60 s calls made a document quiz take over two
  // minutes. The replies are then reviewed in document order, so each part
  // is still checked against the questions every earlier part kept.
  let finished = 0;
  const replies = await mapWithConcurrency(tasks, CHUNK_CONCURRENCY, async ({ chunk, count }, i) => {
    const rendered = `${renderPrompt(template, {
      n: String(count),
      allowedTypes: allowedTypesCsv,
      difficultyMix: difficultyMixJson,
      text: chunk.text,
      defaultSubject: defaultSubject ?? "",
      defaultLesson: defaultLesson ?? "",
    })}\n\n${purposeBlock}\n\n${answerFormatBlock(partMix[i])}`;
    // The user's instructions go last: what comes last weighs most.
    const systemPrompt = instructions ? `${rendered}\n\n${customInstructionsBlock(instructions)}` : rendered;
    try {
      const { output } = await callLLM(
        settingsFromProvider(provider, { temperature }),
        systemPrompt,
        "Generate the questions now as a JSON array.",
      );
      return { output } as const;
    } catch (error) {
      return { error } as const;
    } finally {
      finished += 1;
      onProgress?.(finished, tasks.length);
    }
  });

  replies.forEach((reply, i) => {
    try {
      if ("error" in reply) throw reply.error;
      const reviewed = reviewGenerated(parseQuestionArray(reply.output), {
        sources: [tasks[i].chunk.text, instructions ?? ""],
        avoid: results.map((q) => q.question),
        allowedTypes,
        answerFormat: true,
        mix: partMix[i],
      });
      results.push(...reviewed.questions);
      dropped = addDrops(dropped, reviewed.dropped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Part ${i + 1}/${tasks.length}: ${msg}`);
      // Auth errors are non-retryable — fail the whole job if we hit one
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        throw err;
      }
    }
  });

  if (results.length === 0) {
    throw new Error(
      `Quiz generation failed for every part:\n${errors.join("\n")}`,
    );
  }

  // Each part was already trimmed to its share of the mix; this keeps the
  // whole quiz within the requested count and mix.
  const quizMix = typeCounts(settings.questionCount, share);
  const multi = results.filter((q) => q.type === "mcq-multi").slice(0, quizMix.multi);
  const single = results.filter((q) => q.type === "mcq-single").slice(0, quizMix.single);
  const keep = new Set([...multi, ...single]);
  return { questions: results.filter((q) => keep.has(q)), dropped };
}
