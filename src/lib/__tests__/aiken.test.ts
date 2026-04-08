import { describe, it, expect } from "vitest";
import { parseAiken, serializeAiken } from "@/lib/formats/aiken";
import type { PortableQuestion } from "@/lib/formats/types";

const sampleMcq: PortableQuestion = {
  type: "mcq-single",
  question: "What is the capital of France?",
  options: ["Berlin", "Paris", "London", "Madrid"],
  correctAnswer: 1,
  explanation: "Paris has been the capital of France since 987 AD.",
  difficulty: "easy",
  bloomLevel: "remember",
  subject: null,
  lesson: null,
  topic: "european capitals",
  tags: [],
  sourcePassage: "Paris is the capital city of France.",
};

const sampleTf: PortableQuestion = {
  type: "true-false",
  question: "The Earth is flat.",
  options: ["True", "False"],
  correctAnswer: 1,
  explanation: "The Earth is an oblate spheroid.",
  difficulty: "easy",
  bloomLevel: "understand",
  subject: null,
  lesson: null,
  topic: "earth shape",
  tags: [],
  sourcePassage: "",
};

const sampleMulti: PortableQuestion = {
  type: "mcq-multi",
  question: "Which of these are primary colors?",
  options: ["Red", "Green", "Blue", "Yellow"],
  correctAnswer: [0, 1, 2],
  explanation: "",
  difficulty: "medium",
  bloomLevel: "apply",
  subject: null,
  lesson: null,
  topic: "color theory",
  tags: [],
  sourcePassage: "",
};

describe("parseAiken", () => {
  it("parses a standard multi-question Aiken file", () => {
    const input = `What is the capital of France?
A. Berlin
B. Paris
C. London
D. Madrid
ANSWER: B

What is 2 plus 2?
A. Three
B. Four
C. Five
ANSWER: B`;
    const { questions, warnings } = parseAiken(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(2);

    expect(questions[0].type).toBe("mcq-single");
    expect(questions[0].question).toBe("What is the capital of France?");
    expect(questions[0].options).toEqual(["Berlin", "Paris", "London", "Madrid"]);
    expect(questions[0].correctAnswer).toBe(1);

    expect(questions[1].options).toEqual(["Three", "Four", "Five"]);
    expect(questions[1].correctAnswer).toBe(1);
  });

  it("recognizes true/false-shaped questions", () => {
    const input = `The Earth is flat.
A. True
B. False
ANSWER: B`;
    const { questions, warnings } = parseAiken(input);
    expect(warnings).toHaveLength(0);
    expect(questions[0].type).toBe("true-false");
    expect(questions[0].options).toEqual(["True", "False"]);
    expect(questions[0].correctAnswer).toBe(1);
  });

  it("accepts both A. and A) option markers", () => {
    const input = `Which is bigger?
A) One
B) Two
ANSWER: B`;
    const { questions, warnings } = parseAiken(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(["One", "Two"]);
  });

  it("handles multi-line stems", () => {
    const input = `This is the first line of the question.
This is the second line of the same stem.
A. Option A
B. Option B
ANSWER: A`;
    const { questions } = parseAiken(input);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toContain("first line");
    expect(questions[0].question).toContain("second line");
  });

  it("warns on blocks missing ANSWER line", () => {
    const input = `Missing answer line?
A. One
B. Two`;
    const { questions, warnings } = parseAiken(input);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ANSWER/);
  });

  it("warns on non-contiguous option letters", () => {
    const input = `Bad options
A. One
C. Three
ANSWER: A`;
    const { questions, warnings } = parseAiken(input);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("warns on out-of-range ANSWER", () => {
    const input = `Bad answer
A. One
B. Two
ANSWER: Z`;
    const { questions, warnings } = parseAiken(input);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("applies default metadata to imported questions", () => {
    const input = `Q?
A. a
B. b
ANSWER: A`;
    const { questions } = parseAiken(input);
    expect(questions[0].difficulty).toBe("medium");
    expect(questions[0].bloomLevel).toBe("understand");
    expect(questions[0].topic).toBe("imported");
    expect(questions[0].explanation).toBe("");
  });
});

describe("serializeAiken", () => {
  it("serializes a single mcq-single question", () => {
    const { text, skipped } = serializeAiken([sampleMcq]);
    expect(skipped).toHaveLength(0);
    expect(text).toContain("What is the capital of France?");
    expect(text).toContain("A. Berlin");
    expect(text).toContain("B. Paris");
    expect(text).toContain("ANSWER: B");
  });

  it("serializes true/false as mcq-single-style", () => {
    const { text, skipped } = serializeAiken([sampleTf]);
    expect(skipped).toHaveLength(0);
    expect(text).toContain("The Earth is flat.");
    expect(text).toContain("A. True");
    expect(text).toContain("B. False");
    expect(text).toContain("ANSWER: B");
  });

  it("drops explanation/difficulty/bloom/topic/sourcePassage silently", () => {
    const { text } = serializeAiken([sampleMcq]);
    expect(text).not.toContain("Paris has been the capital");
    expect(text).not.toContain("european capitals");
    expect(text).not.toContain("easy");
    expect(text).not.toContain("remember");
  });

  it("skips mcq-multi questions with a reason", () => {
    const { text, skipped } = serializeAiken([sampleMcq, sampleMulti]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].index).toBe(1);
    expect(skipped[0].reason).toMatch(/mcq-multi/);
    expect(text).toContain("What is the capital of France?");
    expect(text).not.toContain("Which of these are primary colors");
  });
});

describe("Aiken round-trip", () => {
  it("round-trips mcq-single (with default metadata on the way back)", () => {
    const { text } = serializeAiken([sampleMcq]);
    const { questions } = parseAiken(text);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.type).toBe("mcq-single");
    expect(q.question).toBe(sampleMcq.question);
    expect(q.options).toEqual(sampleMcq.options);
    expect(q.correctAnswer).toBe(sampleMcq.correctAnswer);
    // Metadata is lost on the round-trip
    expect(q.explanation).toBe("");
    expect(q.topic).toBe("imported");
  });

  it("round-trips true/false", () => {
    const { text } = serializeAiken([sampleTf]);
    const { questions } = parseAiken(text);
    expect(questions[0].type).toBe("true-false");
    expect(questions[0].correctAnswer).toBe(1);
  });
});
