import { callLLM, settingsFromProvider } from "@/lib/ai/llm";
import { getPrompt, purposeStyleBlock, renderPrompt } from "@/lib/prompts";
import { parseQuestionArray } from "@/lib/question-schema";
import { reviewGenerated, type ReviewedBatch } from "@/lib/question-quality";
import type { QuestionPurpose, QuestionStyle } from "@/lib/question-purpose";
import { answerFormatBlock, generationTypes, typeCounts } from "@/lib/answer-format";
import type { ProviderConfig, Difficulty } from "@/types";

/**
 * Topic-based question generation.
 *
 * Unlike `generateQuizQuestions()` in llm-quiz.ts which chunks a long
 * document and dispatches per-chunk LLM calls, topic-based generation
 * is always a single LLM call: there is no source text to chunk, and
 * each request asks for at most TOPIC_BATCH_SIZE (20) questions — the
 * client splits larger runs (up to MAX_QUESTIONS) into batches.
 *
 * Prompt id: `carmenita.mcq.topic`. Placeholders:
 *   {n}, {topic}, {subject}, {level}, {objectives},
 *   {allowedTypes}, {difficultyMix}
 *   ({mustInclude} is still filled, with the custom instructions, for
 *   prompts users edited before it was replaced.)
 *
 *   The learner's custom instructions are not a template field: the
 *   builder appends them LAST, as an overriding block, so they hold
 *   with a user-edited template too.
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
  /** Free-text instructions from the learner; they take priority over the defaults. */
  customInstructions?: string;
  count: number;
  /** Share (0–1) of multiple-answer questions; absent = 0.75 (answer-format.ts). */
  multiAnswerShare?: number;
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
    customInstructions,
    count,
    multiAnswerShare,
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
    mustInclude: customInstructions?.trim() || "(none specified)",
    allowedTypes: generationTypes(multiAnswerShare).join(", "),
    difficultyMix: difficultyMixJson,
  });

  const withPurpose = `${prompt}\n\n${purposeStyleBlock(purpose, style)}\n\n${answerFormatBlock(
    typeCounts(count, multiAnswerShare),
  )}`;
  const asked = avoid
    .map((q) => q.replace(/\s+/g, " ").trim().slice(0, AVOID_MAX_CHARS))
    .filter(Boolean)
    .slice(-AVOID_MAX_ITEMS);
  const withAvoid = asked.length === 0 ? withPurpose : `${withPurpose}

ALREADY ASKED (earlier batches of this same quiz): do not repeat, paraphrase or test the exact same fact as any of these — cover other aspects of the topic.
${asked.map((q) => `- ${q}`).join("\n")}`;
  const instructions = customInstructions?.trim();
  if (!instructions) return withAvoid;
  // Last on purpose: what comes last is what the model weighs most.
  return `${withAvoid}

${customInstructionsBlock(instructions)}`;
}

/**
 * The learner's custom instructions as the prompt's final, overriding
 * block. They win over the defaults above (focus, coverage, level, style,
 * wording); the JSON output shape and the answer format stay fixed, since
 * the app reads and checks those. Used by topic AND document/lecture
 * generation.
 */
export function customInstructionsBlock(instructions: string): string {
  return `CUSTOM INSTRUCTIONS FROM THE LEARNER — HIGHEST PRIORITY
Follow every one of these in every question of this batch. Where they conflict with anything above (focus, coverage, level, style, wording), these instructions win. Only the output format, the JSON fields and the ANSWER FORMAT (5 options; the number of single- and multiple-answer questions; how many options are correct) stay as specified above. They tell you what to do, not text to copy: never paste their wording into a question.
"""
${instructions}
"""`;
}

/**
 * One batch of topic questions, through the quality gate: questions that
 * copy the pasted objectives / custom instructions, or repeat an earlier
 * batch (`avoid`), are dropped and counted in `dropped`.
 */
export async function generateQuestionsFromTopic(
  args: TopicGenerationArgs,
): Promise<ReviewedBatch> {
  const { topic, count, provider, temperature, objectives, customInstructions, avoid, multiAnswerShare } = args;

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
    sources: [objectives ?? "", customInstructions ?? ""],
    avoid,
    allowedTypes: generationTypes(multiAnswerShare),
    answerFormat: true,
    mix: typeCounts(count, multiAnswerShare),
  });

  // If we over-generated (shouldn't happen for topic mode but defensive),
  // trim to the requested count.
  return { ...reviewed, questions: reviewed.questions.slice(0, count) };
}
