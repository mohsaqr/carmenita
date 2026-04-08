import type { PortableQuestion } from "./types";
import type {
  QuestionType,
  Difficulty,
  BloomLevel,
} from "@/db/schema";
import { DEFAULT_METADATA } from "./types";

/**
 * Markdown Q&A format — Carmenita's canonical chatbot-friendly format.
 *
 * The canonical shape (what our chatbot prompt instructs LLMs to produce):
 *
 *   ## Q1
 *   **Type:** mcq-single
 *   **Difficulty:** easy
 *   **Bloom:** remember
 *   **Topic:** european capitals
 *
 *   **Question:** What is the capital of France?
 *
 *   - [ ] Berlin
 *   - [x] Paris
 *   - [ ] London
 *   - [ ] Madrid
 *
 *   **Explanation:** Paris has been the capital of France since 987 AD.
 *   **Source:** "Paris is the capital and most populous city of France."
 *
 *   ---
 *
 *   ## Q2
 *   ...
 *
 * Key design choices:
 *   • GitHub-flavored checkbox lists (`- [x]`) mark the correct answer(s).
 *     This is a format every chatbot already knows, makes mcq-multi
 *     trivial (multiple `[x]`), and is visually clear to humans.
 *   • One `**Field:**` per line for metadata — LLMs produce these reliably.
 *   • Headers `## Q{n}` serve as question boundaries, `---` as a visual
 *     separator (both are accepted).
 *   • Tolerant parser: accepts different header levels, `*` / `1.` list
 *     markers, case-insensitive `[X]`, and `**Field:**` vs `Field:`.
 *   • If `**Type:**` is missing, we auto-detect: 2 options matching
 *     true/false → true-false; multiple `[x]` → mcq-multi; one `[x]`
 *     → mcq-single.
 *   • Missing optional fields fall back to DEFAULT_METADATA.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkdownParseResult {
  questions: PortableQuestion[];
  warnings: string[];
}

const QUESTION_HEADER = /^(#{1,6})\s+(?:Q(?:uestion)?\s*)?(\d+)\b.*$/i;
// Field line — two shapes:
//   1. `**Field:**  value`  — the colon is INSIDE the bold wrapper (canonical markdown)
//   2. `Field: value`       — plain, no emphasis
// The regex for shape 1 is tried first because it's unambiguous; shape 2
// is a permissive fallback for chatbots that drop the asterisks.
const FIELD_LINE_BOLD =
  /^\s*(\*{1,2})([A-Za-z][\w ]+?)\s*:\s*\1\s*(.*)$/;
const FIELD_LINE_PLAIN = /^\s*([A-Za-z][\w ]+?)\s*:\s*(.*)$/;
// Option line: - [x] text  |  * [x] text  |  1. [x] text  |  1) [x] text
const OPTION_LINE = /^\s*(?:[-*+]|\d+[.)])\s*\[\s*([xX ])\s*\]\s*(.*)$/;

function matchFieldLine(line: string): { name: string; value: string } | null {
  const bold = line.match(FIELD_LINE_BOLD);
  if (bold) {
    return { name: bold[2].trim(), value: bold[3].trim() };
  }
  const plain = line.match(FIELD_LINE_PLAIN);
  if (plain) {
    return { name: plain[1].trim(), value: plain[2].trim() };
  }
  return null;
}

export function parseMarkdown(text: string): MarkdownParseResult {
  const warnings: string[] = [];
  const questions: PortableQuestion[] = [];

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into blocks. A new block starts at:
  //   • a header line matching QUESTION_HEADER, OR
  //   • a horizontal rule `---` / `***` / `___`
  const blocks = splitBlocks(normalized);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    try {
      const q = parseBlock(trimmed);
      if (q) questions.push(q);
    } catch (err) {
      warnings.push(
        `Skipped question: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { questions, warnings };
}

function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of lines) {
    const isHeader = QUESTION_HEADER.test(line);
    const isHr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    if (isHeader) {
      pushCurrent();
      current.push(line);
    } else if (isHr) {
      pushCurrent();
    } else {
      current.push(line);
    }
  }
  pushCurrent();
  return blocks;
}

function parseBlock(block: string): PortableQuestion | null {
  const lines = block.split("\n").map((l) => l.replace(/\s+$/, ""));

  // Collect structured fields
  const fields: Record<string, string> = {};
  const options: Array<{ text: string; correct: boolean }> = [];
  let questionText: string | null = null;
  let inQuestionBlock = false;
  const questionExtra: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      inQuestionBlock = false;
      continue;
    }

    // Skip the question header line
    if (QUESTION_HEADER.test(line)) continue;

    // Option line?
    const optMatch = line.match(OPTION_LINE);
    if (optMatch) {
      const mark = optMatch[1].toLowerCase() === "x";
      const text = optMatch[2].trim();
      if (text) options.push({ text, correct: mark });
      inQuestionBlock = false;
      continue;
    }

    // Field line?
    const fieldMatch = matchFieldLine(line);
    if (fieldMatch) {
      const name = fieldMatch.name.toLowerCase();
      const value = fieldMatch.value;
      // Recognize only our known field names so we don't mistakenly
      // treat unrelated "Foo: bar" lines as fields.
      if (
        name === "type" ||
        name === "difficulty" ||
        name === "bloom" ||
        name === "bloom level" ||
        name === "subject" ||
        name === "lesson" ||
        name === "chapter" ||
        name === "unit" ||
        name === "topic" ||
        name === "category" ||
        name === "tags" ||
        name === "tag" ||
        name === "question" ||
        name === "stem" ||
        name === "explanation" ||
        name === "feedback" ||
        name === "answer explanation" ||
        name === "source" ||
        name === "source passage" ||
        name === "quote" ||
        name === "citation"
      ) {
        const canonical = normalizeFieldName(name);
        if (canonical === "question") {
          questionText = value;
          inQuestionBlock = true;
        } else {
          fields[canonical] = value;
          inQuestionBlock = false;
        }
        continue;
      }
    }

    // Continuation of a multi-line question stem
    if (inQuestionBlock && questionText !== null) {
      questionExtra.push(line);
      continue;
    }

    // Continuation of an explanation/source — append if the last field
    // we saw was explanation/source (simple heuristic)
    // (We keep this intentionally narrow; chatbot prompts ask for
    // single-line fields.)
  }

  // Merge multi-line question stem
  if (questionText !== null && questionExtra.length > 0) {
    questionText = [questionText, ...questionExtra].join(" ").trim();
  }

  if (!questionText) {
    throw new Error("Missing **Question:** field");
  }
  if (options.length < 2) {
    throw new Error(`Need at least 2 options (found ${options.length})`);
  }

  const correctIndices: number[] = [];
  const optionStrings: string[] = [];
  for (let i = 0; i < options.length; i++) {
    optionStrings.push(options[i].text);
    if (options[i].correct) correctIndices.push(i);
  }
  if (correctIndices.length === 0) {
    throw new Error("No option marked as correct ([x])");
  }
  if (correctIndices.length === options.length) {
    throw new Error("All options marked correct — at least one must be wrong");
  }

  // Determine type
  let type: QuestionType;
  const declaredType = fields.type?.toLowerCase().replace(/[_\s]/g, "-");
  if (
    declaredType === "mcq-single" ||
    declaredType === "mcq-multi" ||
    declaredType === "true-false"
  ) {
    type = declaredType as QuestionType;
  } else {
    type = inferType(optionStrings, correctIndices);
  }

  // Validate type against options/correct
  if (type === "true-false") {
    if (
      options.length !== 2 ||
      optionStrings[0].toLowerCase() !== "true" ||
      optionStrings[1].toLowerCase() !== "false"
    ) {
      throw new Error(
        "true-false questions must have exactly two options: True and False",
      );
    }
    if (correctIndices.length !== 1) {
      throw new Error("true-false must have exactly one correct answer");
    }
  } else if (type === "mcq-multi") {
    if (correctIndices.length < 2) {
      throw new Error("mcq-multi must have at least 2 correct answers");
    }
  } else if (type === "mcq-single") {
    if (correctIndices.length !== 1) {
      throw new Error("mcq-single must have exactly 1 correct answer");
    }
  }

  const correctAnswer: number | number[] =
    type === "mcq-multi" ? correctIndices : correctIndices[0];

  const difficulty = coerceDifficulty(fields.difficulty);
  const bloomLevel = coerceBloom(fields["bloom level"] || fields.bloom);
  const subject = normalizeOpt(fields.subject);
  const lesson = normalizeOpt(fields.lesson || fields.chapter || fields.unit);
  const topic = (fields.topic || fields.category || DEFAULT_METADATA.topic)
    .trim()
    .toLowerCase();
  const tags = parseTagList(fields.tags || fields.tag);
  const explanation = fields.explanation || fields.feedback || "";
  const sourcePassage = stripQuotes(fields.source || fields["source passage"] || "");

  // Normalize options: strip the case-insensitive "True"/"False" to
  // exactly ["True", "False"] for true-false.
  const finalOptions =
    type === "true-false" ? ["True", "False"] : optionStrings;

  return {
    type,
    question: questionText.trim(),
    options: finalOptions,
    correctAnswer,
    explanation,
    difficulty,
    bloomLevel,
    subject,
    lesson,
    topic,
    tags,
    sourcePassage,
  };
}

/** Trim and lowercase an optional metadata value; null if empty. */
function normalizeOpt(v: string | undefined): string | null {
  const s = (v || "").trim().toLowerCase();
  return s || null;
}

