import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MULTI_SHARE,
  OPTION_COUNT,
  answerFormatBlock,
  generationTypes,
  meetsAnswerFormat,
  normalizeShare,
  pickToMix,
  splitTypeCounts,
  typeCounts,
} from "@/lib/answer-format";
import { reviewGenerated } from "@/lib/question-quality";
import { generateQuizQuestions } from "@/lib/llm-quiz";
import type { ParsedQuestion } from "@/lib/question-schema";

/**
 * Carmen's answer format: every question has 5 options; 75 % (adjustable)
 * are multiple-answer with 2–4 correct — never all 5, since picking every
 * option scores 0 — and the rest single-answer. The prompt asks for it and
 * the quality gate enforces it.
 */

const five = ["Option A", "Option B", "Option C", "Option D", "Option E"];
const single = (stem: string, over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({
  type: "mcq-single",
  question: stem,
  options: five,
  correctAnswer: 2,
  explanation: "Because.",
  difficulty: "medium",
  bloomLevel: "apply",
  topic: "gaba",
  tags: ["gaba", "pharmacology"],
  sourcePassage: "GABA-A is a chloride channel.",
  subject: null,
  lesson: null,
  ...over,
});
const multi = (stem: string, correct: number[], over: Partial<ParsedQuestion> = {}): ParsedQuestion =>
  single(stem, { type: "mcq-multi", correctAnswer: correct, ...over });

describe("format rules", () => {
  it("accepts 5 options with 1 correct (single) or 2–4 correct (multi)", () => {
    expect(OPTION_COUNT).toBe(5);
    expect(meetsAnswerFormat(single("s"))).toBe(true);
    [[0, 1], [0, 2, 4], [0, 1, 2, 3]].forEach((c) => expect(meetsAnswerFormat(multi("m", c))).toBe(true));
  });

  it("rejects all 5 correct, a single correct in a multi, and anything but 5 options", () => {
    expect(meetsAnswerFormat(multi("m", [0, 1, 2, 3, 4]))).toBe(false);
    expect(meetsAnswerFormat(multi("m", [3]))).toBe(false);
    expect(meetsAnswerFormat(single("s", { options: five.slice(0, 4) }))).toBe(false);
    expect(meetsAnswerFormat(single("s", { options: [...five, "Option F"] }))).toBe(false);
    expect(meetsAnswerFormat(single("s", { type: "true-false", options: ["True", "False"], correctAnswer: 0 }))).toBe(false);
  });

  it("defaults to 75 % multi and clamps nonsense shares", () => {
    expect(DEFAULT_MULTI_SHARE).toBe(0.75);
    expect(typeCounts(20, undefined)).toEqual({ multi: 15, single: 5 });
    expect(typeCounts(4, 0.75)).toEqual({ multi: 3, single: 1 });
    expect(normalizeShare(Number.NaN)).toBe(0.75);
    expect(normalizeShare(-1)).toBe(0);
    expect(normalizeShare(7)).toBe(1);
    expect(generationTypes(0)).toEqual(["mcq-single"]);
    expect(generationTypes(1)).toEqual(["mcq-multi"]);
    expect(generationTypes(0.75)).toEqual(["mcq-multi", "mcq-single"]);
  });

  it("splits a quiz's mix over its parts exactly (property over many splits)", () => {
    const rand = (() => {
      let a = 7;
      return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
    })();
    Array.from({ length: 300 }, () => {
      const parts = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => Math.floor(rand() * 21));
      const share = Math.round(rand() * 20) / 20;
      const split = splitTypeCounts(parts, share);
      const total = parts.reduce((a, b) => a + b, 0);
      // Each part: counts add up and stay in range; the quiz hits the share.
      split.forEach((c, i) => {
        expect(c.multi + c.single).toBe(parts[i]);
        expect(c.multi).toBeGreaterThanOrEqual(0);
        expect(c.single).toBeGreaterThanOrEqual(0);
      });
      expect(split.reduce((a, c) => a + c.multi, 0)).toBe(Math.round(total * share));
      return null;
    });
  });

  it("never keeps more of a type than the mix allows", () => {
    const qs = [single("s1"), multi("m1", [0, 1]), single("s2"), multi("m2", [1, 2]), single("s3")];
    const { kept, over } = pickToMix(qs, { multi: 1, single: 2 });
    expect(kept.map((q) => q.question)).toEqual(["s1", "m1", "s2"]);
    expect(over).toBe(2);
  });

  it("the prompt block states the counts, the 5 options and never-all-correct", () => {
    const block = answerFormatBlock({ multi: 15, single: 5 });
    expect(block).toContain('Write exactly 15 "mcq-multi" and exactly 5 "mcq-single" questions');
    expect(block).toContain("Every question has exactly 5 options.");
    expect(block).toContain("Never make all 5 correct.");
    expect(block).toContain("never says how many are correct");
    expect(answerFormatBlock({ multi: 0, single: 4 })).not.toContain('"mcq-multi": 2, 3 or 4');
  });
});

