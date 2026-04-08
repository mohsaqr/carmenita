import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { getPrompt, renderPrompt } from "@/lib/prompts";
import { parseQuestionArray, type ParsedQuestion } from "@/lib/question-schema";
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
}

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
  } = args;

  const template = systemPromptOverride ?? getPrompt("carmenita.mcq.topic");
  const difficultyMixJson = JSON.stringify(
    difficultyMix ?? { easy: 0.3, medium: 0.5, hard: 0.2 },
  );

  return renderPrompt(template, {
    n: String(count),
    topic: topic.trim(),
    subject: subject?.trim() || "(unspecified)",
    level: level?.trim() || "undergraduate",
    objectives: objectives?.trim() || "(none specified)",
    mustInclude: mustInclude?.trim() || "(none specified)",
    allowedTypes: allowedTypes.join(", "),
    difficultyMix: difficultyMixJson,
  });
}

export async function generateQuestionsFromTopic(
  args: TopicGenerationArgs,
): Promise<ParsedQuestion[]> {
  const { topic, count, provider, temperature } = args;

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

  const model = getModel(
    provider.providerType,
    provider.defaultModel,
    provider.apiKey,
    provider.baseUrl,
  );

  const systemPrompt = buildTopicPrompt(args);

  const { text: raw } = await withRetry(
    () =>
      generateText({
        model,
        system: systemPrompt,
        prompt: "Generate the questions now as a JSON array.",
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    { maxAttempts: 3 },
  );

  const parsed = parseQuestionArray(raw);

  // If we over-generated (shouldn't happen for topic mode but defensive),
  // trim to the requested count.
  if (parsed.length > count) return parsed.slice(0, count);
  return parsed;
}
