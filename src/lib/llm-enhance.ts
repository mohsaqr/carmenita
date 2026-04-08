import { generateText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { getPrompt, renderPrompt } from "@/lib/prompts";
import type { ProviderConfig, Question } from "@/types";

/**
 * Single-question enhancement primitives.
 *
 * These are used by the bank-level bulk actions:
 *   - `Explain (N)` on /bank  → calls generateExplanation for each id
 *   - `Re-tag (N)` on /bank   → calls generateTagging for each id
 *
 * Each function performs ONE LLM call per question and returns a small
 * parsed JSON object (NOT an array). The route handler wraps these in
 * a loop with per-question error handling so a single LLM failure
 * doesn't abort the whole batch.
 *
 * Prompt ids:
 *   - carmenita.feedback.add  → add a 1-2 sentence explanation
 *   - carmenita.tag.add       → derive subject/lesson/topic/tags
 */

// ─────────────────────────────────────────────────────────────────────────────
// Explanation generation
// ─────────────────────────────────────────────────────────────────────────────

const ExplanationResponseSchema = z.object({
  explanation: z.string().min(1).max(2000),
});

/**
 * Pure prompt builder for the explanation flow. Exposed so tests can
 * verify the prompt contains the right substrings without mocking the
 * LLM call. `generateExplanation` uses this internally.
 */
export function buildExplanationPrompt(question: Question): string {
  const template = getPrompt("carmenita.feedback.add");
  const correctAnswerText = describeCorrectAnswer(
    question.options,
    question.correctAnswer,
  );
  const optionsList = question.options
    .map((opt, idx) => `${letter(idx)}. ${opt}`)
    .join("\n");

  return renderPrompt(template, {
    question: question.question,
    optionsList,
    correctAnswer: correctAnswerText,
    currentExplanation: question.explanation || "(none)",
  });
}

/**
 * Generate a pedagogical 1-2 sentence explanation for an existing question.
 * Used by the /api/bank/questions/explain route.
 */
export async function generateExplanation(
  question: Question,
  provider: ProviderConfig,
  temperature?: number,
): Promise<string> {
  assertProvider(provider);
  const model = getModel(
    provider.providerType,
    provider.defaultModel,
    provider.apiKey,
    provider.baseUrl,
  );

  const systemPrompt = buildExplanationPrompt(question);

  const { text: raw } = await withRetry(
    () =>
      generateText({
        model,
        system: systemPrompt,
        prompt: 'Return the JSON object now, e.g. {"explanation": "..."}.',
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    { maxAttempts: 3 },
  );

  const obj = parseJsonObject(raw);
  const result = ExplanationResponseSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(
      `Explanation LLM output did not match expected shape: ${result.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return result.data.explanation.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tagging generation
// ─────────────────────────────────────────────────────────────────────────────

const TaggingResponseSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  lesson: z.string().max(200).nullable().optional(),
  topic: z.string().min(1).max(200),
  tags: z.array(z.string().min(1).max(100)).min(2).max(6),
});

export interface GeneratedTagging {
  subject: string | null;
  lesson: string | null;
  topic: string;
  tags: string[];
}

/**
 * Pure prompt builder for the tagging flow. Exposed for unit tests.
 */
export function buildTaggingPrompt(question: Question): string {
  const template = getPrompt("carmenita.tag.add");
  const correctAnswerText = describeCorrectAnswer(
    question.options,
    question.correctAnswer,
  );
  const optionsList = question.options
    .map((opt, idx) => `${letter(idx)}. ${opt}`)
    .join("\n");

  return renderPrompt(template, {
    question: question.question,
    optionsList,
    correctAnswer: correctAnswerText,
    explanation: question.explanation || "(none)",
  });
}

/**
 * Derive a subject / lesson / topic / tags set for an existing question.
 * Used by the /api/bank/questions/retag route on imported questions
 * that landed in the bank without good metadata.
 */
export async function generateTagging(
  question: Question,
  provider: ProviderConfig,
  temperature?: number,
): Promise<GeneratedTagging> {
  assertProvider(provider);
  const model = getModel(
    provider.providerType,
    provider.defaultModel,
    provider.apiKey,
    provider.baseUrl,
  );

  const systemPrompt = buildTaggingPrompt(question);

  const { text: raw } = await withRetry(
    () =>
      generateText({
        model,
        system: systemPrompt,
        prompt: "Return the JSON object now.",
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    { maxAttempts: 3 },
  );

  const obj = parseJsonObject(raw);
  const result = TaggingResponseSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(
      `Tagging LLM output did not match expected shape: ${result.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return {
    subject: result.data.subject?.trim().toLowerCase() || null,
    lesson: result.data.lesson?.trim().toLowerCase() || null,
    topic: result.data.topic.trim().toLowerCase(),
    tags: Array.from(
      new Set(result.data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function assertProvider(provider: ProviderConfig): void {
  if (
    !provider.apiKey &&
    provider.providerType !== "ollama" &&
    provider.providerType !== "lmstudio"
  ) {
    throw new Error(
      `Provider "${provider.displayName}" is missing an API key. Configure it in Settings.`,
    );
  }
}

function letter(idx: number): string {
  return String.fromCharCode("A".charCodeAt(0) + idx);
}

/**
 * Describe a correctAnswer value (number or number[]) as human text
 * alongside the literal option content, so the LLM has both the
 * position reference and the actual correct-answer text to ground its
 * explanation in.
 */
function describeCorrectAnswer(
  options: string[],
  correctAnswer: number | number[],
): string {
  if (Array.isArray(correctAnswer)) {
    const letters = correctAnswer.map(letter).join(", ");
    const values = correctAnswer.map((i) => `"${options[i]}"`).join("; ");
    return `Options ${letters} (${values})`;
  }
  return `Option ${letter(correctAnswer)} ("${options[correctAnswer]}")`;
}

/**
 * Strip markdown code fences and parse the LLM output as a JSON object.
 * Different from parseQuestionArray's stripCodeFences in that we expect
 * a single object, not an array.
 */
function parseJsonObject(raw: string): unknown {
  let text = raw.trim();
  text = text.replace(/^```(?:json|JSON)?\s*/m, "").replace(/```\s*$/m, "").trim();
  // If prose wraps the object, locate the outermost braces.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `LLM output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