describe("the quality gate enforces the format and the mix", () => {
  it("drops wrong-format items and the surplus of a type, and counts each", () => {
    const batch = [
      multi("Which of these are GABA-A modulators?", [0, 1, 2]),
      multi("Which are chloride channel facts?", [0, 1, 2, 3, 4]), // all five correct
      multi("Which drug acts here?", [1]), // a multi with one correct
      single("Which subunit binds benzodiazepines?", { options: five.slice(0, 4) }), // 4 options
      single("Which receptor is ionotropic?"),
      single("Which ion flows through GABA-A?"), // second single: over the mix
      multi("Which are barbiturate effects?", [1, 3]),
    ];
    const out = reviewGenerated(batch, { answerFormat: true, mix: { multi: 2, single: 1 }, random: () => 0 });
    expect(out.questions.map((q) => q.question).sort()).toEqual(
      ["Which are barbiturate effects?", "Which of these are GABA-A modulators?", "Which receptor is ionotropic?"].sort(),
    );
    expect(out.dropped).toEqual({ copied: 0, duplicate: 0, wrongType: 0, wrongFormat: 3, overMix: 1 });
    expect(out.questions.every(meetsAnswerFormat)).toBe(true);
  });
});

describe("document generation end to end (stubbed model)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the mix and the learner's instructions last, and saves only conforming questions", async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        prompts.push(JSON.parse(init.body).messages[0].content);
        const items = [
          multi("Which statements about benzodiazepines are correct?", [0, 2]),
          multi("Which findings fit a barbiturate overdose?", [1, 2, 4]),
          // All five correct: the schema check in parseQuestionArray discards it.
          multi("Which of these all-correct items should not exist?", [0, 1, 2, 3, 4]),
          // Four options: passes the schema, stopped by the answer-format gate.
          multi("Which of these four-option items should not exist?", [0, 1], { options: five.slice(0, 4) }),
          single("Which receptor do benzodiazepines modulate?"),
          single("Which ion does GABA-A conduct?"),
        ];
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const out = await generateQuizQuestions({
      docText: Array.from({ length: 300 }, (_, i) => `term${i % 97} idea${i % 11}.`).join(" "),
      provider: { id: "openai", providerType: "openai", displayName: "OpenAI", apiKey: "sk-test", defaultModel: "m", isEnabled: true },
      settings: { questionCount: 4, allowedTypes: ["mcq-single", "mcq-multi"], immediateFeedback: true, multiAnswerShare: 0.75 },
      customInstructions: "Use short clinical vignettes.",
    });
    expect(prompts).toHaveLength(1);
    const p = prompts[0];
    expect(p).toContain('Write exactly 3 "mcq-multi" and exactly 1 "mcq-single" questions');
    expect(p.indexOf("ANSWER FORMAT")).toBeLessThan(p.indexOf("CUSTOM INSTRUCTIONS FROM THE LEARNER"));
    expect(p.trimEnd().endsWith('"""')).toBe(true);
    expect(p).toContain("Use short clinical vignettes.");
    // 2 valid multis + 1 single kept; the all-correct item, the 4-option item and the extra single are not.
    expect(out.questions.map((q) => q.type).sort()).toEqual(["mcq-multi", "mcq-multi", "mcq-single"]);
    expect(out.questions.every(meetsAnswerFormat)).toBe(true);
    expect(out.questions.some((q) => q.question.includes("should not exist"))).toBe(false);
    expect(out.dropped.wrongFormat).toBe(1);
    expect(out.dropped.overMix).toBe(1);
  });
});
