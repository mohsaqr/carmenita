import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/lib/formats/markdown";
import type { PortableQuestion } from "@/lib/formats/types";

const canonicalSingle: PortableQuestion = {
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
  sourcePassage: "Paris is the capital and most populous city of France.",
};

const canonicalMulti: PortableQuestion = {
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
  sourcePassage:
    "In additive color mixing, the primary colors are red, green, and blue.",
};

const canonicalTf: PortableQuestion = {
  type: "true-false",
  question: "The Sun is a star.",
  options: ["True", "False"],
  correctAnswer: 0,
  explanation:
    "The Sun is a G-type main-sequence star at the center of our solar system.",
  difficulty: "easy",
  bloomLevel: "understand",
  subject: null,
  lesson: null,
  topic: "astronomy",
  tags: [],
  sourcePassage: "The Sun is the star at the center of the Solar System.",
};

describe("parseMarkdown — canonical format", () => {
  it("parses a clean single-answer question", () => {
    const md = `## Q1
**Type:** mcq-single
**Difficulty:** easy
**Bloom:** remember
**Topic:** european capitals

**Question:** What is the capital of France?

- [ ] Berlin
- [x] Paris
- [ ] London
- [ ] Madrid

**Explanation:** Paris has been the capital of France since 987 AD.
**Source:** "Paris is the capital and most populous city of France."
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.type).toBe("mcq-single");
    expect(q.question).toBe("What is the capital of France?");
    expect(q.options).toEqual(["Berlin", "Paris", "London", "Madrid"]);
    expect(q.correctAnswer).toBe(1);
    expect(q.difficulty).toBe("easy");
    expect(q.bloomLevel).toBe("remember");
    expect(q.topic).toBe("european capitals");
    expect(q.explanation).toBe("Paris has been the capital of France since 987 AD.");
    expect(q.sourcePassage).toBe(
      "Paris is the capital and most populous city of France.",
    );
  });

  it("parses a multi-answer question with multiple [x]", () => {
    const md = `## Q1
**Type:** mcq-multi
**Difficulty:** medium
**Bloom:** apply
**Topic:** color theory

**Question:** Which of these are primary colors in additive color mixing?

- [x] Red
- [x] Green
- [x] Blue
- [ ] Yellow

**Explanation:** Red, green, and blue are the additive primary colors.
**Source:** "In additive color mixing, the primary colors are red, green, and blue."
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("mcq-multi");
    expect(questions[0].correctAnswer).toEqual([0, 1, 2]);
  });

  it("parses a true/false question", () => {
    const md = `## Q1
**Type:** true-false
**Difficulty:** easy
**Bloom:** understand
**Topic:** astronomy

**Question:** The Sun is a star.

- [x] True
- [ ] False

**Explanation:** The Sun is a G-type main-sequence star.
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions[0].type).toBe("true-false");
    expect(questions[0].correctAnswer).toBe(0);
    expect(questions[0].options).toEqual(["True", "False"]);
  });

  it("parses multiple questions separated by ---", () => {
    const md = `## Q1
**Type:** mcq-single
**Topic:** geography

**Question:** Capital of France?

- [x] Paris
- [ ] London

**Explanation:** It is.

---

## Q2
**Type:** true-false
**Topic:** geography

**Question:** Paris is in France.

- [x] True
- [ ] False

**Explanation:** It is.
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(2);
    expect(questions[0].type).toBe("mcq-single");
    expect(questions[1].type).toBe("true-false");
  });

  it("splits on question header even without --- separator", () => {
    const md = `## Q1
**Question:** First?
- [x] Yes
- [ ] No
## Q2
**Question:** Second?
- [x] Yes
- [ ] No
`;
    const { questions } = parseMarkdown(md);
    expect(questions).toHaveLength(2);
    expect(questions[0].question).toBe("First?");
    expect(questions[1].question).toBe("Second?");
  });
});