/** Parse a comma- or semicolon-separated tag list. Empty → []. */
function parseTagList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeFieldName(name: string): string {
  if (name === "bloom") return "bloom";
  if (name === "bloom level") return "bloom level";
  if (name === "category") return "topic";
  if (name === "chapter" || name === "unit") return "lesson";
  if (name === "tag") return "tags";
  if (name === "stem") return "question";
  if (name === "feedback") return "explanation";
  if (name === "answer explanation") return "explanation";
  if (name === "quote" || name === "citation") return "source";
  if (name === "source passage") return "source passage";
  return name;
}

function inferType(options: string[], correctIndices: number[]): QuestionType {
  if (
    options.length === 2 &&
    options[0].toLowerCase() === "true" &&
    options[1].toLowerCase() === "false"
  ) {
    return "true-false";
  }
  if (correctIndices.length >= 2) return "mcq-multi";
  return "mcq-single";
}

function coerceDifficulty(v: string | undefined): Difficulty {
  const s = (v || "").toLowerCase().trim();
  if (s === "easy" || s === "medium" || s === "hard") return s;
  return DEFAULT_METADATA.difficulty;
}

const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

function coerceBloom(v: string | undefined): BloomLevel {
  const s = (v || "").toLowerCase().trim();
  for (const b of BLOOM_LEVELS) {
    if (s === b) return b;
  }
  // Common synonyms
  if (s === "recall" || s === "knowledge") return "remember";
  if (s === "comprehend") return "understand";
  if (s === "application") return "apply";
  if (s === "analysis") return "analyze";
  if (s === "evaluation") return "evaluate";
  if (s === "creation" || s === "synthesis") return "create";
  return DEFAULT_METADATA.bloomLevel;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith("\u201c") && t.endsWith("\u201d"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializer
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkdownSerializeOptions {
  includeSourceField?: boolean;
  startIndex?: number;
}

export function serializeMarkdown(
  questions: PortableQuestion[],
  opts: MarkdownSerializeOptions = {},
): string {
  const includeSource = opts.includeSourceField ?? true;
  const start = opts.startIndex ?? 1;
  const out: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (i > 0) {
      out.push("");
      out.push("---");
      out.push("");
    }

    out.push(`## Q${start + i}`);
    out.push(`**Type:** ${q.type}`);
    out.push(`**Difficulty:** ${q.difficulty}`);
    out.push(`**Bloom:** ${q.bloomLevel}`);
    if (q.subject) out.push(`**Subject:** ${q.subject}`);
    if (q.lesson) out.push(`**Lesson:** ${q.lesson}`);
    out.push(`**Topic:** ${q.topic}`);
    if (q.tags && q.tags.length > 0) {
      out.push(`**Tags:** ${q.tags.join(", ")}`);
    }
    out.push("");
    out.push(`**Question:** ${oneLine(q.question)}`);
    out.push("");

    const correct = Array.isArray(q.correctAnswer)
      ? new Set(q.correctAnswer)
      : new Set([q.correctAnswer]);

    for (let j = 0; j < q.options.length; j++) {
      const mark = correct.has(j) ? "x" : " ";
      out.push(`- [${mark}] ${oneLine(q.options[j])}`);
    }

    out.push("");
    if (q.explanation) {
      out.push(`**Explanation:** ${oneLine(q.explanation)}`);
    }
    if (includeSource && q.sourcePassage) {
      out.push(`**Source:** "${oneLine(q.sourcePassage).replace(/"/g, '\\"')}"`);
    }
  }

  return out.join("\n") + "\n";
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}
