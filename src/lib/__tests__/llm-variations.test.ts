import { describe, it, expect } from "vitest";
import {
  buildVariationPrompt,
  VARIATION_TYPE_LABELS,
} from "@/lib/llm-variations";
import type { Question, VariationType } from "@/types";

/**
 * Tests for the variation prompt builder. We don't hit a real LLM here
 * — just verify that each prompt contains the correct instructions, the
 * original question is inlined, and the prompt is self-consistent (enum
 * values match our types).
 */

const sampleQuestion: Question = {
  id: "q-123",
  type: "mcq-single",
  question: "What is the capital of France?",
  options: ["Berlin", "Paris", "London", "Madrid"],
  correctAnswer: 1,
  explanation: "Paris has been the capital of France since 987 AD.",
  difficulty: "easy",
  bloomLevel: "remember",
  subject: "geography",
  lesson: "european nations",
  topic: "european capitals",
  tags: ["france", "capitals"],
  sourcePassage: "Paris is the capital and most populous city of France.",
  sourceType: "document",
  sourceDocumentId: null,
  sourceLabel: null,
  parentQuestionId: null,
  variationType: null,
  notes: null,
  createdAt: "2026-04-08T00:00:00Z",
  userId: null,
};

describe("buildVariationPrompt", () => {
  const types: VariationType[] = [
    "topic",
    "distractors",
    "paraphrase",
    "harder",
    "easier",
  ];

  for (const type of types) {
    describe(`type: ${type}`, () => {
      it("embeds the original question stem", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("What is the capital of France?");
      });

      it("embeds all options with letter labels", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("A. Berlin");
        expect(prompt).toContain("B. Paris");
        expect(prompt).toContain("C. London");
        expect(prompt).toContain("D. Madrid");
      });

      it("embeds the correct answer reference", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("Correct answer(s): B");
      });

      it("embeds the original explanation", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("Paris has been the capital of France since 987 AD.");
      });

      it("embeds topic, difficulty, and Bloom level", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("Topic: european capitals");
        expect(prompt).toContain("Difficulty: easy");
        expect(prompt).toContain("Bloom level: remember");
      });

      it("embeds the exact requested count", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 7);
        expect(prompt).toContain("exactly 7");
      });

      it("includes the strict JSON output rules", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toContain("JSON array");
        expect(prompt).toMatch(/mcq-single.*mcq-multi.*true-false/);
        expect(prompt).toContain("Return ONLY");
      });

      it("forbids code fences", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toMatch(/No code fences|No code fence|Do not wrap/i);
      });

      it("has the expert educator role", () => {
        const prompt = buildVariationPrompt(type, sampleQuestion, 3);
        expect(prompt).toMatch(/expert educator/i);
      });
    });
  }

  it("topic variation asks for a DIFFERENT aspect", () => {
    const prompt = buildVariationPrompt("topic", sampleQuestion, 3);
    expect(prompt).toMatch(/DIFFERENT aspect/i);
  });

  it("distractors variation preserves stem and correct answer", () => {
    const prompt = buildVariationPrompt("distractors", sampleQuestion, 3);
    expect(prompt).toMatch(/KEEP THE SAME stem/);
    expect(prompt).toMatch(/KEEP THE SAME correct answer/i);
    expect(prompt).toMatch(/REPLACE the wrong options/i);
  });

  it("paraphrase variation preserves meaning", () => {
    const prompt = buildVariationPrompt("paraphrase", sampleQuestion, 3);
    expect(prompt).toMatch(/same meaning/i);
    expect(prompt).toMatch(/not change the factual content/i);
  });

  it("harder variation sets difficulty to hard", () => {
    const prompt = buildVariationPrompt("harder", sampleQuestion, 3);
    expect(prompt).toMatch(/difficulty.*hard/i);
  });

  it("easier variation sets difficulty to easy", () => {
    const prompt = buildVariationPrompt("easier", sampleQuestion, 3);
    expect(prompt).toMatch(/difficulty.*easy/i);
  });

  it("handles mcq-multi originals (array of correct answers)", () => {
    const multi: Question = {
      ...sampleQuestion,
      type: "mcq-multi",
      question: "Which are primary colors?",
      options: ["Red", "Green", "Blue", "Yellow"],
      correctAnswer: [0, 1, 2],
    };
    const prompt = buildVariationPrompt("topic", multi, 3);
    // Correct answer(s) line should include all three letters
    expect(prompt).toContain("Correct answer(s): A, B, C");
  });

  it("handles missing source passage gracefully", () => {
    const noSrc: Question = { ...sampleQuestion, sourcePassage: "" };
    const prompt = buildVariationPrompt("topic", noSrc, 3);
    // Should not crash; should omit the Source passage line
    expect(prompt).not.toMatch(/Source passage:\s*""/);
  });
});

describe("VARIATION_TYPE_LABELS", () => {
  it("has a label and description for every variation type", () => {
    for (const type of ["topic", "distractors", "paraphrase", "harder", "easier"] as const) {
      const info = VARIATION_TYPE_LABELS[type];
      expect(info.label).toBeTruthy();
      expect(info.description.length).toBeGreaterThan(20);
    }
  });
});
