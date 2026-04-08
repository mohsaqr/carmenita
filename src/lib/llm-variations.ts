import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { parseQuestionArray, type ParsedQuestion } from "@/lib/question-schema";
import type { ProviderConfig, Question, VariationType } from "@/types";

/**
 * Variation generation — takes an existing question from the bank and
 * produces N LLM-generated derivatives. Five variation modes:
 *
 *   • topic       — new questions on the same or closely related concepts
 *                   (different stems, different options, same subject area)
 *   • distractors — keep the stem + correct answer; regenerate the
 *                   wrong options (useful for freshening a question bank)
 *   • paraphrase  — same meaning, rewritten stem and options
 *   • harder      — subtler distractors, more technical language, higher
 *                   Bloom level if it makes sense
 *   • easier      — simpler language, more obviously wrong distractors
 *
 * All variation prompts ask the LLM for a strict JSON array in
 * PortableQuestion shape. We reuse parseQuestionArray so output
 * validation is identical to the document-based generation path.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Prompt templates
// ─────────────────────────────────────────────────────────────────────────────

const JSON_OUTPUT_RULES = `Return ONLY a JSON array of question objects. Each object must have EXACTLY these fields:
  "type": "mcq-single" | "mcq-multi" | "true-false"
  "question": string (the stem)
  "options": string[] (2-8 options; for true-false use exactly ["True","False"])
  "correctAnswer": number | number[] (0-indexed; array only for mcq-multi)
  "explanation": string (1-2 sentences)
  "difficulty": "easy" | "medium" | "hard"
  "bloomLevel": "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create"
  "topic": string (short lowercase concept tag)
  "subject": string | null (PRESERVE the original's subject verbatim unless the variation deliberately changes topic)
  "lesson":  string | null (PRESERVE the original's lesson verbatim unless the variation deliberately changes topic)
  "tags":    string[]      (PRESERVE the original's tags, or add new ones if genuinely different)
  "sourcePassage": string (may be empty for variations)

Output rules (STRICT):
  - Return ONLY the JSON array. No code fences. No prose. No commentary.
  - Do not wrap the output in \`\`\`json.
  - Every field above is required for every object (use null / [] where noted).
  - Distractors must be plausible but unambiguously incorrect.
  - PRESERVE the original question's subject, lesson, and tags as taxonomy anchors that should survive the variation.`;

const BASE_ROLE = `You are an expert educator generating quiz question variations for a learning app.`;

function formatOriginalQuestion(q: Question): string {
  const correct = Array.isArray(q.correctAnswer)
    ? q.correctAnswer.map((i) => `${String.fromCharCode(65 + i)}`).join(", ")
    : String.fromCharCode(65 + (q.correctAnswer as number));
  const optionLines = q.options
    .map((opt, i) => `  ${String.fromCharCode(65 + i)}. ${opt}`)
    .join("\n");
  const taxLines: string[] = [];
  if (q.subject) taxLines.push(`Subject: ${q.subject}`);
  if (q.lesson) taxLines.push(`Lesson: ${q.lesson}`);
  taxLines.push(`Topic: ${q.topic}`);
  if (q.tags && q.tags.length > 0) {
    taxLines.push(`Tags: ${q.tags.join(", ")}`);
  }
  return `Type: ${q.type}
Difficulty: ${q.difficulty}
Bloom level: ${q.bloomLevel}
${taxLines.join("\n")}

Question: ${q.question}

Options:
${optionLines}

Correct answer(s): ${correct}
Explanation: ${q.explanation || "(none)"}${q.sourcePassage ? `\nSource passage: "${q.sourcePassage}"` : ""}`;
}

export function buildVariationPrompt(
  type: VariationType,
  original: Question,
  count: number,
): string {
  const originalBlock = formatOriginalQuestion(original);

  switch (type) {
    case "topic":
      return `${BASE_ROLE}

Generate exactly ${count} NEW multiple-choice questions on the same topic as the reference question below, OR on closely related subtopics. Each new question must:
  - Ask about a DIFFERENT aspect of the topic (do not simply rephrase the original)
  - Have a different stem and different options from the original
  - Stay within the same subject area and at a similar educational level
  - Match the original's \`topic\` tag unless a related subtopic is more specific
  - Preserve the original's difficulty level unless a different level is required for the concept

Reference question:

${originalBlock}

${JSON_OUTPUT_RULES}`;

    case "distractors":
      return `${BASE_ROLE}

Generate exactly ${count} variations of the reference question below. For each variation:
  - KEEP THE SAME stem (question text) — do not reword it
  - KEEP THE SAME correct answer TEXT — it must appear in the same meaning
  - REPLACE the wrong options (distractors) with plausible but clearly incorrect alternatives
  - Each variation should have different distractors from the other variations AND from the original
  - Preserve the same type, difficulty, Bloom level, and topic
  - Keep the same number of options as the original

Reference question:

${originalBlock}

${JSON_OUTPUT_RULES}`;

    case "paraphrase":
      return `${BASE_ROLE}

Generate exactly ${count} paraphrased variations of the reference question below. Each variation must:
  - Preserve the EXACT SAME meaning and correct answer
  - Reword the stem and options in different ways (different sentence structure, synonyms, active/passive voice, etc.)
  - Keep the same type, difficulty, Bloom level, and topic
  - Not change the factual content — only the wording
  - Keep the same number of options

Reference question:

${originalBlock}

${JSON_OUTPUT_RULES}`;

    case "harder":
      return `${BASE_ROLE}

Generate exactly ${count} HARDER variations of the reference question below. Each harder variation must:
  - Cover the same concept or a closely related one
  - Use more technical vocabulary, subtler distractors, or higher-order thinking
  - Set \`difficulty\` to \`"hard"\`
  - If appropriate, shift the Bloom level one step higher (e.g., understand → apply → analyze → evaluate → create); keep it if already at "create"
  - Keep distractors all plausible — no obviously wrong options
  - Same type (mcq-single/mcq-multi/true-false) as the original
  - Same topic tag as the original

Reference question:

${originalBlock}

${JSON_OUTPUT_RULES}`;

    case "easier":
      return `${BASE_ROLE}

Generate exactly ${count} EASIER variations of the reference question below. Each easier variation must:
  - Cover the same concept but at a more accessible level
  - Use simpler vocabulary and more clearly distinct distractors (at least one obviously wrong)
  - Set \`difficulty\` to \`"easy"\`
  - If appropriate, shift the Bloom level one step lower (e.g., analyze → apply → understand → remember); keep it if already at "remember"
  - Same type (mcq-single/mcq-multi/true-false) as the original
  - Same topic tag as the original

Reference question:

${originalBlock}

${JSON_OUTPUT_RULES}`;
  }
}

// Re-exported as a constant-like map for UI display
export const VARIATION_TYPE_LABELS: Record<
  VariationType,
  { label: string; description: string }
> = {
  topic: {
    label: "Topic variations",
    description:
      "New questions on the same topic or closely related subtopics. Different stems, different options.",
  },
  distractors: {
    label: "Distractor rewrite",
    description:
      "Keep the stem and correct answer; regenerate the wrong options. Great for freshening a reused question.",
  },
  paraphrase: {
    label: "Paraphrase",
    description:
      "Same meaning, different wording. Keeps the correct answer identical, rephrases stem and options.",
  },
  harder: {
    label: "Harder versions",
    description:
      "Subtler distractors, more technical language, possibly higher Bloom level. Good for advanced review.",
  },
  easier: {
    label: "Easier versions",
    description:
      "Simpler language, more clearly distinct distractors. Good for introductory review.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateVariationsArgs {
  original: Question;
  variationType: VariationType;
  count: number;
  provider: ProviderConfig;
  temperature?: number;
}

/**
 * Generate N variations of an existing question. Returns the parsed
 * variations. The caller is responsible for persisting them with
 * parent_question_id and variation_type set.
 */
export async function generateVariations(
  args: GenerateVariationsArgs,
): Promise<ParsedQuestion[]> {
  const { original, variationType, count, provider, temperature } = args;

  if (count < 1 || count > 20) {
    throw new Error("Variation count must be between 1 and 20");
  }

  if (
    !provider.apiKey &&
    provider.providerType !== "ollama" &&
    provider.providerType !== "lmstudio"
  ) {
    throw new Error(
      `Provider "${provider.displayName}" is missing an API key. Configure it in Settings.`,
    );
  }

  const model = getModel(
    provider.providerType,
    provider.defaultModel,
    provider.apiKey,
    provider.baseUrl,
  );

  const systemPrompt = buildVariationPrompt(variationType, original, count);

  const { text: raw } = await withRetry(
    () =>
      generateText({
        model,
        system: systemPrompt,
        prompt: "Generate the variations now as a JSON array.",
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    { maxAttempts: 3 },
  );

  return parseQuestionArray(raw);
}