describe("parseMarkdown — tolerant variations", () => {
  it("accepts ### and #### header levels", () => {
    const md = `### Q1
**Question:** Test?
- [x] A
- [ ] B
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
  });

  it("accepts Question N style headers (no Q prefix)", () => {
    const md = `## Question 1
**Question:** Test?
- [x] A
- [ ] B
`;
    const { questions } = parseMarkdown(md);
    expect(questions).toHaveLength(1);
  });

  it("accepts * and 1. list markers for options", () => {
    const md = `## Q1
**Question:** Test?
* [x] A
* [ ] B
`;
    const { questions } = parseMarkdown(md);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(["A", "B"]);

    const md2 = `## Q1
**Question:** Test?
1. [x] A
2. [ ] B
`;
    const { questions: questions2 } = parseMarkdown(md2);
    expect(questions2).toHaveLength(1);
  });

  it("accepts uppercase [X]", () => {
    const md = `## Q1
**Question:** Test?
- [X] A
- [ ] B
`;
    const { questions } = parseMarkdown(md);
    expect(questions).toHaveLength(1);
    expect(questions[0].correctAnswer).toBe(0);
  });

  it("accepts unbolded Field: markers", () => {
    const md = `## Q1
Type: mcq-single
Difficulty: hard
Topic: physics

Question: What is mass?

- [x] Amount of matter
- [ ] Weight
- [ ] Volume
- [ ] Density
`;
    const { questions } = parseMarkdown(md);
    expect(questions[0].type).toBe("mcq-single");
    expect(questions[0].difficulty).toBe("hard");
    expect(questions[0].topic).toBe("physics");
  });

  it("accepts common field synonyms (Feedback, Category, Stem)", () => {
    const md = `## Q1
**Category:** biology
**Stem:** What is DNA?

- [x] A molecule
- [ ] A cell

**Feedback:** DNA is deoxyribonucleic acid.
`;
    const { questions } = parseMarkdown(md);
    expect(questions[0].topic).toBe("biology");
    expect(questions[0].question).toBe("What is DNA?");
    expect(questions[0].explanation).toBe("DNA is deoxyribonucleic acid.");
  });

  it("auto-detects type from option shape when **Type:** is missing", () => {
    const md1 = `## Q1
**Question:** Multi?
- [x] A
- [x] B
- [ ] C
`;
    expect(parseMarkdown(md1).questions[0].type).toBe("mcq-multi");

    const md2 = `## Q1
**Question:** TF?
- [x] True
- [ ] False
`;
    expect(parseMarkdown(md2).questions[0].type).toBe("true-false");

    const md3 = `## Q1
**Question:** Single?
- [x] A
- [ ] B
- [ ] C
`;
    expect(parseMarkdown(md3).questions[0].type).toBe("mcq-single");
  });

  it("coerces bloom level synonyms", () => {
    const cases: Array<[string, string]> = [
      ["recall", "remember"],
      ["comprehend", "understand"],
      ["application", "apply"],
      ["analysis", "analyze"],
      ["evaluation", "evaluate"],
      ["synthesis", "create"],
    ];
    for (const [input, expected] of cases) {
      const md = `## Q1
**Bloom:** ${input}
**Question:** Test?
- [x] A
- [ ] B
`;
      const { questions } = parseMarkdown(md);
      expect(questions[0].bloomLevel).toBe(expected);
    }
  });

  it("strips surrounding quotes from source field", () => {
    const md = `## Q1
**Question:** Test?
- [x] A
- [ ] B
**Source:** "Quoted source"
`;
    expect(parseMarkdown(md).questions[0].sourcePassage).toBe("Quoted source");
  });
});

describe("parseMarkdown — error handling", () => {
  it("warns when no options are marked correct", () => {
    const md = `## Q1
**Question:** Test?
- [ ] A
- [ ] B
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/correct/i);
  });

  it("warns when all options are marked correct", () => {
    const md = `## Q1
**Question:** Test?
- [x] A
- [x] B
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns when question stem is missing", () => {
    const md = `## Q1
**Type:** mcq-single
- [x] A
- [ ] B
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("warns when there are fewer than 2 options", () => {
    const md = `## Q1
**Question:** Test?
- [x] Only answer
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(0);
    expect(warnings[0]).toMatch(/2 options/);
  });

  it("warns when true-false is declared but options don't match", () => {
    const md = `## Q1
**Type:** true-false
**Question:** Is this right?
- [x] Yes
- [ ] No
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(0);
    expect(warnings[0]).toMatch(/true-false/);
  });

  it("keeps valid questions when some blocks are malformed", () => {
    const md = `## Q1
**Question:** Good question?
- [x] A
- [ ] B

## Q2
**Question:** Bad question - no correct answer
- [ ] A
- [ ] B

## Q3
**Question:** Another good one?
- [x] A
- [ ] B
`;
    const { questions, warnings } = parseMarkdown(md);
    expect(questions).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });
});

describe("serializeMarkdown", () => {
  it("serializes a single-answer question", () => {
    const md = serializeMarkdown([canonicalSingle]);
    expect(md).toMatch(/^## Q1/);
    expect(md).toMatch(/\*\*Type:\*\* mcq-single/);
    expect(md).toMatch(/\*\*Difficulty:\*\* easy/);
    expect(md).toMatch(/\*\*Bloom:\*\* remember/);
    expect(md).toMatch(/\*\*Topic:\*\* european capitals/);
    expect(md).toMatch(/- \[ \] Berlin/);
    expect(md).toMatch(/- \[x\] Paris/);
    expect(md).toMatch(/- \[ \] London/);
    expect(md).toMatch(/\*\*Explanation:\*\*/);
    expect(md).toMatch(/\*\*Source:\*\*/);
  });

  it("serializes mcq-multi with multiple [x]", () => {
    const md = serializeMarkdown([canonicalMulti]);
    const xCount = (md.match(/\[x\]/g) || []).length;
    expect(xCount).toBe(3);
  });

  it("serializes true-false with only True and False options", () => {
    const md = serializeMarkdown([canonicalTf]);
    expect(md).toMatch(/- \[x\] True/);
    expect(md).toMatch(/- \[ \] False/);
  });

  it("separates multiple questions with --- rules", () => {
    const md = serializeMarkdown([canonicalSingle, canonicalTf]);
    expect(md).toContain("\n---\n");
    expect(md).toMatch(/## Q1\b/);
    expect(md).toMatch(/## Q2\b/);
  });
});

describe("Markdown round-trip", () => {
  it("round-trips mcq-single", () => {
    const md = serializeMarkdown([canonicalSingle]);
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual(canonicalSingle);
  });

  it("round-trips mcq-multi", () => {
    const md = serializeMarkdown([canonicalMulti]);
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual(canonicalMulti);
  });

  it("round-trips true-false", () => {
    const md = serializeMarkdown([canonicalTf]);
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toEqual(canonicalTf);
  });

  it("round-trips a mixed batch", () => {
    const batch = [canonicalSingle, canonicalMulti, canonicalTf];
    const md = serializeMarkdown(batch);
    const { questions, warnings } = parseMarkdown(md);
    expect(warnings).toHaveLength(0);
    expect(questions).toEqual(batch);
  });
});
