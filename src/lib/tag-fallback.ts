import type { ParsedQuestion } from "@/lib/question-schema";

/**
 * Auto-tagging fallback.
 *
 * Every Carmenita generation prompt requires the LLM to emit at least
 * 2 tags per question. In practice LLMs sometimes forget, especially on
 * the first question of a batch or when temperature is high. Rather
 * than hard-failing such questions in the Zod schema (which would break
 * backwards compat with older prompts), we run this pure function
 * server-side after `parseQuestionArray` to deterministically fill in
 * missing tags from other sources:
 *
 *   1. Any batch-level `defaults.tags` the caller passed in
 *   2. The question's own `topic` (hyphenated if multi-word)
 *   3. The question's own `subject` and `lesson` if present
 *
 * The final tag list is lowercased, deduped, stripped of empty
 * entries, and capped at 6. At least 1 tag is always guaranteed as
 * long as `topic` is non-empty (which Zod already enforces).
 */

export interface TagDefaults {
  subject: string | null;
  lesson: string | null;
  tags: string[];
}

const MIN_TAGS = 2;
const MAX_TAGS = 6;

/**
 * Ensure a parsed question has a usable tag set. Returns a NEW question
 * object with normalized `tags`, leaving the input untouched (pure).
 *
 * - If the LLM already produced ≥ MIN_TAGS, we still normalize (lowercase,
 *   hyphenate, dedupe, trim) but keep the LLM's choices.
 * - If it produced fewer, we pad from defaults → topic → subject → lesson
 *   until we hit MIN_TAGS (or exhaust all sources).
 * - We never go above MAX_TAGS.
 */
export function ensureTags(
  q: ParsedQuestion,
  defaults: TagDefaults = { subject: null, lesson: null, tags: [] },
): ParsedQuestion {
  const normalized = new Set<string>();

  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const cleaned = normalizeTag(raw);
    if (cleaned && normalized.size < MAX_TAGS) normalized.add(cleaned);
  };

  // Round 1: whatever the LLM gave us.
  for (const t of q.tags ?? []) add(t);

  // Round 2: batch-level defaults.
  if (normalized.size < MIN_TAGS) {
    for (const t of defaults.tags) add(t);
  }

  // Round 3: derive from the question's own taxonomy fields.
  if (normalized.size < MIN_TAGS) {
    add(q.topic);
  }
  if (normalized.size < MIN_TAGS) {
    add(q.subject);
  }
  if (normalized.size < MIN_TAGS) {
    add(q.lesson);
  }
  if (normalized.size < MIN_TAGS) {
    add(defaults.subject);
  }
  if (normalized.size < MIN_TAGS) {
    add(defaults.lesson);
  }

  return {
    ...q,
    tags: Array.from(normalized),
  };
}

/**
 * Lowercase, trim, collapse whitespace, and hyphenate multi-word tags.
 * Rejects empty results by returning an empty string (which the caller
 * then discards).
 */
function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "") // strip punctuation other than hyphens
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}
