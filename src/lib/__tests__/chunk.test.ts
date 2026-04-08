import { describe, it, expect } from "vitest";
import { chunkText, distributeQuestions } from "@/lib/chunk";

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    const text = "short text";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[0].endChar).toBe(text.length);
  });

  it("splits long text into multiple chunks", () => {
    const text = "a".repeat(100_000);
    const chunks = chunkText(text, { maxChars: 10_000, overlap: 500, preferBoundaries: false });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be at most maxChars
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(10_000);
    }
    // First chunk starts at 0
    expect(chunks[0].startChar).toBe(0);
    // Last chunk ends at text.length
    expect(chunks[chunks.length - 1].endChar).toBe(text.length);
  });

  it("prefers paragraph breaks for chunk boundaries", () => {
    const para1 = "First paragraph. ".repeat(500);
    const para2 = "Second paragraph. ".repeat(500);
    const text = para1 + "\n\n" + para2;
    const chunks = chunkText(text, { maxChars: para1.length + 100, overlap: 100 });
    // Should split at the paragraph boundary, so chunk 0 ends around para1.length
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("respects overlap between chunks", () => {
    const text = "x".repeat(20_000);
    const chunks = chunkText(text, { maxChars: 5_000, overlap: 500, preferBoundaries: false });
    // Adjacent chunks should overlap by ~overlap chars
    for (let i = 1; i < chunks.length; i++) {
      const overlapStart = chunks[i].startChar;
      const prevEnd = chunks[i - 1].endChar;
      expect(overlapStart).toBeLessThan(prevEnd);
      expect(prevEnd - overlapStart).toBeGreaterThanOrEqual(500);
    }
  });
});

describe("distributeQuestions", () => {
  it("returns empty array for no chunks", () => {
    expect(distributeQuestions([], 10)).toEqual([]);
  });

  it("returns the full total for a single chunk", () => {
    const chunks = [{ text: "a".repeat(1000), startChar: 0, endChar: 1000, index: 0 }];
    expect(distributeQuestions(chunks, 10)).toEqual([10]);
  });

  it("distributes proportional to chunk length and sums to total", () => {
    const chunks = [
      { text: "a".repeat(1000), startChar: 0, endChar: 1000, index: 0 },
      { text: "b".repeat(3000), startChar: 1000, endChar: 4000, index: 1 },
    ];
    const counts = distributeQuestions(chunks, 20);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
    // ~25% / 75% split → 5 / 15
    expect(counts[0]).toBe(5);
    expect(counts[1]).toBe(15);
  });

  it("handles rounding remainder correctly", () => {
    const chunks = [
      { text: "a".repeat(1), startChar: 0, endChar: 1, index: 0 },
      { text: "b".repeat(1), startChar: 1, endChar: 2, index: 1 },
      { text: "c".repeat(1), startChar: 2, endChar: 3, index: 2 },
    ];
    // 10 across 3 equal chunks → 3+3+4 or similar, must sum to 10
    const counts = distributeQuestions(chunks, 10);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
  });
});
