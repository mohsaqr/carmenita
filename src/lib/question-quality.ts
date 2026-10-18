import type { ParsedQuestion } from "@/lib/question-schema";
import type { QuestionType } from "@/types";

/**
 * Quality gate for freshly generated questions — the rules the prompts ask
 * for, enforced in code so they hold even when a model ignores them:
 *
 * 1. No recycling: a question whose stem or any option repeats a long run
 *    of words from the material the user supplied (document text, slides,
 *    pasted notes) is dropped. Copied sentences make recognition items a
 *    learner answers from remembered wording, not understanding.
 * 2. No duplicates: within the batch, and against questions an earlier
 *    batch of the same quiz already asked.
 * 3. Only allowed types: an exam asks for single best answer only, and a
 *    model that writes a true/false item anyway does not get it saved.
 * 4. No tell-tale answer position: options are shuffled (models put the
 *    correct answer first far more often than chance) and `correctAnswer`
 *    is remapped. True/false keeps its fixed ["True", "False"] order.
 *
 * Pure apart from the injectable `random`, so tests pass a seeded one.
 */

/** Consecutive words shared with the material that count as copying. */
export const COPIED_RUN_WORDS = 12;

export interface QualityDrops {
  /** Repeated a long run of words from the supplied material. */
  copied: number;
  /** Same question as one already in this batch or an earlier one. */
  duplicate: number;
  /** A question type this request did not allow. */
  wrongType: number;
}

export interface ReviewedBatch {
  questions: ParsedQuestion[];
  dropped: QualityDrops;
}

export interface ReviewOptions {
  /** The material the user supplied; empty strings are ignored. */
  sources?: string[];
  /** Question texts already in the quiz (earlier batches). */
  avoid?: string[];
  /** Types this request allows; absent = any. */
  allowedTypes?: QuestionType[];
  random?: () => number;
  copiedRunWords?: number;
}

/** Lowercase word tokens, letters and digits in any script. */
export function words(text: string): string[] {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function runsOf(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  return Array.from({ length: tokens.length - n + 1 }, (_, i) => tokens.slice(i, i + n).join(" "));
}

/** Every n-word run in the material, for O(1) copy checks. */
export function materialRuns(sources: string[], n: number = COPIED_RUN_WORDS): Set<string> {
  return new Set(sources.flatMap((source) => runsOf(words(source), n)));
}

/** True when `text` contains an n-word run that also appears in the material. */
export function copiesMaterial(text: string, runs: Set<string>, n: number = COPIED_RUN_WORDS): boolean {
  if (runs.size === 0) return false;
  return runsOf(words(text), n).some((run) => runs.has(run));
}

/** Identity of a question for duplicate checks: its words, ignoring case and punctuation. */
export function questionKey(text: string): string {
  return words(text).join(" ");
}

/** Shuffle a question's options and remap the correct answer(s) to follow them. */
export function shuffleOptions(q: ParsedQuestion, random: () => number = Math.random): ParsedQuestion {
  if (q.type === "true-false") return q;
  // Fisher–Yates over the positions; `order[newIndex] = oldIndex`.
  const order = q.options.map((_, i) => i);
  order.forEach((_, i) => {
    const j = i + Math.floor(random() * (order.length - i));
    [order[i], order[j]] = [order[j], order[i]];
  });
  const newIndexOf = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const remap = (oldIndex: number) => newIndexOf.get(oldIndex) ?? oldIndex;
  return {
    ...q,
    options: order.map((oldIndex) => q.options[oldIndex]),
    correctAnswer: Array.isArray(q.correctAnswer)
      ? q.correctAnswer.map(remap).sort((a, b) => a - b)
      : remap(q.correctAnswer),
  };
}

/** Apply the gate to one batch of parsed questions. */
export function reviewGenerated(questions: ParsedQuestion[], options: ReviewOptions = {}): ReviewedBatch {
  const n = options.copiedRunWords ?? COPIED_RUN_WORDS;
  const runs = materialRuns((options.sources ?? []).filter((s) => s && s.trim()), n);
  const seen = new Set((options.avoid ?? []).map(questionKey));
  const dropped: QualityDrops = { copied: 0, duplicate: 0, wrongType: 0 };
  const allowed = options.allowedTypes;

  const kept = questions.filter((q) => {
    if (allowed && !allowed.includes(q.type)) {
      dropped.wrongType += 1;
      return false;
    }
    const key = questionKey(q.question);
    if (seen.has(key)) {
      dropped.duplicate += 1;
      return false;
    }
    seen.add(key);
    if ([q.question, ...q.options].some((text) => copiesMaterial(text, runs, n))) {
      dropped.copied += 1;
      return false;
    }
    return true;
  });

  return { questions: kept.map((q) => shuffleOptions(q, options.random)), dropped };
}

/** Sum the drops of several batches. */
export function addDrops(a: QualityDrops, b: QualityDrops): QualityDrops {
  return {
    copied: a.copied + b.copied,
    duplicate: a.duplicate + b.duplicate,
    wrongType: a.wrongType + b.wrongType,
  };
}

export const NO_DROPS: QualityDrops = { copied: 0, duplicate: 0, wrongType: 0 };

/** Total questions left out. */
export function dropCount(dropped: QualityDrops): number {
  return dropped.copied + dropped.duplicate + dropped.wrongType;
}

/** One sentence for the UI, or "" when nothing was dropped. */
export function dropsMessage(dropped: QualityDrops): string {
  const parts = [
    dropped.copied ? `${dropped.copied} that copied the supplied material word for word` : "",
    dropped.duplicate ? `${dropped.duplicate} duplicate${dropped.duplicate === 1 ? "" : "s"}` : "",
    dropped.wrongType ? `${dropped.wrongType} of a question type you did not allow` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Left out ${list}.`;
}
