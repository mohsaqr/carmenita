import { callLLM, settingsFromProvider } from "@/lib/ai/llm";
import { getPrompt, purposeStyleBlock, renderPrompt } from "@/lib/prompts";
import { parseQuestionArray } from "@/lib/question-schema";
import { reviewGenerated, type ReviewedBatch } from "@/lib/question-quality";
import { effectiveAllowedTypes, type QuestionPurpose, type QuestionStyle } from "@/lib/question-purpose";
import type { ProviderConfig, QuestionType, Difficulty } from "@/types";

/**
 * Topic-based question generation.
 *
 * Unlike `generateQuizQuestions()` in llm-quiz.ts which chunks a long
 * document and dispatches per-chunk LLM calls, topic-based generation
 * is always a single LLM call: there is no source text to chunk, and
 * topic count is bounded by the UI to ≤ 50 per request (settings.questionCount).
 *
 * Prompt id: `carmenita.mcq.topic`. Placeholders:
 *   {n}, {topic}, {subject}, {level}, {objectives}, {mustInclude},
 *   {allowedTypes}, {difficultyMix}
 *
 * The prompt is told there is NO source passage — it should draw on
 * its training knowledge and produce `sourcePassage` values that are
 * short canonical definitions (concept synthesis), not fabricated quotes.
 */

export interface TopicGenerationArgs {
  topic: string;
  subject?: string;
  level?: string;
  objectives?: string;
  mustInclude?: string;
  count: number;
  allowedTypes: QuestionType[];
  difficultyMix?: Partial<Record<Difficulty, number>>;
  provider: ProviderConfig;
  temperature?: number;
  systemPromptOverride?: string;
  /**
   * Questions already generated for this quiz by earlier batches. The
   * prompt lists them so a later batch covers new ground instead of
   * re-asking the same things.
   */
  avoid?: string[];
  purpose?: QuestionPurpose;
  style?: QuestionStyle;
}

/** Cap on how much of the earlier batches the prompt repeats back. */
const AVOID_MAX_ITEMS = 60;
const AVOID_MAX_CHARS = 160;

/**
 * Pure prompt builder — exposed for unit tests that assert the rendered
 * prompt contains the right instructions without needing to mock the
 * LLM layer. `generateQuestionsFromTopic` uses this internally.
 */
export function buildTopicPrompt(
  args: Omit<TopicGenerationArgs, "provider" | "temperature">,
): string {
  const {
    topic,
    subject,
    level,
    objectives,
    mustInclude,
    count,
    allowedTypes,
    difficultyMix,
    systemPromptOverride,
    avoid = [],
    purpose,
    style,
  } = args;

  const template = systemPromptOverride ?? getPrompt("carmenita.mcq.topic");
  const difficultyMixJson = JSON.stringify(
    difficultyMix ?? { easy: 0.3, medium: 0.5, hard: 0.2 },
  );

  const prompt = renderPrompt(template, {
    n: String(count),
    topic: topic.trim(),
    subject: subject?.trim() || "(unspecified)",
    level: level?.trim() || "undergraduate",
    objectives: objectives?.trim() || "(none specified)",
    mustInclude: mustInclude?.trim() || "(none specified)",
    allowedTypes: effectiveAllowedTypes(purpose, allowedTypes).join(", "),
    difficultyMix: difficultyMixJson,
  });

  const withPurpose = `${prompt}\n\n${purposeStyleBlock(purpose, style)}`;
  const asked = avoid
    .map((q) => q.replace(/\s+/g, " ").trim().slice(0, AVOID_MAX_CHARS))
    .filter(Boolean)
    .slice(-AVOID_MAX_ITEMS);
  if (asked.length === 0) return withPurpose;
  return `${withPurpose}

ALREADY ASKED (earlier batches of this same quiz): do not repeat, paraphrase or test the exact same fact as any of these — cover other aspects of the topic.
${asked.map((q) => `- ${q}`).join("\n")}`;
}

/**
 * One batch of topic questions, through the quality gate: questions that
 * copy the pasted objectives / must-include notes, or repeat an earlier
 * batch (`avoid`), are dropped and counted in `dropped`.
 */
export async function generateQuestionsFromTopic(
  args: TopicGenerationArgs,
): Promise<ReviewedBatch> {
  const { topic, count, provider, temperature, objectives, mustInclude, avoid, purpose, allowedTypes } = args;

  if (
    !provider.apiKey &&
    provider.providerType !== "ollama" &&
    provider.providerType !== "lmstudio"
  ) {
    throw new Error(
      `Provider "${provider.displayName}" is missing an API key. Configure it in Settings.`,
    );
  }

  if (!topic.trim()) {
    throw new Error("Topic is required for topic-based generation.");
  }

  const systemPrompt = buildTopicPrompt(args);

  const { output: raw } = await callLLM(
    settingsFromProvider(provider, { temperature }),
    systemPrompt,
    "Generate the questions now as a JSON array.",
  );

  const reviewed = reviewGenerated(parseQuestionArray(raw), {
    sources: [objectives ?? "", mustInclude ?? ""],
    avoid,
    allowedTypes: effectiveAllowedTypes(purpose, allowedTypes),
  });

  // If we over-generated (shouldn't happen for topic mode but defensive),
  // trim to the requested count.
  return { ...reviewed, questions: reviewed.questions.slice(0, count) };
}
