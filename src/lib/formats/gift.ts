import type { PortableQuestion } from "./types";
import { DEFAULT_METADATA } from "./types";

/**
 * GIFT (General Import Format Template) — Moodle's plain-text question
 * format. https://docs.moodle.org/en/GIFT_format
 *
 * We support the subset relevant to Carmenita:
 *
 *   • Multiple choice (single + multi answer)
 *   • True/False
 *   • Per-answer feedback      (`~wrong#this is wrong`)
 *   • Per-question feedback    (`####overall explanation`)
 *   • Category blocks          (`$CATEGORY: topic/subtopic`)
 *   • Question title           (`::Title::`) — used as the topic tag if
 *                                no category is in scope
 *   • Comment lines beginning with `//`
 *   • GIFT escapes: \: \# \= \~ \{ \} \\
 *
 * Out of scope: short-answer, numerical, matching, essay, missing-word,
 * cloze. We throw on those during import (they'd have nowhere to map in
 * our MCQ-focused schema).
 *
 * Feedback handling on import:
 *   • GIFT's per-question `####feedback` → Carmenita's `explanation` field.
 *   • GIFT's per-answer `#feedback` → merged into `explanation` if the
 *     question-level one is missing (we pick the correct answer's
 *     feedback as the explanation).
 *
 * Feedback handling on export:
 *   • Carmenita's `explanation` → GIFT per-question `####`.
 *   • Carmenita metadata that GIFT can't represent natively (bloomLevel,
 *     sourcePassage) is emitted as a `//` comment line so it round-trips
 *     through Moodle (Moodle ignores comments).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface GiftParseResult {
  questions: PortableQuestion[];
  warnings: string[];
}

/**
 * Parse GIFT text into PortableQuestion objects. Returns successful
 * questions plus a list of human-readable warnings for questions that
 * were skipped (unsupported types, malformed, etc.).
 */
