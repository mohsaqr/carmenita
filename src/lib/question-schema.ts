import { z } from "zod";
import type { QuestionType } from "@/db/schema";

/**
 * Zod schema for a single generated question, mirroring the shape that
 * `llm-quiz.ts` expects from the LLM. `id`, `quizId`, and `idx` are
 * assigned server-side after parsing, so they're not part of this schema.
 */

const QuestionCoreSchema = z.object({
  type: z.enum(["mcq-single", "mcq-multi", "true-false"]),
  question: z.string().min(5).max(2000),
  options: z.array(z.string().min(1).max(500)).min(2).max(8),
  correctAnswer: z.union([
    z.number().int().nonnegative(),
    z.array(z.number().int().nonnegative()).min(1),
  ]),
  explanation: z.string().min(1).max(2000),
  difficulty: z.enum(["easy", "medium", "hard"]),
  bloomLevel: z.enum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ]),
  // Taxonomy — optional in Zod so older prompts/LLM outputs that lack
  // these fields still validate. We normalize missing values to sensible
  // defaults in parseQuestionArray before returning.
  subject: z.string().max(200).nullable().optional(),
  lesson: z.string().max(200).nullable().optional(),
  topic: z.string().min(1).max(200),
  tags: z.array(z.string().max(100)).max(20).optional(),
  sourcePassage: z.string().min(1).max(500),
});

/**
 * Cross-field validation: the shape of `correctAnswer` and `options`
 * depends on the `type`, so we enforce that in a refinement.
 */
export const QuestionSchema = QuestionCoreSchema.refine(
  (q) => validateTypeConstraints(q),
  {
    message:
      "Invalid question: type/options/correctAnswer combination failed validation.",
  },
);

export const QuestionArraySchema = z.array(QuestionSchema).min(1);

// The inferred type from Zod has `subject`/`lesson`/`tags` as optional.
// We normalize in parseQuestionArray, so downstream code can treat them
// as always-present (subject/lesson: string|null, tags: string[]).
type RawParsedQuestion = z.infer<typeof QuestionSchema>;
export type ParsedQuestion = Omit<RawParsedQuestion, "subject" | "lesson" | "tags"> & {
  subject: string | null;
  lesson: string | null;
  tags: string[];
};

function validateTypeConstraints(q: {
  type: QuestionType;
  options: string[];
  correctAnswer: number | number[];
}): boolean {
  switch (q.type) {
    case "true-false": {
      // exactly ["True", "False"] (case insensitive), single-number correctAnswer in {0, 1}
      if (q.options.length !== 2) return false;
      const normalized = q.options.map((o) => o.toLowerCase().trim());
      if (normalized[0] !== "true" || normalized[1] !== "false") return false;
      if (typeof q.correctAnswer !== "number") return false;
      if (q.correctAnswer !== 0 && q.correctAnswer !== 1) return false;
      return true;
    }
    case "mcq-single": {
      if (q.options.length < 2 || q.options.length > 8) return false;
      if (typeof q.correctAnswer !== "number") return false;
      if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) return false;
      return true;
    }
    case "mcq-multi": {
      if (q.options.length < 3 || q.options.length > 8) return false;
      if (!Array.isArray(q.correctAnswer)) return false;
      if (q.correctAnswer.length < 2) return false;
      if (q.correctAnswer.length >= q.options.length) return false; // at least one wrong option
      if (new Set(q.correctAnswer).size !== q.correctAnswer.length) return false; // no dupes
      if (q.correctAnswer.some((i) => i < 0 || i >= q.options.length)) return false;
      return true;
    }
  }
}

/**
 * Strip common LLM output cruft: markdown code fences, leading/trailing
 * whitespace, and bare prose before/after the JSON array.
 */
function stripCodeFences(raw: string): string {
  let text = raw.trim();
  // Remove ```json ... ``` or ``` ... ```
  text = text.replace(/^```(?:json|JSON)?\s*/m, "").replace(/```\s*$/m, "").trim();
  // If the LLM wrote prose before the JSON, try to locate the first '['
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    text = text.slice(firstBracket, lastBracket + 1);
  }
  return text;
}

/**
 * Parse raw LLM output into a validated array of questions. Drops
 * individual questions that fail schema validation (and logs a warning)
 * rather than failing the whole batch. Throws only if zero valid
 * questions remain.
 */
export function parseQuestionArray(raw: string): ParsedQuestion[] {
  const cleaned = stripCodeFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("LLM output is valid JSON but not an array.");
  }

  const valid: ParsedQuestion[] = [];
  const errors: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = QuestionSchema.safeParse(parsed[i]);
    if (result.success) {
      // Normalize optional taxonomy fields to always-present shape
      valid.push({
        ...result.data,
        subject: result.data.subject ?? null,
        lesson: result.data.lesson ?? null,
        tags: result.data.tags ?? [],
      });
    } else {
      errors.push(`Question ${i}: ${result.error.issues.map((e) => e.message).join("; ")}`);
    }
  }

  if (valid.length === 0) {
    throw new Error(
      `LLM produced ${parsed.length} questions but none passed validation:\n` +
        errors.slice(0, 5).join("\n"),
    );
  }

  if (errors.length > 0) {
    console.warn(
      `[carmenita] Discarded ${errors.length}/${parsed.length} invalid questions:`,
      errors.slice(0, 5),
    );
  }

  return valid;
}
