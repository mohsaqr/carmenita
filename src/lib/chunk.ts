/**
 * Character-based text chunking. No tokenizer dependency — we target a
 * character count that's conservative enough to fit in any provider's
 * context window when paired with the MCQ prompt (~1500 tokens of
 * instructions + ~10k tokens for response).
 *
 * Default: 40 000 characters per chunk with 1 000 character overlap.
 * This yields roughly 10 000 tokens per chunk for English text, leaving
 * plenty of room for the prompt and the JSON response.
 */

export interface Chunk {
  text: string;
  startChar: number;
  endChar: number;
  index: number;
}

export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
  preferBoundaries?: boolean;
}

const DEFAULTS: Required<ChunkOptions> = {
  maxChars: 40_000,
  overlap: 1_000,
  preferBoundaries: true,
};

/**
 * Split text into overlapping chunks. If `preferBoundaries` is true
 * (default), chunk boundaries are shifted backward to the nearest
 * paragraph break (double newline), sentence end (`. ? !`), or single
 * newline — whichever is closest. This avoids cutting sentences in half.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const { maxChars, overlap, preferBoundaries } = { ...DEFAULTS, ...options };

  if (text.length <= maxChars) {
    return [{ text, startChar: 0, endChar: text.length, index: 0 }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    // If we're not at the tail, prefer to end on a natural boundary
    if (preferBoundaries && end < text.length) {
      const window = text.slice(Math.max(start, end - 500), end);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const sentenceEnd = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
      );
      const lineBreak = window.lastIndexOf("\n");
      const offset =
        paragraphBreak >= 0
          ? paragraphBreak + 2
          : sentenceEnd >= 0
            ? sentenceEnd + 2
            : lineBreak >= 0
              ? lineBreak + 1
              : -1;
      if (offset > 0) {
        end = Math.max(start + 1, end - 500) + offset;
      }
    }

    chunks.push({
      text: text.slice(start, end),
      startChar: start,
      endChar: end,
      index,
    });
    index += 1;

    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

/**
 * Distribute a total question count across N chunks, weighted by chunk
 * length. Returns an array of ints summing to `total` (within rounding).
 */
export function distributeQuestions(chunks: Chunk[], total: number): number[] {
  if (chunks.length === 0) return [];
  if (chunks.length === 1) return [total];

  const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const raw = chunks.map((c) => (c.text.length / totalChars) * total);
  const counts = raw.map((r) => Math.floor(r));
  let remaining = total - counts.reduce((a, b) => a + b, 0);

  // Distribute the rounding remainder to the chunks with the largest
  // fractional parts.
  const fractional = raw.map((r, i) => ({ i, frac: r - Math.floor(r) }));
  fractional.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining && k < fractional.length; k++) {
    counts[fractional[k].i] += 1;
  }
  remaining = total - counts.reduce((a, b) => a + b, 0);
  // Any leftover goes to chunk 0 (edge case when total < chunks.length)
  if (remaining > 0) counts[0] += remaining;

  // Ensure every chunk gets at least 1 if possible
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0 && counts.some((c) => c > 1)) {
      const donorIdx = counts.indexOf(Math.max(...counts));
      counts[donorIdx] -= 1;
      counts[i] = 1;
    }
  }

  return counts;
}
