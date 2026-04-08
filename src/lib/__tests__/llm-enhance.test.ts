import { describe, it, expect } from "vitest";
import { buildExplanationPrompt, buildTaggingPrompt } from "@/lib/llm-enhance";
import type { Question } from "@/types";

/**
 * Tests for the enhance prompt builders (add-explanation and auto-tag).
 * No real LLM calls — we just verify that each builder embeds the
 * right pieces of the question into the rendered prompt.
 */

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-test",
    type: "mcq-single",
    question: "What is the capital of France?",
    options: ["Berlin", "Paris", "London", "Madrid"],
    correctAnswer: 1,
    explanation: "",
    difficulty: "easy",
    bloomLevel: "remember",
    subject: null,
    lesson: null,
    topic: "european capitals",
    tags: [],
    sourcePassage: "",
    sourceType: "gift-import",
    sourceDocumentId: null,
    sourceLabel: null,
    parentQuestionId: null,
    variationType: null,
    notes: null,
    createdAt: "2026-04-08T00:00:00Z",
    userId: null,
    ...overrides,
  };
}

describe("buildExplanationPrompt", () => {
  it("embeds the question stem", () => {
    const p = buildExplanationPrompt(makeQuestion());
    expect(p).toContain("What is the capital of France?");
  });

  it("embeds all options with letter labels", () => {
    const p = buildExplanationPrompt(makeQuestion());
    expect(p).toContain("A. Berlin");
    expect(p).toContain("B. Paris");
    expect(p).toContain("C. London");
    expect(p).toContain("D. Madrid");
  });

  it("describes the correct answer by letter AND by literal value", () => {
    const p = buildExplanationPrompt(makeQuestion());
    expect(p).toContain("Option B");
    expect(p).toContain("Paris");
  });

  it("describes a multi-answer correctAnswer array with multiple letters", () => {
    const q = makeQuestion({
      type: "mcq-multi",
      options: ["Red", "Green", "Blue", "Yellow"],
      correctAnswer: [0, 2],
    });
    const p = buildExplanationPrompt(q);
    expect(p).toContain("Options A, C");
    expect(p).toContain("Red");
    expect(p).toContain("Blue");
  });

  it("embeds the current explanation when present", () => {
    const q = makeQuestion({ explanation: "Paris has been the capital since 987." });
    const p = buildExplanationPrompt(q);
    expect(p).toContain("Paris has been the capital since 987.");
  });

  it("uses '(none)' placeholder when explanation is empty", () => {
    const p = buildExplanationPrompt(makeQuestion({ explanation: "" }));
    expect(p).toContain("(none)");
  });

  it("instructs 1-2 sentence output", () => {
    const p = buildExplanationPrompt(makeQuestion());
    expect(p).toMatch(/1.{0,4}2\s+sentence/i);
  });

  it("leaves no unsubstituted placeholders", () => {
    const p = buildExplanationPrompt(makeQuestion());
    expect(p).not.toMatch(/\{question\}/);
    expect(p).not.toMatch(/\{optionsList\}/);
    expect(p).not.toMatch(/\{correctAnswer\}/);
    expect(p).not.toMatch(/\{currentExplanation\}/);
  });
});

describe("buildTaggingPrompt", () => {
  it("embeds the question stem", () => {
    const p = buildTaggingPrompt(makeQuestion());
    expect(p).toContain("What is the capital of France?");
  });

  it("embeds options with letter labels", () => {
    const p = buildTaggingPrompt(makeQuestion());
    expect(p).toContain("A. Berlin");
    expect(p).toContain("B. Paris");
  });

  it("embeds the existing explanation if present", () => {
    const q = makeQuestion({ explanation: "Paris since 987 AD." });
    const p = buildTaggingPrompt(q);
    expect(p).toContain("Paris since 987 AD.");
  });

  it("embeds '(none)' when explanation is empty", () => {
    const p = buildTaggingPrompt(makeQuestion({ explanation: "" }));
    expect(p).toContain("(none)");
  });

  it("requires at least 2 tags", () => {
    const p = buildTaggingPrompt(makeQuestion());
    expect(p).toMatch(/at\s+least\s+2/i);
  });

  it("instructs the LLM to return a JSON object with 4 fields", () => {
    const p = buildTaggingPrompt(makeQuestion());
    expect(p).toContain("subject");
    expect(p).toContain("lesson");
    expect(p).toContain("topic");
    expect(p).toContain("tags");
  });

  it("leaves no unsubstituted placeholders", () => {
    const p = buildTaggingPrompt(makeQuestion());
    expect(p).not.toMatch(/\{question\}/);
    expect(p).not.toMatch(/\{optionsList\}/);
    expect(p).not.toMatch(/\{correctAnswer\}/);
    expect(p).not.toMatch(/\{explanation\}/);
  });
});
