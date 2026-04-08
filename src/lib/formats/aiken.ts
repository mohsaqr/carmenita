import type { PortableQuestion } from "./types";
import { DEFAULT_METADATA } from "./types";

/**
 * Aiken format — Moodle's ultra-simple plaintext quiz format.
 * https://docs.moodle.org/en/Aiken_format
 *
 * Grammar (one question per block, blocks separated by blank lines):
 *
 *   Question stem (one line, or continuation lines until the first option)
 *   A. First option
 *   B. Second option
 *   C. Third option
 *   D. Fourth option
 *   ANSWER: B
 *
 * Constraints the format enforces:
 *   • Options must be A through Z (we allow 2–26 options).
 *   • The stem is a single logical line (we accept multi-line stems as long
 *     as none of the continuation lines looks like an option or ANSWER line).
 *   • The correct answer is a single letter — mcq-multi is NOT supported.
 *   • There is NO feedback, explanation, category, difficulty, or any
 *     metadata whatsoever.
 *
 * Carmenita → Aiken is LOSSY:
 *   • mcq-multi questions are skipped during export with a warning.
 *   • explanation, bloomLevel, difficulty, topic, sourcePassage are
 *     DISCARDED. There is nowhere to put them in valid Aiken.
 *
 * Aiken → Carmenita:
 *   • All metadata defaults to DEFAULT_METADATA.
 *   • type is always mcq-single (or true-false when the options are
 *     exactly ["True", "False"] case-insensitively).
 */

export interface AikenParseResult {
  questions: PortableQuestion[];
  warnings: string[];
}

export function parseAiken(text: string): AikenParseResult {
  const warnings: string[] = [];
  const questions: PortableQuestion[] = [];

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return { questions, warnings };

  // Split into blocks by blank lines
  const rawBlocks = normalized.split(/\n\s*\n/);

  for (const rawBlock of rawBlocks) {
    try {
      const q = parseAikenBlock(rawBlock.trim());
      if (q) questions.push(q);
    } catch (err) {
      warnings.push(
        `Skipped block: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { questions, warnings };
}

const OPTION_LINE = /^([A-Z])[.)]\s*(.+)$/;
const ANSWER_LINE = /^ANSWER:\s*([A-Z])\s*$/i;

function parseAikenBlock(block: string): PortableQuestion | null {
  if (!block) return null;
  const lines = block.split("\n");

  const options: string[] = [];
  const optionLetters: string[] = [];
  let answerLetter: string | null = null;
  const stemLines: string[] = [];

  // The stem is every line BEFORE the first option line. The ANSWER
  // line is the last line.
  let seenOption = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const ans = line.match(ANSWER_LINE);
    if (ans) {
      answerLetter = ans[1].toUpperCase();
      continue;
    }

    const opt = line.match(OPTION_LINE);
    if (opt) {
      seenOption = true;
      optionLetters.push(opt[1]);
      options.push(opt[2].trim());
      continue;
    }

    if (seenOption) {
      // A non-option, non-answer line after options have started is illegal
      throw new Error(
        `Unexpected line after options (Aiken does not allow stem continuation after options): "${line}"`,
      );
    }
    stemLines.push(line);
  }

  if (stemLines.length === 0) throw new Error("Missing question stem");
  if (options.length < 2) throw new Error("Need at least 2 options");
  if (options.length > 26) throw new Error("Aiken supports at most 26 options");
  if (answerLetter === null) throw new Error("Missing ANSWER: line");

  // Verify options are contiguous letters starting from A
  for (let i = 0; i < optionLetters.length; i++) {
    const expected = String.fromCharCode(65 + i);
    if (optionLetters[i] !== expected) {
      throw new Error(
        `Options must be consecutive letters starting from A (got ${optionLetters.join(",")})`,
      );
    }
  }

  const answerIdx = answerLetter.charCodeAt(0) - 65;
  if (answerIdx < 0 || answerIdx >= options.length) {
    throw new Error(`ANSWER: ${answerLetter} is out of range`);
  }

  const stem = stemLines.join(" ");

  // Detect true/false shaped questions
  const isTrueFalse =
    options.length === 2 &&
    options[0].toLowerCase().trim() === "true" &&
    options[1].toLowerCase().trim() === "false";

  return {
    type: isTrueFalse ? "true-false" : "mcq-single",
    question: stem,
    options: isTrueFalse ? ["True", "False"] : options,
    correctAnswer: answerIdx,
    explanation: DEFAULT_METADATA.explanation,
    difficulty: DEFAULT_METADATA.difficulty,
    bloomLevel: DEFAULT_METADATA.bloomLevel,
    subject: DEFAULT_METADATA.subject,
    lesson: DEFAULT_METADATA.lesson,
    topic: DEFAULT_METADATA.topic,
    tags: [],
    sourcePassage: DEFAULT_METADATA.sourcePassage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

export interface AikenSerializeResult {
  text: string;
  skipped: Array<{ index: number; reason: string }>;
}

/**
 * Serialize PortableQuestion[] to Aiken text.
 *
 * Lossy — Aiken cannot represent:
 *   • mcq-multi questions (skipped with a reason)
 *   • explanation, difficulty, bloomLevel, topic, sourcePassage (dropped)
 *
 * Returns both the text AND a list of skipped question indices so the
 * caller can display a warning to the user.
 */
export function serializeAiken(questions: PortableQuestion[]): AikenSerializeResult {
  const out: string[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (q.type === "mcq-multi") {
      skipped.push({
        index: i,
        reason: "mcq-multi questions are not supported by Aiken format",
      });
      continue;
    }
    if (q.options.length > 26) {
      skipped.push({
        index: i,
        reason: `Aiken supports at most 26 options (this question has ${q.options.length})`,
      });
      continue;
    }

    const correctIdx =
      typeof q.correctAnswer === "number" ? q.correctAnswer : q.correctAnswer[0];
    if (correctIdx < 0 || correctIdx >= q.options.length) {
      skipped.push({ index: i, reason: "Correct answer index is out of range" });
      continue;
    }

    // Question stem must be a single line — collapse newlines to spaces
    const stem = q.question.replace(/\s*\n\s*/g, " ").trim();

    if (i > 0) out.push("");
    out.push(stem);
    for (let j = 0; j < q.options.length; j++) {
      const letter = String.fromCharCode(65 + j);
      // Collapse newlines inside options too
      const optText = q.options[j].replace(/\s*\n\s*/g, " ").trim();
      out.push(`${letter}. ${optText}`);
    }
    out.push(`ANSWER: ${String.fromCharCode(65 + correctIdx)}`);
  }

  return { text: out.join("\n") + "\n", skipped };
}