export function parseGift(text: string): GiftParseResult {
  const warnings: string[] = [];
  const questions: PortableQuestion[] = [];

  // Normalize line endings
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into logical blocks. A block is separated by one or more blank
  // lines. Comment-only lines are stripped but preserved as block separators
  // only if they stand alone.
  const blocks = splitGiftBlocks(normalized);

  let currentCategory: string | null = null;

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;

    // Category directive applies to all subsequent questions in the file.
    // Example: `$CATEGORY: biology/plants`
    if (block.startsWith("$CATEGORY:")) {
      currentCategory = block.slice("$CATEGORY:".length).trim();
      continue;
    }

    // Skip pure-comment blocks
    const commentOnly = block
      .split("\n")
      .every((line) => line.trim().startsWith("//") || line.trim() === "");
    if (commentOnly) continue;

    try {
      const q = parseGiftBlock(block, currentCategory);
      if (q) questions.push(q);
    } catch (err) {
      warnings.push(
        `Skipped question: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { questions, warnings };
}

/** Split GIFT text into question blocks separated by blank lines. */
function splitGiftBlocks(text: string): string[] {
  // A block is a maximal run of non-blank lines. But we must not split
  // inside a braced answer group (GIFT allows multi-line answers).
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let braceDepth = 0;

  for (const line of lines) {
    // Track unescaped braces to know whether we're inside an answer group
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\") {
        i++; // skip escaped char
        continue;
      }
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }

    if (line.trim() === "" && braceDepth === 0) {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/** Parse a single GIFT question block. Throws on malformed input. */
function parseGiftBlock(
  block: string,
  category: string | null,
): PortableQuestion | null {
  // Strip line comments (but not comments inside strings)
  const stripped = block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .trim();
  if (!stripped) return null;

  // Extract optional title: ::Title::Question text{answers}####feedback
  let title: string | null = null;
  let rest = stripped;
  const titleMatch = rest.match(/^::([^:]*?)::(.*)$/s);
  if (titleMatch) {
    title = titleMatch[1].trim();
    rest = titleMatch[2];
  }

  // Find the answer group { ... }
  const openBrace = findUnescaped(rest, "{");
  if (openBrace === -1) {
    // True/False shorthand without braces? Treat as missing.
    throw new Error("No answer group ({...}) found");
  }
  const closeBrace = findMatchingBrace(rest, openBrace);
  if (closeBrace === -1) {
    throw new Error("Unclosed answer group");
  }

  const stem = unescapeGift(rest.slice(0, openBrace).trim());
  const answerGroup = rest.slice(openBrace + 1, closeBrace);
  const afterAnswers = rest.slice(closeBrace + 1).trim();

  // Question-level feedback after the answer group: ####text
  let questionFeedback = "";
  if (afterAnswers.startsWith("####")) {
    questionFeedback = unescapeGift(afterAnswers.slice(4).trim());
  }

  // Decide question type by inspecting the answer group body
  const trimmedGroup = answerGroup.trim();

  // True/False shorthand: {T} {TRUE} {F} {FALSE}
  const tfMatch = trimmedGroup.toUpperCase();
  if (tfMatch === "T" || tfMatch === "TRUE") {
    return buildTrueFalse(stem, true, questionFeedback, title, category);
  }
  if (tfMatch === "F" || tfMatch === "FALSE") {
    return buildTrueFalse(stem, false, questionFeedback, title, category);
  }

  // Short answer shorthand starts with = and has no ~ → not our thing
  // Numerical starts with # → not our thing
  if (trimmedGroup.startsWith("#")) {
    throw new Error("Numerical questions are not supported");
  }
  // Essay: {} empty → not our thing
  if (trimmedGroup === "") {
    throw new Error("Essay questions are not supported");
  }

  // Multiple choice (single or multi) — parse answer entries
  const answerEntries = parseAnswerGroup(trimmedGroup);
  if (answerEntries.length === 0) {
    throw new Error("No answers found");
  }

  // Short answer has only = entries, no ~. If all are =, and no ~ appears,
  // it's a short-answer — skip.
  const hasWrong = answerEntries.some((a) => a.marker === "~");
  const hasCorrect = answerEntries.some((a) => a.marker === "=");
  if (!hasWrong) {
    if (hasCorrect) throw new Error("Short-answer questions are not supported");
    throw new Error("Answer group has no options");
  }

  // Multi-answer if the correct entries have fractional weights that
  // sum to ~100 with multiple =. GIFT's multi-answer syntax: entries
  // prefixed with `~%50%` (weight). For simplicity we treat ANY question
  // that has multiple `=`-marked answers OR entries with weight > 0 as
  // multi-answer.
  const correctIndices: number[] = [];
  const options: string[] = [];
  const perOptionFeedback: (string | null)[] = [];

  for (let i = 0; i < answerEntries.length; i++) {
    const entry = answerEntries[i];
    options.push(entry.text);
    perOptionFeedback.push(entry.feedback);
    if (entry.isCorrect) correctIndices.push(i);
  }

  if (correctIndices.length === 0) {
    throw new Error("No correct answer marked");
  }

  let type: "mcq-single" | "mcq-multi";
  let correctAnswer: number | number[];
  if (correctIndices.length === 1) {
    type = "mcq-single";
    correctAnswer = correctIndices[0];
  } else {
    type = "mcq-multi";
    correctAnswer = correctIndices;
  }

  // Explanation: prefer question-level feedback, fall back to the
  // feedback of the (first) correct answer, fall back to empty.
  const fallbackFeedback = perOptionFeedback[correctIndices[0]] ?? "";
  const explanation = questionFeedback || fallbackFeedback || DEFAULT_METADATA.explanation;

  // Taxonomy: derive subject/lesson/topic from the GIFT category path
  // or (as a fallback) from the question title.
  const taxonomy = deriveTaxonomy(category, title);

  return {
    type,
    question: stem,
    options,
    correctAnswer,
    explanation,
    difficulty: DEFAULT_METADATA.difficulty,
    bloomLevel: DEFAULT_METADATA.bloomLevel,
    subject: taxonomy.subject,
    lesson: taxonomy.lesson,
    topic: taxonomy.topic,
    tags: [],
    sourcePassage: DEFAULT_METADATA.sourcePassage,
  };
}

function buildTrueFalse(
  stem: string,
  correctIsTrue: boolean,
  feedback: string,
  title: string | null,
  category: string | null,
): PortableQuestion {
  const taxonomy = deriveTaxonomy(category, title);
  return {
    type: "true-false",
    question: stem,
    options: ["True", "False"],
    correctAnswer: correctIsTrue ? 0 : 1,
    explanation: feedback || DEFAULT_METADATA.explanation,
    difficulty: DEFAULT_METADATA.difficulty,
    bloomLevel: DEFAULT_METADATA.bloomLevel,
    subject: taxonomy.subject,
    lesson: taxonomy.lesson,
    topic: taxonomy.topic,
    tags: [],
    sourcePassage: DEFAULT_METADATA.sourcePassage,
  };
}

/**
 * Parse a GIFT `$CATEGORY:` hierarchy (or a question title) into our
 * three-level taxonomy. GIFT categories look like `biology/plants/photosynthesis`
 * — we map: last segment → topic, middle → lesson, first → subject.
 * When there are fewer segments: 1 → topic only, 2 → lesson + topic.
 */
function deriveTaxonomy(
  category: string | null,
  title: string | null,
): { subject: string | null; lesson: string | null; topic: string } {
  const source = category || title || "";
  if (!source) {
    return { subject: null, lesson: null, topic: DEFAULT_METADATA.topic };
  }
  const parts = source
    .split("/")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    return { subject: null, lesson: null, topic: DEFAULT_METADATA.topic };
  }
  if (parts.length === 1) {
    return { subject: null, lesson: null, topic: parts[0] };
  }
  if (parts.length === 2) {
    return { subject: null, lesson: parts[0], topic: parts[1] };
  }
  // 3+: first → subject, last → topic, middle joined with / → lesson
  return {
    subject: parts[0],
    lesson: parts.slice(1, -1).join("/"),
    topic: parts[parts.length - 1],
  };
}

interface AnswerEntry {
  marker: "=" | "~";
  text: string;
  feedback: string | null;
  isCorrect: boolean;
  weight: number | null;
}

/**
 * Parse the body of an answer group. Entries are separated by
 * unescaped `=` or `~` markers. Each entry may have an optional
 * `%weight%` prefix, text, then an optional `#feedback`.
 *
 * Correctness rule:
 *   • `=` entries are always correct.
 *   • `~` entries are wrong UNLESS they carry a positive weight
 *     (GIFT multi-answer syntax: `~%33.33%Red`).
 */
function parseAnswerGroup(body: string): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  let i = 0;
  while (i < body.length) {
    // Skip whitespace
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;

    const ch = body[i];
    if (ch !== "=" && ch !== "~") {
      i++;
      continue;
    }
    const marker: "=" | "~" = ch;
    i++; // consume marker

    // Optional weight prefix: %50% or %-25% or %33.33333%
    let weight: number | null = null;
    if (body[i] === "%") {
      const end = body.indexOf("%", i + 1);
      if (end !== -1) {
        const weightStr = body.slice(i + 1, end);
        const parsed = parseFloat(weightStr);
        if (!isNaN(parsed)) weight = parsed;
        i = end + 1;
      }
    }

    // Read text up to the next unescaped = / ~ / # (at top level)
    let text = "";
    while (i < body.length) {
      const c = body[i];
      if (c === "\\" && i + 1 < body.length) {
        text += body[i + 1];
        i += 2;
        continue;
      }
      if (c === "=" || c === "~" || c === "#") break;
      text += c;
      i++;
    }

    // Optional per-answer feedback: #feedback (but not ## which is bogus here)
    let feedback: string | null = null;
    if (body[i] === "#" && body[i + 1] !== "#") {
      i++;
      let fb = "";
      while (i < body.length) {
        const c = body[i];
        if (c === "\\" && i + 1 < body.length) {
          fb += body[i + 1];
          i += 2;
          continue;
        }
        if (c === "=" || c === "~") break;
        fb += c;
        i++;
      }
      feedback = unescapeGift(fb.trim());
    }

    // `=` → always correct. `~` with positive weight → correct
    // (GIFT multi-answer). `~` with zero/negative weight or no weight
    // → wrong.
    const isCorrect =
      marker === "=" || (marker === "~" && weight !== null && weight > 0);

    entries.push({
      marker,
      text: unescapeGift(text.trim()),
      feedback,
      isCorrect,
      weight,
    });
  }
  return entries;
}

function findUnescaped(s: string, ch: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === ch) return i;
  }
  return -1;
}

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const GIFT_SPECIALS = ["\\", ":", "#", "=", "~", "{", "}"];

