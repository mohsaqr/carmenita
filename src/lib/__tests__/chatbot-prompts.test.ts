import { describe, it, expect } from "vitest";
import {
  MARKDOWN_PROMPT,
  GIFT_PROMPT,
  AIKEN_PROMPT,
  CHATBOT_PROMPTS,
  FORMAT_DESCRIPTIONS,
  buildChatbotPrompt,
} from "@/lib/formats/chatbot-prompts";
import { parseMarkdown } from "@/lib/formats/markdown";
import { parseGift } from "@/lib/formats/gift";
import { parseAiken } from "@/lib/formats/aiken";

/**
 * The most important test suite in this file:
 *
 * Each chatbot prompt contains a worked example (3 questions) that
 * demonstrates the format to the LLM. That example MUST be parseable
 * by the format's parser — otherwise we're telling chatbots to
 * produce something we can't import. These tests extract the example
 * from each prompt and run it through the parser.
 *
 * If you edit a prompt's example, run these tests.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Extractors pull the worked example out of each prompt.
// ─────────────────────────────────────────────────────────────────────────────

function extractMarkdownExample(prompt: string): string {
  // The worked example sits between
  //   "# Complete worked example (three questions of different types)"
  // and "# Source material"
  const start = prompt.indexOf("# Complete worked example");
  const end = prompt.indexOf("# Source material");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = prompt.slice(start, end);
  // Strip the "# Complete worked example (…)" header line
  const firstNewline = block.indexOf("\n");
  return block.slice(firstNewline + 1).trim();
}

function extractGiftExample(prompt: string): string {
  const start = prompt.indexOf("# Complete worked example");
  const end = prompt.indexOf("# Source material");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = prompt.slice(start, end);
  const firstNewline = block.indexOf("\n");
  return block.slice(firstNewline + 1).trim();
}

function extractAikenExample(prompt: string): string {
  const start = prompt.indexOf("# Complete worked example");
  const end = prompt.indexOf("# Source material");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = prompt.slice(start, end);
  const firstNewline = block.indexOf("\n");
  return block.slice(firstNewline + 1).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt self-consistency tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MARKDOWN_PROMPT self-consistency", () => {
  const example = extractMarkdownExample(MARKDOWN_PROMPT);

  it("has a worked example containing 3 questions", () => {
    const qCount = (example.match(/^## Q\d+/gm) || []).length;
    expect(qCount).toBe(3);
  });

  it("the embedded example parses cleanly through parseMarkdown", () => {
    const { questions, warnings } = parseMarkdown(example);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(3);
  });

  it("example covers all three question types", () => {
    const { questions } = parseMarkdown(example);
    const types = questions.map((q) => q.type).sort();
    expect(types).toEqual(["mcq-multi", "mcq-single", "true-false"]);
  });

  it("example questions have non-empty explanations", () => {
    const { questions } = parseMarkdown(example);
    for (const q of questions) {
      expect(q.explanation.length).toBeGreaterThan(10);
    }
  });

  it("example questions have source citations", () => {
    const { questions } = parseMarkdown(example);
    for (const q of questions) {
      expect(q.sourcePassage.length).toBeGreaterThan(10);
    }
  });
});

describe("GIFT_PROMPT self-consistency", () => {
  const example = extractGiftExample(GIFT_PROMPT);

  it("has a worked example with 3 questions", () => {
    // GIFT examples use ::Title:: per question
    const titleCount = (example.match(/^::/gm) || []).length;
    expect(titleCount).toBe(3);
  });

  it("the embedded example parses cleanly through parseGift", () => {
    const { questions, warnings } = parseGift(example);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(3);
  });

  it("example covers all three question types", () => {
    const { questions } = parseGift(example);
    const types = questions.map((q) => q.type).sort();
    expect(types).toEqual(["mcq-multi", "mcq-single", "true-false"]);
  });

  it("example questions have explanations (####feedback)", () => {
    const { questions } = parseGift(example);
    for (const q of questions) {
      expect(q.explanation.length).toBeGreaterThan(10);
    }
  });

  it("example uses $CATEGORY: directive", () => {
    expect(example).toMatch(/^\$CATEGORY:/);
  });
});

describe("AIKEN_PROMPT self-consistency", () => {
  const example = extractAikenExample(AIKEN_PROMPT);

  it("has a worked example with 3 questions", () => {
    const answerCount = (example.match(/^ANSWER:/gm) || []).length;
    expect(answerCount).toBe(3);
  });

  it("the embedded example parses cleanly through parseAiken", () => {
    const { questions, warnings } = parseAiken(example);
    expect(warnings).toHaveLength(0);
    expect(questions).toHaveLength(3);
  });

  it("example includes at least one true-false question", () => {
    const { questions } = parseAiken(example);
    const hasTf = questions.some((q) => q.type === "true-false");
    expect(hasTf).toBe(true);
  });

  it("example does NOT carry explanations (Aiken cannot)", () => {
    const { questions } = parseAiken(example);
    for (const q of questions) {
      expect(q.explanation).toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("All prompts share required structure", () => {
  for (const [format, prompt] of Object.entries(CHATBOT_PROMPTS)) {
    describe(`${format} prompt`, () => {
      it("has placeholders for {N}, {TOPIC}, {SOURCE}", () => {
        expect(prompt).toContain("{N}");
        expect(prompt).toContain("{TOPIC}");
        expect(prompt).toContain("{SOURCE}");
      });

      it("forbids code-fence wrapping", () => {
        expect(prompt).toMatch(/code fence|```/i);
      });

      it("forbids preamble", () => {
        expect(prompt).toMatch(/no preamble|preamble/i);
      });

      it("has an expert educator role", () => {
        expect(prompt).toMatch(/expert educator/i);
      });

      it("references Carmenita by name", () => {
        expect(prompt).toMatch(/Carmenita/);
      });
    });
  }
});

describe("Aiken prompt limitations are explicit", () => {
  it("explicitly mentions Aiken does not support feedback", () => {
    expect(AIKEN_PROMPT).toMatch(/Aiken.*not support.*feedback/i);
  });

  it("explicitly forbids mcq-multi", () => {
    expect(AIKEN_PROMPT).toMatch(/one correct answer/i);
  });

  it("explicitly forbids explanations", () => {
    expect(AIKEN_PROMPT).toMatch(/no explanation|without explanation|not.*explanation/i);
  });

  it("directs users to Markdown/GIFT for feedback", () => {
    expect(AIKEN_PROMPT).toMatch(/Markdown.*prompt.*instead|Markdown or GIFT/i);
  });
});

describe("Markdown prompt specifies exact field enumerations", () => {
  it("lists all three question types", () => {
    expect(MARKDOWN_PROMPT).toMatch(/mcq-single/);
    expect(MARKDOWN_PROMPT).toMatch(/mcq-multi/);
    expect(MARKDOWN_PROMPT).toMatch(/true-false/);
  });

  it("lists all three difficulty levels", () => {
    expect(MARKDOWN_PROMPT).toMatch(/easy.*medium.*hard|easy.*,.*medium.*,.*hard/);
  });

  it("lists all six Bloom levels", () => {
    const levels = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
    for (const level of levels) {
      expect(MARKDOWN_PROMPT).toContain(level);
    }
  });

  it("shows GitHub checkbox syntax in the format spec", () => {
    expect(MARKDOWN_PROMPT).toMatch(/- \[x\]/);
    expect(MARKDOWN_PROMPT).toMatch(/- \[ \]/);
  });
});

describe("GIFT prompt specifies escape characters and multi-answer syntax", () => {
  it("lists characters that must be escaped", () => {
    expect(GIFT_PROMPT).toMatch(/escape/i);
    expect(GIFT_PROMPT).toMatch(/\\\\/); // backslash
  });

  it("shows the weighted multi-answer syntax", () => {
    expect(GIFT_PROMPT).toMatch(/~%/);
  });

  it("shows the true-false shorthand", () => {
    expect(GIFT_PROMPT).toMatch(/\{T\}|\{F\}/);
  });

  it("shows the ####feedback syntax", () => {
    expect(GIFT_PROMPT).toMatch(/####/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildChatbotPrompt helper
// ─────────────────────────────────────────────────────────────────────────────

describe("buildChatbotPrompt", () => {
  it("substitutes {N}, {TOPIC}, {SOURCE} placeholders", () => {
    const prompt = buildChatbotPrompt("markdown", {
      n: 25,
      topic: "Photosynthesis",
      source: "Plants use sunlight to make food.",
    });
    expect(prompt).not.toContain("{N}");
    expect(prompt).not.toContain("{TOPIC}");
    expect(prompt).not.toContain("{SOURCE}");
    expect(prompt).toContain("25");
    expect(prompt).toContain("Photosynthesis");
    expect(prompt).toContain("Plants use sunlight to make food.");
  });

  it("substitutes all three formats", () => {
    for (const format of ["markdown", "gift", "aiken"] as const) {
      const prompt = buildChatbotPrompt(format, {
        n: 10,
        topic: "Test topic",
        source: "Test source material.",
      });
      expect(prompt).not.toContain("{N}");
      expect(prompt).not.toContain("{TOPIC}");
      expect(prompt).not.toContain("{SOURCE}");
      expect(prompt).toContain("Test topic");
    }
  });

  it("uses friendly placeholder when source is empty", () => {
    const prompt = buildChatbotPrompt("markdown", {
      n: 10,
      topic: "Biology",
      source: "",
    });
    expect(prompt).toMatch(/Paste your notes/i);
  });

  it("defaults to n=10 when not provided", () => {
    const prompt = buildChatbotPrompt("markdown", { topic: "X" });
    expect(prompt).toContain("10 ");
  });

  it("handles missing topic with a placeholder", () => {
    const prompt = buildChatbotPrompt("markdown", { n: 5 });
    expect(prompt).toMatch(/fill in your topic/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Format descriptions are user-facing; must be non-empty
// ─────────────────────────────────────────────────────────────────────────────

describe("FORMAT_DESCRIPTIONS", () => {
  it("has a description for every format", () => {
    for (const format of ["markdown", "gift", "aiken"] as const) {
      const d = FORMAT_DESCRIPTIONS[format];
      expect(d.label).toBeTruthy();
      expect(d.short).toBeTruthy();
      expect(d.long.length).toBeGreaterThan(30);
    }
  });
});
