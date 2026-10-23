import { describe, it, expect } from "vitest";
import {
  COPIED_RUN_WORDS,
  copiesMaterial,
  dropsMessage,
  materialRuns,
  reviewGenerated,
  shuffleOptions,
} from "@/lib/question-quality";
import { BOARD_STYLE_BLOCK, PROMPTS, PURPOSE_BLOCKS, purposeStyleBlock } from "@/lib/prompts";
import { buildTopicPrompt } from "@/lib/llm-topic";
import type { ParsedQuestion } from "@/lib/question-schema";

/** Deterministic PRNG (mulberry32) so shuffles are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({
  type: "mcq-single",
  question: "Which transporter does fluoxetine block?",
  options: ["SERT", "NET", "DAT", "VMAT2"],
  correctAnswer: 0,
  explanation: "Fluoxetine is an SSRI.",
  difficulty: "medium",
  bloomLevel: "remember",
  topic: "ssris",
  tags: ["ssri", "pharmacology"],
  sourcePassage: "SSRIs block SERT.",
  subject: null,
  lesson: null,
  ...over,
});

const NOTES =
  "Selective serotonin reuptake inhibitors block the presynaptic serotonin transporter and raise synaptic serotonin over several weeks of treatment in most patients.";

describe("copy detection", () => {
  const runs = materialRuns([NOTES]);

  it("flags a run of 12 words taken from the material, ignoring case and punctuation", () => {
    const copied = "SELECTIVE serotonin reuptake inhibitors block the presynaptic serotonin transporter, and raise synaptic serotonin?";
    expect(COPIED_RUN_WORDS).toBe(12);
    expect(copiesMaterial(copied, runs)).toBe(true);
  });

  it("does not flag 11 shared words or a paraphrase", () => {
    expect(copiesMaterial("selective serotonin reuptake inhibitors block the presynaptic serotonin transporter and raise", runs)).toBe(false);
    expect(copiesMaterial("How do SSRIs increase serotonin in the synaptic cleft?", runs)).toBe(false);
  });

  it("checks nothing when there is no material", () => {
    expect(copiesMaterial(NOTES, materialRuns([]))).toBe(false);
  });
});

describe("reviewGenerated", () => {
  it("drops copied stems and options, duplicates and wrong types, and counts each", () => {
    const batch = [
      q(),
      q({ question: NOTES }), // stem copies the notes
      q({ question: "Which statement about SSRIs is correct?", options: [NOTES, "b", "c", "d"] }), // option copies
      q({ question: "which transporter does FLUOXETINE block" }), // duplicate of #1
      q({ question: "An earlier batch asked this already?" }), // in avoid
      q({ type: "true-false", question: "SSRIs block SERT.", options: ["True", "False"], correctAnswer: 0 }),
    ];
    const out = reviewGenerated(batch, {
      sources: [NOTES],
      avoid: ["An earlier batch asked this already?"],
      allowedTypes: ["mcq-single"],
      random: seeded(1),
    });
    expect(out.questions.map((x) => x.question)).toEqual(["Which transporter does fluoxetine block?"]);
    expect(out.dropped).toEqual({ copied: 2, duplicate: 2, wrongType: 1, wrongFormat: 0, overMix: 0 });
  });

  it("keeps everything when nothing breaks a rule", () => {
    const batch = [q(), q({ question: "What does an MAO inhibitor block?" })];
    const out = reviewGenerated(batch, { random: seeded(2) });
    expect(out.questions).toHaveLength(2);
    expect(out.dropped).toEqual({ copied: 0, duplicate: 0, wrongType: 0, wrongFormat: 0, overMix: 0 });
  });
});

describe("shuffleOptions", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

  it("keeps the correct answer's text and only reorders options (single answer)", () => {
    const original = q();
    const ok = seeds.every((seed) => {
      const s = shuffleOptions(original, seeded(seed));
      return (
        s.options[s.correctAnswer as number] === "SERT" &&
        [...s.options].sort().join("|") === [...original.options].sort().join("|")
      );
    });
    expect(ok).toBe(true);
  });

  it("remaps every correct answer of a multi-answer question", () => {
    const multi = q({ type: "mcq-multi", options: ["a", "b", "c", "d", "e"], correctAnswer: [0, 3] });
    const ok = seeds.every((seed) => {
      const s = shuffleOptions(multi, seeded(seed));
      const picked = (s.correctAnswer as number[]).map((i) => s.options[i]).sort();
      return picked.join() === "a,d" && (s.correctAnswer as number[]).every((v, i, arr) => i === 0 || arr[i - 1] < v);
    });
    expect(ok).toBe(true);
  });

  it("moves the answer off the first position about as often as chance", () => {
    const firsts = seeds.filter((seed) => shuffleOptions(q(), seeded(seed)).correctAnswer === 0).length;
    // 4 options: chance is 25% of 200 = 50. Allow a wide band.
    expect(firsts).toBeGreaterThan(25);
    expect(firsts).toBeLessThan(80);
  });

  it("leaves true/false alone", () => {
    const tf = q({ type: "true-false", options: ["True", "False"], correctAnswer: 1 });
    expect(shuffleOptions(tf, seeded(3))).toEqual(tf);
  });
});

describe("dropsMessage", () => {
  it("names what was left out, or says nothing", () => {
    const none = { copied: 0, duplicate: 0, wrongType: 0, wrongFormat: 0, overMix: 0 };
    expect(dropsMessage(none)).toBe("");
    expect(dropsMessage({ ...none, copied: 2, duplicate: 1 })).toBe(
      "Left out 2 that copied the supplied material word for word and 1 duplicate.",
    );
    expect(dropsMessage({ ...none, copied: 1, duplicate: 2, wrongType: 3 })).toBe(
      "Left out 1 that copied the supplied material word for word, 2 duplicates and 3 of a question type you did not allow.",
    );
    expect(dropsMessage({ ...none, wrongFormat: 2, overMix: 1 })).toBe(
      "Left out 2 without 5 options or with a wrong number of correct answers and 1 beyond the single/multiple-answer mix you set.",
    );
  });
});

describe("purpose and style", () => {
  it("an exam no longer forces single-answer: the mix applies to every purpose", () => {
    expect(PURPOSE_BLOCKS.exam).not.toMatch(/Single-best-answer items only/);
    expect(BOARD_STYLE_BLOCK).toMatch(/Select all that apply/);
    expect(BOARD_STYLE_BLOCK).toContain("Options: 5 short options");
  });

  it("defaults to training, standard", () => {
    expect(purposeStyleBlock()).toBe(PURPOSE_BLOCKS.training);
  });

  it("board style follows NBME and allows basic-science stems without a patient", () => {
    const block = purposeStyleBlock("exam", "board");
    expect(block.startsWith(PURPOSE_BLOCKS.exam)).toBe(true);
    expect(block).toContain(BOARD_STYLE_BLOCK);
    expect(BOARD_STYLE_BLOCK).toMatch(/NBME/);
    expect(BOARD_STYLE_BLOCK).toMatch(/Basic science/);
    expect(BOARD_STYLE_BLOCK).toMatch(/No patient is needed/);
  });

  it("an exam topic prompt asks for the default 75/25 mix and carries the exam block", () => {
    const p = buildTopicPrompt({ topic: "SSRIs", count: 20, purpose: "exam", style: "board" });
    expect(p).toContain("Allowed question types for this request: mcq-multi, mcq-single.");
    expect(p).toContain('Write exactly 15 "mcq-multi" and exactly 5 "mcq-single" questions');
    expect(p).toContain("PURPOSE: exam");
    expect(p).toContain("STYLE: board exam");
  });

  it("every generation prompt carries the shared item-writing rules", () => {
    const ids = ["carmenita.mcq.document", "carmenita.mcq.topic", "carmenita.mcq.lecture"];
    const ok = ids.every((id) => PROMPTS[id].defaultValue.includes("Never copy a sentence or a long phrase"));
    expect(ok).toBe(true);
  });
});
