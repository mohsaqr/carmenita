import type { QuestionType } from "@/db/schema";

/**
 * The answer format every generated question follows.
 *
 * Every question has exactly OPTION_COUNT (5) options — the UMCH scoring
 * sheet ("× 2, out of 10") is built on five. A share of the questions
 * (default 75 %) are multiple-answer with 2–4 correct options and at least
 * one wrong one: an all-correct item does not exist, since picking every
 * option scores 0. The rest are single-answer (exactly one correct).
 * No true/false.
 *
 * Pure and browser-safe (the Create page imports it): no server imports.
 * The prompt states it (answerFormatBlock), and question-quality.ts drops
 * any question that breaks it (meetsAnswerFormat) and trims each batch to
 * the requested mix (pickToMix).
 */

export const OPTION_COUNT = 5;
export const MIN_MULTI_CORRECT = 2;
export const MAX_MULTI_CORRECT = OPTION_COUNT - 1;
/** Share of multiple-answer questions when the request doesn't say. */
export const DEFAULT_MULTI_SHARE = 0.75;

export interface TypeCounts {
  multi: number;
  single: number;
}

/** A share in [0, 1]; missing or invalid → the default. */
export function normalizeShare(share: number | undefined): number {
  if (typeof share !== "number" || !Number.isFinite(share)) return DEFAULT_MULTI_SHARE;
  return Math.min(1, Math.max(0, share));
}

/** How many of `count` questions are multi- vs single-answer. */
export function typeCounts(count: number, share: number | undefined): TypeCounts {
  const multi = Math.round(count * normalizeShare(share));
  return { multi, single: count - multi };
}

/**
 * Split each part's question count into multi/single so the whole quiz
 * hits the share exactly: part i gets round(share·(c₁+…+cᵢ)) −
 * round(share·(c₁+…+cᵢ₋₁)) multi-answer questions, which is never below 0
 * or above the part's count, and sums to round(share·total).
 */
export function splitTypeCounts(partCounts: number[], share: number | undefined): TypeCounts[] {
  const s = normalizeShare(share);
  const cumulative = partCounts.reduce<number[]>((acc, c) => [...acc, (acc.at(-1) ?? 0) + c], []);
  return partCounts.map((count, i) => {
    const multi = Math.round(s * cumulative[i]) - Math.round(s * (cumulative[i] - count));
    return { multi, single: count - multi };
  });
}

/** The question types a request with this share produces. */
export function generationTypes(share: number | undefined): QuestionType[] {
  const s = normalizeShare(share);
  if (s <= 0) return ["mcq-single"];
  if (s >= 1) return ["mcq-multi"];
  return ["mcq-multi", "mcq-single"];
}

/** True when a question has 5 options and a correct-answer count its type allows. */
export function meetsAnswerFormat(q: {
  type: QuestionType;
  options: string[];
  correctAnswer: number | number[];
}): boolean {
  if (q.options.length !== OPTION_COUNT) return false;
  if (q.type === "mcq-single") return typeof q.correctAnswer === "number";
  if (q.type === "mcq-multi") {
    return (
      Array.isArray(q.correctAnswer) &&
      q.correctAnswer.length >= MIN_MULTI_CORRECT &&
      q.correctAnswer.length <= MAX_MULTI_CORRECT
    );
  }
  return false;
}

/**
 * Keep questions in order, at most `counts.multi` multi-answer and
 * `counts.single` single-answer ones, so a batch never drifts from the
 * requested mix. Returns the kept questions and how many were over.
 */
export function pickToMix<T extends { type: QuestionType }>(
  questions: T[],
  counts: TypeCounts,
): { kept: T[]; over: number } {
  const left = { multi: counts.multi, single: counts.single };
  const kept = questions.filter((q) => {
    const kind = q.type === "mcq-multi" ? "multi" : q.type === "mcq-single" ? "single" : null;
    if (kind === null || left[kind] <= 0) return false;
    left[kind] -= 1;
    return true;
  });
  return { kept, over: questions.length - kept.length };
}

/**
 * The prompt block that states the format for one batch. It is appended
 * after the (possibly user-edited) prompt and says it overrides earlier
 * text about types and option counts, so old saved prompts still comply.
 */
export function answerFormatBlock(counts: TypeCounts): string {
  const lines = [
    "ANSWER FORMAT — REQUIRED. This overrides anything above about question types or the number of options.",
    `- Write exactly ${counts.multi} "mcq-multi" and exactly ${counts.single} "mcq-single" questions in this batch. Do not write "true-false" questions.`,
    `- Every question has exactly ${OPTION_COUNT} options.`,
  ];
  if (counts.multi > 0) {
    lines.push(
      `- "mcq-multi": ${MIN_MULTI_CORRECT}, 3 or ${MAX_MULTI_CORRECT} of the ${OPTION_COUNT} options are correct — vary this across the batch — and at least one is wrong. Never make all ${OPTION_COUNT} correct. "correctAnswer" is the array of their 0-based indexes.`,
      `- In a multi-answer question every option must be clearly correct or clearly wrong on its own, so a learner who understands can judge each one. The stem asks the learner to select all correct options (e.g. "Which of the following are true? Select all that apply.") and never says how many are correct.`,
    );
  }
  if (counts.single > 0) {
    lines.push(
      `- "mcq-single": exactly one option is correct and the other ${OPTION_COUNT - 1} are plausible but wrong. "correctAnswer" is its 0-based index.`,
    );
  }
  return lines.join("\n");
}
