import { describe, it, expect, vi } from "vitest";
import { parseQuestionArray, QuestionSchema } from "@/lib/question-schema";

describe("QuestionSchema", () => {
  const validMcqSingle = {
    type: "mcq-single",
    question: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    correctAnswer: 0,
    explanation: "Paris has been the capital of France since 987 AD.",
    difficulty: "easy",
    bloomLevel: "remember",
    topic: "european capitals",
    sourcePassage: "Paris is the capital and most populous city of France.",
  };

  const validTrueFalse = {
    type: "true-false",
    question: "The Earth is flat.",
    options: ["True", "False"],
    correctAnswer: 1,
    explanation: "The Earth is an oblate spheroid.",
    difficulty: "easy",
    bloomLevel: "understand",
    topic: "earth shape",
    sourcePassage: "Earth is approximately spherical.",
  };

  const validMcqMulti = {
    type: "mcq-multi",
    question: "Which of these are primary colors?",
    options: ["Red", "Green", "Blue", "Purple"],
    correctAnswer: [0, 1, 2],
    explanation: "Red, green, and blue are primary colors in additive color.",
    difficulty: "medium",
    bloomLevel: "apply",
    topic: "color theory",
    sourcePassage: "Primary colors can be mixed to produce all other colors.",
  };

  it("accepts a valid mcq-single question", () => {
    expect(QuestionSchema.safeParse(validMcqSingle).success).toBe(true);
  });

  it("accepts a valid true-false question", () => {
    expect(QuestionSchema.safeParse(validTrueFalse).success).toBe(true);
  });

  it("accepts a valid mcq-multi question", () => {
    expect(QuestionSchema.safeParse(validMcqMulti).success).toBe(true);
  });

  it("rejects mcq-single with out-of-range correctAnswer", () => {
    const bad = { ...validMcqSingle, correctAnswer: 5 };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects true-false with wrong options", () => {
    const bad = { ...validTrueFalse, options: ["Yes", "No"] };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects mcq-multi with only one correct answer", () => {
    const bad = { ...validMcqMulti, correctAnswer: [0] };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects mcq-multi where all options are correct", () => {
    const bad = { ...validMcqMulti, correctAnswer: [0, 1, 2, 3] };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects mcq-multi with duplicate indices", () => {
    const bad = { ...validMcqMulti, correctAnswer: [0, 0, 1] };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const bad = { ...validMcqSingle } as unknown as Record<string, unknown>;
    delete bad.explanation;
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid enum values", () => {
    const bad = { ...validMcqSingle, difficulty: "impossible" };
    expect(QuestionSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...validMcqSingle, bloomLevel: "synthesize" };
    expect(QuestionSchema.safeParse(bad2).success).toBe(false);
  });
});

describe("parseQuestionArray", () => {
  const validArray = [
    {
      type: "mcq-single",
      question: "What is 2+2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: 1,
      explanation: "Basic arithmetic.",
      difficulty: "easy",
      bloomLevel: "remember",
      topic: "arithmetic",
      sourcePassage: "2+2=4.",
    },
  ];

  it("parses a clean JSON array", () => {
    const raw = JSON.stringify(validArray);
    const parsed = parseQuestionArray(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe("What is 2+2?");
  });

  it("strips triple-backtick code fences", () => {
    const raw = "```json\n" + JSON.stringify(validArray) + "\n```";
    const parsed = parseQuestionArray(raw);
    expect(parsed).toHaveLength(1);
  });

  it("ignores prose before and after the array", () => {
    const raw = "Here are the questions:\n\n" + JSON.stringify(validArray) + "\n\nHope this helps!";
    const parsed = parseQuestionArray(raw);
    expect(parsed).toHaveLength(1);
  });

  it("drops invalid questions but keeps valid ones", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mixed = [
      validArray[0],
      { type: "nonsense" }, // invalid
      { ...validArray[0], correctAnswer: -1 }, // invalid
    ];
    const parsed = parseQuestionArray(JSON.stringify(mixed));
    expect(parsed).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws if zero questions are valid", () => {
    const allBad = [{ foo: "bar" }, { type: "nonsense" }];
    expect(() => parseQuestionArray(JSON.stringify(allBad))).toThrow();
  });

  it("throws on non-JSON input", () => {
    expect(() => parseQuestionArray("not json")).toThrow();
  });

  it("throws on JSON that isn't an array", () => {
    expect(() => parseQuestionArray('{"foo": "bar"}')).toThrow();
  });
});
