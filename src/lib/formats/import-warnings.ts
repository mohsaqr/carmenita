import type { PortableQuestion } from "./types";

/** How many offending questions a summary warning names before "… and N more". */
const MAX_NAMED = 10;

/** True for a multi-answer question with every option marked correct. */
export function isAllCorrect(q: PortableQuestion): boolean {
  return (
    q.type === "mcq-multi" &&
    Array.isArray(q.correctAnswer) &&
    q.options.length > 1 &&
    new Set(q.correctAnswer).size === q.options.length
  );
}

function shortStem(stem: string): string {
  const oneLine = stem.replace(/\s+/g, " ").trim();
  return oneLine.length > 50 ? `${oneLine.slice(0, 50)}…` : oneLine;
}

/**
 * One summary warning naming the imported questions whose options are
 * ALL marked correct — usually a chatbot shortcut rather than a real
 * question design, so the user should check them. Null when none.
 * Format-agnostic: GIFT (all `=`) and Markdown (all `[x]`) can both
 * produce these.
 */
export function allCorrectWarning(questions: PortableQuestion[]): string | null {
  const flagged = questions.filter(isAllCorrect);
  if (flagged.length === 0) return null;
  const n = flagged.length;
  const named = flagged
    .slice(0, MAX_NAMED)
    .map((q) => `"${shortStem(q.question)}"`)
    .join("; ");
  const more = n > MAX_NAMED ? ` … and ${n - MAX_NAMED} more` : "";
  return (
    `${n} question${n === 1 ? " has" : "s have"} every option marked correct ` +
    `— check this is intended: ${named}${more}`
  );
}

/** Parser warnings plus the import-level checks above. */
export function importWarnings(
  questions: PortableQuestion[],
  parserWarnings: string[],
): string[] {
  const allCorrect = allCorrectWarning(questions);
  return allCorrect ? [...parserWarnings, allCorrect] : parserWarnings;
}
