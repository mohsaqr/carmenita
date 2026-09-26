/**
 * Per-question scoring. Pure functions shared by the server route and
 * the static build's browser handlers, so both score identically.
 *
 * Every method returns a FRACTION in [0, 1] of the question's maximum
 * (the UI shows it as points out of 10, like the UMCH exam). Single-
 * answer questions (mcq-single, true-false) are all-or-nothing under
 * every method; the methods differ only for mcq-multi.
 *
 * Methods:
 *   all-or-nothing  exact set match → 1, anything else → 0 (the original
 *                   Carmenita behaviour; "scoring off").
 *   umch            UMCH "full match": (correct picked + wrong left
 *                   unpicked) / options — ×2 out of 10 for 5 options.
 *                   Cancelled (0) when exactly one option or every option
 *                   is picked.
 *   partial         correct picked / number correct, but 0 as soon as
 *                   any wrong option is picked (1 of 2 correct → 0.5).
 *   cancelling      (correct picked − wrong picked) / number correct,
 *                   never below 0 (1 right + 1 wrong → 0).
 */

export const SCORING_METHODS = ["umch", "partial", "cancelling", "all-or-nothing"] as const;
export type ScoringMethod = (typeof SCORING_METHODS)[number];

export const SCORING_LABELS: Record<ScoringMethod, { name: string; description: string }> = {
  umch: {
    name: "UMCH full match",
    description:
      "Multi-answer: (correct picked + wrong left unpicked) × 2, out of 10. Picking only one option, or all options, scores 0. Single-answer questions: all or nothing.",
  },
  partial: {
    name: "Partial credit",
    description:
      "Multi-answer: share of the correct options picked (1 of 2 → 5/10), but 0 if any wrong option is picked. Single-answer: all or nothing.",
  },
  cancelling: {
    name: "Cancelling (+1 / −1)",
    description:
      "Multi-answer: +1 per correct pick, −1 per wrong pick, scaled to 10, never below 0 (1 right + 1 wrong → 0). Single-answer: all or nothing.",
  },
  "all-or-nothing": {
    name: "All or nothing (off)",
    description: "Every question is 10 if exactly right, otherwise 0.",
  },
};

export function isScoringMethod(v: unknown): v is ScoringMethod {
  return typeof v === "string" && (SCORING_METHODS as readonly string[]).includes(v);
}

/** Settings key for the account-wide default method (app_settings). */
export const SCORING_SETTING_KEY = "scoring-method";

/**
 * Default when the account has never chosen one: UMCH on the server
 * build (as requested for the live app); plain right/wrong in the static
 * build, whose behaviour must not change.
 */
export const SERVER_DEFAULT_SCORING: ScoringMethod = "umch";
export const STATIC_DEFAULT_SCORING: ScoringMethod = "all-or-nothing";

export type QuestionType = "mcq-single" | "mcq-multi" | "true-false";
export type Answer = number | number[] | null;

/** Distinct in-range option indices the user picked (bad entries dropped). */
function picked(submitted: Answer, optionCount: number): Set<number> {
  const raw = Array.isArray(submitted) ? submitted : submitted == null ? [] : [submitted];
  return new Set(raw.filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount));
}

/**
 * Fraction of the question's maximum earned, in [0, 1].
 * `optionCount` is the number of answer options shown (5 in UMCH exams).
 */
export function scoreQuestion(
  method: ScoringMethod,
  type: QuestionType,
  correct: number | number[],
  submitted: Answer,
  optionCount: number,
): number {
  if (submitted == null) return 0;

  if (type !== "mcq-multi") {
    // Single-answer: all or nothing under every method.
    if (typeof correct !== "number" || typeof submitted !== "number") return 0;
    return submitted === correct ? 1 : 0;
  }

  const correctSet = new Set(Array.isArray(correct) ? correct : [correct]);
  const sel = picked(submitted, optionCount);
  if (sel.size === 0 || correctSet.size === 0 || optionCount <= 0) return 0;

  const correctPicked = [...sel].filter((i) => correctSet.has(i)).length;
  const wrongPicked = sel.size - correctPicked;
  const k = correctSet.size;

  switch (method) {
    case "all-or-nothing":
      return correctPicked === k && wrongPicked === 0 ? 1 : 0;
    case "umch": {
      if (sel.size === 1 || sel.size === optionCount) return 0; // cancelled
      const wrongLeftUnpicked = optionCount - k - wrongPicked;
      return (correctPicked + wrongLeftUnpicked) / optionCount;
    }
    case "partial":
      return wrongPicked > 0 ? 0 : correctPicked / k;
    case "cancelling":
      return Math.max(0, (correctPicked - wrongPicked) / k);
  }
}

/** Points out of 10 for display, rounded to 1 decimal (e.g. 0.8 → 8). */
export function toPoints(fraction: number): number {
  return Math.round(fraction * 100) / 10;
}

/**
 * The method an attempt is scored with: the quiz's own override if set,
 * otherwise the account default, otherwise `fallback`.
 */
export function resolveScoringMethod(
  quizOverride: unknown,
  accountDefault: unknown,
  fallback: ScoringMethod,
): ScoringMethod {
  if (isScoringMethod(quizOverride)) return quizOverride;
  if (isScoringMethod(accountDefault)) return accountDefault;
  return fallback;
}
