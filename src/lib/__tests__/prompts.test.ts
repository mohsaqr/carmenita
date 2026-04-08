import { describe, it, expect } from "vitest";
import { PROMPTS, renderPrompt } from "@/lib/prompts";

/**
 * Prompt registry tests. Verifies that every prompt required by the
 * Create/Enhance flows is registered, that generation prompts embed the
 * shared TAGGING and OUTPUT-RULES blocks, and that placeholder
 * substitution via renderPrompt works as expected.
 *
 * These tests are a safety net: if someone rewrites a prompt and
 * accidentally drops the TAGGING requirement, the test fails before
 * the LLM starts producing un-tagged questions in production.
 */

describe("PROMPTS registry", () => {
  it("contains all 5 expected prompt ids plus the legacy alias", () => {
    const ids = Object.keys(PROMPTS).sort();
    expect(ids).toContain("carmenita.mcq.document");
    expect(ids).toContain("carmenita.mcq.topic");
    expect(ids).toContain("carmenita.mcq.lecture");
    expect(ids).toContain("carmenita.feedback.add");
    expect(ids).toContain("carmenita.tag.add");
    // Legacy alias — kept for backwards compat with old localStorage overrides.
    expect(ids).toContain("carmenita.mcq");
  });

  it("every prompt def has a non-empty name, description, and defaultValue", () => {
    for (const p of Object.values(PROMPTS)) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.defaultValue.length).toBeGreaterThan(100); // non-trivial
    }
  });

  it("every prompt def's id matches its registry key", () => {
    for (const [key, p] of Object.entries(PROMPTS)) {
      expect(p.id).toBe(key);
    }
  });
});

describe("Generation prompts (document / topic / lecture)", () => {
  const GENERATION_IDS = [
    "carmenita.mcq.document",
    "carmenita.mcq.topic",
    "carmenita.mcq.lecture",
  ];

  for (const id of GENERATION_IDS) {
    describe(id, () => {
      const prompt = PROMPTS[id].defaultValue;

      it("embeds the TAGGING (MANDATORY) block", () => {
        expect(prompt).toContain("TAGGING (MANDATORY");
        expect(prompt).toContain('"topic"');
        expect(prompt).toContain('"tags"');
        expect(prompt).toContain('"subject"');
        expect(prompt).toContain('"lesson"');
      });

      it("requires at least 2 tags per question", () => {
        expect(prompt).toMatch(/at\s+least\s+2/i);
      });

      it("includes the JSON array output rule (no code fences)", () => {
        expect(prompt).toContain("ONLY a JSON array");
        expect(prompt).toMatch(/no\s+(markdown|code\s+fences)/i);
      });

      it("substitutes {n} into the prompt via renderPrompt", () => {
        const rendered = renderPrompt(prompt, {
          n: "7",
          allowedTypes: "mcq-single",
          difficultyMix: "{}",
          text: "sample",
          topic: "sample",
          subject: "sample",
          level: "undergrad",
          objectives: "none",
          mustInclude: "none",
          defaultSubject: "",
          defaultLesson: "",
        });
        expect(rendered).toContain("7");
        expect(rendered).not.toContain("{n}");
      });
    });
  }
});

describe("carmenita.mcq.document", () => {
  const prompt = PROMPTS["carmenita.mcq.document"].defaultValue;

  it("instructs the LLM NOT to fabricate beyond the source passage", () => {
    expect(prompt).toMatch(/do\s+not\s+fabricate/i);
  });

  it("has a {text} placeholder for the source passage", () => {
    expect(prompt).toContain("{text}");
  });
});

describe("carmenita.mcq.topic", () => {
  const prompt = PROMPTS["carmenita.mcq.topic"].defaultValue;

  it("has {topic}, {subject}, {level}, {objectives}, {mustInclude} placeholders", () => {
    expect(prompt).toContain("{topic}");
    expect(prompt).toContain("{subject}");
    expect(prompt).toContain("{level}");
    expect(prompt).toContain("{objectives}");
    expect(prompt).toContain("{mustInclude}");
  });

  it("does NOT have a {text} placeholder (topic mode has no source passage)", () => {
    expect(prompt).not.toContain("{text}");
  });

  it("warns against inventing overly specific facts", () => {
    expect(prompt).toMatch(/(do\s+not\s+invent|prefer\s+conceptual|textbook)/i);
  });
});

describe("carmenita.mcq.lecture", () => {
  const prompt = PROMPTS["carmenita.mcq.lecture"].defaultValue;

  it("mentions slide boundaries", () => {
    expect(prompt).toMatch(/Slide\s+N/i);
  });

  it("warns against asking metadata-only questions", () => {
    expect(prompt).toMatch(/(section\s+title|what\s+slide|metadata)/i);
  });
});

describe("carmenita.feedback.add", () => {
  const prompt = PROMPTS["carmenita.feedback.add"].defaultValue;

  it("returns a single JSON object with an explanation field", () => {
    expect(prompt).toContain("explanation");
    expect(prompt).toContain("JSON object");
  });

  it("instructs 1-2 sentence output", () => {
    expect(prompt).toMatch(/1.{0,4}2\s+sentence/i);
  });

  it("has {question}, {optionsList}, {correctAnswer}, {currentExplanation} placeholders", () => {
    expect(prompt).toContain("{question}");
    expect(prompt).toContain("{optionsList}");
    expect(prompt).toContain("{correctAnswer}");
    expect(prompt).toContain("{currentExplanation}");
  });
});

describe("carmenita.tag.add", () => {
  const prompt = PROMPTS["carmenita.tag.add"].defaultValue;

  it("returns subject / lesson / topic / tags fields", () => {
    expect(prompt).toContain("subject");
    expect(prompt).toContain("lesson");
    expect(prompt).toContain("topic");
    expect(prompt).toContain("tags");
  });

  it("requires at least 2 tags", () => {
    expect(prompt).toMatch(/at\s+least\s+2/i);
  });

  it("returns a JSON object (not an array)", () => {
    expect(prompt).toContain("JSON object");
  });
});

describe("renderPrompt placeholder substitution", () => {
  it("replaces single {key} placeholders", () => {
    expect(renderPrompt("hello {name}", { name: "world" })).toBe("hello world");
  });

  it("leaves unmatched placeholders in place", () => {
    expect(renderPrompt("{a} and {b}", { a: "one" })).toBe("one and {b}");
  });

  it("replaces multiple instances of the same key", () => {
    expect(renderPrompt("{x} {x} {x}", { x: "yo" })).toBe("yo yo yo");
  });

  it("does not touch keys that aren't \\w (alphanumeric + underscore)", () => {
    expect(renderPrompt("{a-b}", { "a-b": "x" })).toBe("{a-b}");
  });
});
