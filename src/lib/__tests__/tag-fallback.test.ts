import { describe, it, expect } from "vitest";
import { ensureTags } from "@/lib/tag-fallback";
import type { ParsedQuestion } from "@/lib/question-schema";

/**
 * Pure unit tests for ensureTags(). No LLM mocking needed — this is
 * deterministic logic that takes a question + defaults and returns a
 * normalized tag set.
 */

function sampleQ(overrides: Partial<ParsedQuestion> = {}): ParsedQuestion {
  return {
    type: "mcq-single",
    question: "What is photosynthesis?",
    options: ["A biochemical process", "A type of rock", "A star", "A number"],
    correctAnswer: 0,
    explanation: "It's the process plants use to make food from sunlight.",
    difficulty: "easy",
    bloomLevel: "understand",
    subject: null,
    lesson: null,
    topic: "photosynthesis",
    tags: [],
    sourcePassage: "Photosynthesis is a biological process.",
    ...overrides,
  };
}

describe("ensureTags", () => {
  it("keeps LLM tags when already ≥ 2", () => {
    const q = sampleQ({ tags: ["biology", "chloroplasts", "plants"] });
    const out = ensureTags(q);
    expect(out.tags).toEqual(["biology", "chloroplasts", "plants"]);
  });

  it("normalizes to lowercase and hyphenates multi-word tags", () => {
    const q = sampleQ({ tags: ["Cell Biology", "Photo Synthesis"] });
    const out = ensureTags(q);
    expect(out.tags).toContain("cell-biology");
    expect(out.tags).toContain("photo-synthesis");
  });

  it("dedupes tags case-insensitively", () => {
    const q = sampleQ({ tags: ["Biology", "biology", "BIOLOGY", "plants"] });
    const out = ensureTags(q);
    expect(out.tags).toEqual(["biology", "plants"]);
  });

  it("falls back to batch defaults when LLM produced 0 tags", () => {
    const q = sampleQ({ tags: [] });
    const out = ensureTags(q, {
      subject: null,
      lesson: null,
      tags: ["biology", "plants"],
    });
    expect(out.tags).toEqual(["biology", "plants"]);
  });

  it("falls back to topic when LLM produced 0 tags and no defaults", () => {
    const q = sampleQ({ tags: [], topic: "cellular respiration" });
    const out = ensureTags(q);
    // topic becomes a single hyphenated tag
    expect(out.tags).toContain("cellular-respiration");
    // and we've added subject/lesson if present — neither here, so the
    // minimum is just the topic-derived tag. Still satisfies the ≥1
    // guarantee, but NOT the ≥2 target when absolutely nothing else
    // exists. The function tries its best but won't fabricate.
    expect(out.tags.length).toBeGreaterThanOrEqual(1);
  });

  it("augments with subject + lesson when LLM only produced 1 tag", () => {
    const q = sampleQ({
      tags: ["biology"],
      subject: "biology",
      lesson: "plant physiology",
      topic: "photosynthesis",
    });
    const out = ensureTags(q);
    expect(out.tags).toContain("biology");
    // Should pull in topic or lesson to pad to ≥ 2
    expect(out.tags.length).toBeGreaterThanOrEqual(2);
  });

  it("caps at 6 tags maximum", () => {
    const q = sampleQ({
      tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    });
    const out = ensureTags(q);
    expect(out.tags.length).toBeLessThanOrEqual(6);
  });

  it("strips empty strings and whitespace-only tags", () => {
    const q = sampleQ({ tags: ["biology", "", "   ", "plants"] });
    const out = ensureTags(q);
    expect(out.tags).toEqual(["biology", "plants"]);
  });

  it("strips punctuation other than hyphens", () => {
    const q = sampleQ({ tags: ["plant!", "cell@biology", "photo-synthesis"] });
    const out = ensureTags(q);
    expect(out.tags).toContain("plant");
    expect(out.tags).toContain("cellbiology");
    expect(out.tags).toContain("photo-synthesis");
  });

  it("collapses multiple hyphens into one", () => {
    const q = sampleQ({ tags: ["cell---biology", "plant  physiology"] });
    const out = ensureTags(q);
    expect(out.tags).toContain("cell-biology");
    expect(out.tags).toContain("plant-physiology");
  });

  it("trims leading and trailing hyphens", () => {
    const q = sampleQ({ tags: ["-biology-", "--plants--"] });
    const out = ensureTags(q);
    expect(out.tags).toContain("biology");
    expect(out.tags).toContain("plants");
  });

  it("does not mutate the input question", () => {
    const q = sampleQ({ tags: ["original"] });
    const frozenTags = [...q.tags];
    ensureTags(q, { subject: null, lesson: null, tags: ["default"] });
    expect(q.tags).toEqual(frozenTags);
  });
});
