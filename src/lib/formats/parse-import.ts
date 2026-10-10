import type { PortableQuestion } from "./types";
import { parseGift } from "./gift";
import { parseAiken } from "./aiken";
import { parseMarkdown } from "./markdown";
import { importWarnings } from "./import-warnings";

export const IMPORT_FORMATS = ["gift", "markdown", "aiken"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

const FORMAT_LABELS: Record<ImportFormat, string> = {
  gift: "GIFT",
  markdown: "Markdown",
  aiken: "Aiken",
};

const PARSERS: Record<
  ImportFormat,
  (text: string) => { questions: PortableQuestion[]; warnings: string[] }
> = {
  gift: parseGift,
  markdown: parseMarkdown,
  aiken: parseAiken,
};

export interface ImportParseResult {
  questions: PortableQuestion[];
  warnings: string[];
  /** The format the questions were actually parsed with. */
  format: ImportFormat;
}

/**
 * Parse import text in the format the user chose. If that finds no
 * questions at all, the user most likely picked the wrong format (e.g.
 * pasted GIFT with "Markdown" selected), so try the other formats and use
 * the one that finds the most questions, saying so in the first warning.
 * The chosen format always wins when it finds anything.
 *
 * Shared by the server import route and the static build's handler.
 * Warnings include the import-level checks from `importWarnings()`.
 */
export function parseImport(chosen: ImportFormat, text: string): ImportParseResult {
  const first = PARSERS[chosen](text);
  if (first.questions.length > 0) {
    return {
      questions: first.questions,
      warnings: importWarnings(first.questions, first.warnings),
      format: chosen,
    };
  }

  // Stable sort keeps IMPORT_FORMATS order on ties, so the choice is deterministic.
  const best = IMPORT_FORMATS.filter((f) => f !== chosen)
    .map((format) => ({ format, ...PARSERS[format](text) }))
    .filter((r) => r.questions.length > 0)
    .sort((a, b) => b.questions.length - a.questions.length)[0];

  if (!best) return { questions: [], warnings: first.warnings, format: chosen };

  const note =
    `This text is in ${FORMAT_LABELS[best.format]} format, not ` +
    `${FORMAT_LABELS[chosen]} — imported it as ${FORMAT_LABELS[best.format]}.`;
  return {
    questions: best.questions,
    warnings: [note, ...importWarnings(best.questions, best.warnings)],
    format: best.format,
  };
}
