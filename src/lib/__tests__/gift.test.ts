import { describe, it, expect } from "vitest";
import { parseGift, serializeGift } from "@/lib/formats/gift";
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
  question: "Which of these are primary colors in additive color mixing?",
  options: ["Red", "Green", "Blue", "Yellow"],
  correctAnswer: [0, 1, 2],
  explanation: "Red, green, and blue are the additive primary colors.",
  difficulty: "medium",
  bloomLevel: "apply",
  subject: null,
  lesson: null,
  topic: "color theory",
  tags: [],
  sourcePassage: "",
};

describe("parseGift", () => {
  it("parses a simple multiple-choice question", () => {
    const input = `What is the capital of France? {
  ~Berlin
  =Paris
  ~London
  ~Madrid
}####Paris has been the capital of France since 987 AD.`;
    const { questions, warnings } = parseGift(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.type).toBe("mcq-single");
    expect(q.question).toBe("What is the capital of France?");
    expect(q.options).toEqual(["Berlin", "Paris", "London", "Madrid"]);
    expect(q.correctAnswer).toBe(1);
    expect(q.explanation).toBe("Paris has been the capital of France since 987 AD.");
  });

  it("parses true/false shorthand", () => {
    const input = `The Earth is flat. {FALSE}####The Earth is an oblate spheroid.`;
    const { questions, warnings } = parseGift(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("true-false");
    expect(questions[0].correctAnswer).toBe(1);
    expect(questions[0].options).toEqual(["True", "False"]);
    expect(questions[0].explanation).toBe("The Earth is an oblate spheroid.");
  });

  it("uses per-answer feedback as explanation when question-level is missing", () => {
    const input = `What is 2+2? {
  ~3#Too low
  =4#Correct!
  ~5#Too high
}`;
    const { questions } = parseGift(input);
    expect(questions).toHaveLength(1);
    expect(questions[0].explanation).toBe("Correct!");
  });

  it("respects $CATEGORY: directive and splits hierarchy into subject/lesson/topic", () => {
    const input = `$CATEGORY: biology/plants

What color is chlorophyll? {
  =green
  ~red
  ~blue
}`;
    const { questions } = parseGift(input);
    // 2 segments → lesson + topic
    expect(questions[0].subject).toBeNull();
    expect(questions[0].lesson).toBe("biology");
    expect(questions[0].topic).toBe("plants");
  });

  it("splits a 3-level $CATEGORY: into subject/lesson/topic", () => {
    const input = `$CATEGORY: biology/plants/photosynthesis

What color is chlorophyll? {
  =green
  ~red
  ~blue
}`;
    const { questions } = parseGift(input);
    expect(questions[0].subject).toBe("biology");
    expect(questions[0].lesson).toBe("plants");
    expect(questions[0].topic).toBe("photosynthesis");
  });

  it("ignores comment lines", () => {
    const input = `// this is a comment
// another comment
What is the capital of France? {=Paris ~London}`;
    const { questions, warnings } = parseGift(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
  });

  it("parses multi-answer with ~% weights", () => {
    const input = `Which are primary colors? {
  ~%33.33333%Red
  ~%33.33333%Green
  ~%33.33333%Blue
  ~%-100%Yellow
}`;
    const { questions, warnings } = parseGift(input);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("mcq-multi");
    expect(questions[0].options).toEqual(["Red", "Green", "Blue", "Yellow"]);
    // Entries with positive weight are correct; negative-weight ones are wrong
    expect(questions[0].correctAnswer).toEqual([0, 1, 2]);
  });

  it("handles multiple questions separated by blank lines", () => {
    const input = `Q1? {=a ~b}

Q2? {~a =b ~c}

Q3? {T}`;
    const { questions } = parseGift(input);
    expect(questions).toHaveLength(3);
    expect(questions[0].options).toEqual(["a", "b"]);
    expect(questions[2].type).toBe("true-false");
  });

  it("warns on unsupported question types instead of throwing", () => {
    const input = `What is 2+2? {#4}

Essay question. {}`;
    const { questions, warnings } = parseGift(input);
    expect(questions).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("extracts title as topic when no category is set", () => {
    const input = `::Capitals::What is the capital of France? {=Paris ~London}`;
    const { questions } = parseGift(input);
    expect(questions[0].topic).toBe("capitals");
  });

  it("handles GIFT escapes in stem and options", () => {
    const input = `Is 2 \\= 2? {=yes ~no}`;
    const { questions } = parseGift(input);
    expect(questions[0].question).toBe("Is 2 = 2?");
  });
});

describe("serializeGift", () => {
  it("serializes a single MCQ question", () => {
    const text = serializeGift([sampleMcq]);
    expect(text).toMatch(/::european capitals::/);
    expect(text).toMatch(/What is the capital of France\?/);
    expect(text).toMatch(/\t~Berlin/);
    expect(text).toMatch(/\t=Paris/);
    expect(text).toMatch(/####Paris has been the capital of France/);
  });

  it("serializes true/false with {T} or {F} shorthand", () => {
    const text = serializeGift([sampleTf]);
    expect(text).toMatch(/\{F\}/);
    expect(text).toMatch(/####The Earth is an oblate spheroid/);
  });

  it("serializes multi-answer with weighted tildes", () => {
    const text = serializeGift([sampleMulti]);
    expect(text).toMatch(/~%33%Red/);
    expect(text).toMatch(/~%33%Green/);
    expect(text).toMatch(/~%33%Blue/);
    expect(text).toMatch(/~%-100%Yellow/);
  });

  it("emits metadata comments by default", () => {
    const text = serializeGift([sampleMcq]);
    expect(text).toMatch(/\/\/ carmenita-meta:.*difficulty=easy.*bloom=remember/);
    expect(text).toMatch(/\/\/ source: Paris is the capital/);
  });

  it("omits metadata comments when disabled", () => {
    const text = serializeGift([sampleMcq], { includeMetadataComments: false });
    expect(text).not.toMatch(/carmenita-meta/);
  });

  it("prepends $CATEGORY: when provided", () => {
    const text = serializeGift([sampleMcq], { category: "geography/europe" });
    expect(text).toMatch(/^\$CATEGORY: geography\/europe/);
  });

  it("escapes GIFT specials in stem and answers", () => {
    const q: PortableQuestion = {
      ...sampleMcq,
      question: "Is 2 = 2?",
      options: ["~a~", "=b=", "{c}", "d"],
    };
    const text = serializeGift([q]);
    expect(text).toMatch(/2 \\= 2/);
    expect(text).toMatch(/\\~a\\~/);
  });
});

describe("GIFT round-trip", () => {
  it("round-trips mcq-single", () => {
    const gift = serializeGift([sampleMcq], { includeMetadataComments: false });
    const { questions } = parseGift(gift);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.type).toBe("mcq-single");
    expect(q.question).toBe(sampleMcq.question);
    expect(q.options).toEqual(sampleMcq.options);
    expect(q.correctAnswer).toBe(sampleMcq.correctAnswer);
    expect(q.explanation).toBe(sampleMcq.explanation);
  });

  it("round-trips true/false", () => {
    const gift = serializeGift([sampleTf], { includeMetadataComments: false });
    const { questions } = parseGift(gift);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("true-false");
    expect(questions[0].correctAnswer).toBe(1);
    expect(questions[0].explanation).toBe(sampleTf.explanation);
  });
});