function unescapeGift(s: string): string {
  return s.replace(/\\(.)/g, (_m, c) => c);
}

/** Build a slash-separated GIFT category path from a question's taxonomy. */
function buildCategoryPath(q: PortableQuestion): string {
  const parts: string[] = [];
  if (q.subject) parts.push(q.subject);
  if (q.lesson) parts.push(q.lesson);
  if (q.topic) parts.push(q.topic);
  return parts.join("/");
}

function escapeGift(s: string): string {
  let out = "";
  for (const c of s) {
    if (GIFT_SPECIALS.includes(c)) out += "\\";
    out += c;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

export interface GiftSerializeOptions {
  /** If set, emitted as `$CATEGORY:` at the top of the file. */
  category?: string;
  /** Include `// bloom: X // difficulty: Y // source: Z` comment lines. */
  includeMetadataComments?: boolean;
}

/**
 * Serialize PortableQuestion[] to GIFT text. Lossless for mcq-single,
 * mcq-multi, and true-false, including per-question feedback. Metadata
 * that GIFT can't represent natively (bloom level, difficulty,
 * source passage) is emitted as `//` comment lines if `includeMetadataComments`
 * is true (default), so round-trips preserve the data when re-imported.
 */
export function serializeGift(
  questions: PortableQuestion[],
  opts: GiftSerializeOptions = {},
): string {
  const includeMeta = opts.includeMetadataComments ?? true;
  const out: string[] = [];

  if (opts.category) {
    out.push(`$CATEGORY: ${opts.category}`);
    out.push("");
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (i > 0) out.push("");

    // Emit a per-question category if taxonomy is present and differs
    // from the file-level $CATEGORY. GIFT categories are slash-separated
    // hierarchies: subject/lesson/topic. We write the full path so that
    // a Moodle import places the question in the right sub-category.
    //
    // CRUCIAL: a blank line is required after `$CATEGORY:` so the
    // parser's block splitter treats it as a standalone directive block
    // rather than part of the following question block.
    const categoryPath = buildCategoryPath(q);
    if (categoryPath && categoryPath !== (opts.category ?? "")) {
      out.push(`$CATEGORY: ${categoryPath}`);
      out.push("");
    }

    if (includeMeta) {
      const metaParts = [
        `difficulty=${q.difficulty}`,
        `bloom=${q.bloomLevel}`,
        `topic=${q.topic}`,
      ];
      if (q.subject) metaParts.push(`subject=${q.subject}`);
      if (q.lesson) metaParts.push(`lesson=${q.lesson}`);
      out.push(`// carmenita-meta: ${metaParts.join("; ")}`);
      if (q.tags && q.tags.length > 0) {
        out.push(`// tags: ${q.tags.join(", ")}`);
      }
      if (q.sourcePassage) {
        out.push(`// source: ${q.sourcePassage.replace(/\n/g, " ")}`);
      }
    }

    // Use the topic as the question title
    const title = q.topic ? `::${escapeGift(q.topic)}:: ` : "";

    if (q.type === "true-false") {
      const isTrue = q.correctAnswer === 0;
      const stem = `${title}${escapeGift(q.question)} {${isTrue ? "T" : "F"}`;
      const closed = q.explanation
        ? `${stem}}####${escapeGift(q.explanation)}`
        : `${stem}}`;
      out.push(closed);
      continue;
    }

    // MCQ single or multi
    const correctSet = new Set<number>(
      Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer],
    );

    const answerLines: string[] = [];
    if (q.type === "mcq-multi") {
      // Multi-answer GIFT uses weighted syntax: each correct entry has a
      // positive weight and each wrong a negative weight. Use equal weights.
      const correctWeight = (100 / correctSet.size).toFixed(0);
      const wrongWeight = `-${(100 / (q.options.length - correctSet.size)).toFixed(0)}`;
      for (let j = 0; j < q.options.length; j++) {
        const opt = escapeGift(q.options[j]);
        if (correctSet.has(j)) {
          answerLines.push(`\t~%${correctWeight}%${opt}`);
        } else {
          answerLines.push(`\t~%${wrongWeight}%${opt}`);
        }
      }
    } else {
      for (let j = 0; j < q.options.length; j++) {
        const opt = escapeGift(q.options[j]);
        answerLines.push(correctSet.has(j) ? `\t=${opt}` : `\t~${opt}`);
      }
    }

    const header = `${title}${escapeGift(q.question)} {`;
    out.push(header);
    out.push(...answerLines);
    if (q.explanation) {
      out.push(`}####${escapeGift(q.explanation)}`);
    } else {
      out.push("}");
    }
  }

  return out.join("\n") + "\n";
}
