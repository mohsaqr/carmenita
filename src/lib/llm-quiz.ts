import { callLLM, settingsFromProvider } from "@/lib/ai/llm";
import { getPrompt, purposeStyleBlock, renderPrompt } from "@/lib/prompts";
import { parseQuestionArray, type ParsedQuestion } from "@/lib/question-schema";
import { addDrops, NO_DROPS, reviewGenerated, type QualityDrops, type ReviewedBatch } from "@/lib/question-quality";
import { effectiveAllowedTypes } from "@/lib/question-purpose";
import { chunkText, distributeQuestions } from "@/lib/chunk";
import type { ProviderConfig, QuizSettings } from "@/types";

/**
 * High-level question generation.
 *
 * - If the document fits in one chunk, makes a single LLM call.
 * - If it doesn't, splits into chunks, allocates a question count per
 *   chunk proportional to chunk length, generates each batch, and
 *   concatenates the results.
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
  /** Optional taxonomy hints injected into the prompt as default values. */
  defaultSubject?: string | null;
  defaultLesson?: string | null;
}

/**
 * Document / lecture generation, one LLM call per chunk. Each chunk's
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
  } = args;

  if (!provider.apiKey && provider.providerType !== "ollama" && provider.providerType !== "lmstudio") {
    throw new Error(
      `Provider "${provider.displayName}" is missing an API key. Configure it in Settings.`,
    );
  }

  const template = systemPromptOverride ?? getPrompt(promptId);
  const allowedTypes = effectiveAllowedTypes(settings.purpose, settings.allowedTypes);
  const purposeBlock = purposeStyleBlock(settings.purpose, settings.style);
  const difficultyMixJson = JSON.stringify(
    settings.difficultyMix ?? { easy: 0.3, medium: 0.5, hard: 0.2 },
  );
  const allowedTypesCsv = allowedTypes.join(", ");

  const chunks = chunkText(docText);
  const perChunkCounts = distributeQuestions(chunks, settings.questionCount);

  const results: ParsedQuestion[] = [];
  const errors: string[] = [];
  let dropped: QualityDrops = NO_DROPS;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const count = perChunkCounts[i];
    if (count <= 0) continue;

    const systemPrompt = `${renderPrompt(template, {
      n: String(count),
      allowedTypes: allowedTypesCsv,
      difficultyMix: difficultyMixJson,
      text: chunk.text,
      defaultSubject: defaultSubject ?? "",
      defaultLesson: defaultLesson ?? "",
    })}\n\n${purposeBlock}`;

    try {
      const { output: raw } = await callLLM(
        settingsFromProvider(provider, { temperature }),
        systemPrompt,
        "Generate the questions now as a JSON array.",
      );
      const reviewed = reviewGenerated(parseQuestionArray(raw), {
        sources: [chunk.text],
        avoid: results.map((q) => q.question),
        allowedTypes,
      });
      results.push(...reviewed.questions);
      dropped = addDrops(dropped, reviewed.dropped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Chunk ${i + 1}/${chunks.length}: ${msg}`);
      // Auth errors are non-retryable — abort the whole job if we hit one
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        throw err;
      }
    }
  }

  if (results.length === 0) {
    throw new Error(
      `Quiz generation failed for every chunk:\n${errors.join("\n")}`,
    );
  }

  // If we over-generated (distribution rounding), trim to the requested count
  return { questions: results.slice(0, settings.questionCount), dropped };
}
