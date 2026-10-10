import { describe, it, expect } from "vitest";
import { parseGift } from "@/lib/formats/gift";
import { parseMarkdown, serializeMarkdown } from "@/lib/formats/markdown";
import {
  allCorrectWarning,
  importWarnings,
  isAllCorrect,
} from "@/lib/formats/import-warnings";
import type { PortableQuestion } from "@/lib/formats/types";
import { DEFAULT_METADATA } from "@/lib/formats/types";

function q(
  question: string,
  type: PortableQuestion["type"],
  options: string[],
  correctAnswer: number | number[],
): PortableQuestion {
  return { ...DEFAULT_METADATA, question, type, options, correctAnswer };
}

const allFive = q("Causes include:", "mcq-multi", ["a", "b", "c", "d", "e"], [0, 1, 2, 3, 4]);
const someFive = q("Which are true?", "mcq-multi", ["a", "b", "c", "d", "e"], [0, 2]);
const single = q("Pick one", "mcq-single", ["a", "b"], 0);
const tf = q("True?", "true-false", ["True", "False"], 0);

describe("isAllCorrect", () => {
  it("flags only multi-answer questions with every option correct", () => {
    expect(isAllCorrect(allFive)).toBe(true);
    expect(isAllCorrect(someFive)).toBe(false);
    expect(isAllCorrect(single)).toBe(false);
    expect(isAllCorrect(tf)).toBe(false);
  });

  it("does not count duplicate indices as extra correct options", () => {
    expect(isAllCorrect(q("dup", "mcq-multi", ["a", "b", "c"], [0, 0, 1]))).toBe(false);
  });
});

describe("allCorrectWarning", () => {
  it("is null when no question is all-correct", () => {
    expect(allCorrectWarning([someFive, single, tf])).toBeNull();
  });

  it("names the questions and counts them", () => {
    const w = allCorrectWarning([someFive, allFive]);
    expect(w).toContain("1 question has every option marked correct");
    expect(w).toContain('"Causes include:"');
    expect(w).not.toContain("Which are true?");
  });

  it("names at most 10 and summarises the rest", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      q(`Stem number ${i}`, "mcq-multi", ["a", "b"], [0, 1]),
    );
    const w = allCorrectWarning(many) ?? "";
    expect(w).toContain("13 questions have every option marked correct");
    expect(w).toContain('"Stem number 9"');
    expect(w).not.toContain('"Stem number 10"');
    expect(w).toContain("and 3 more");
  });
});

describe("importWarnings", () => {
  it("appends the all-correct warning after the parser's own warnings", () => {
    expect(importWarnings([allFive], ["parser said"])).toEqual([
      "parser said",
      expect.stringContaining("every option marked correct"),
    ]);
    expect(importWarnings([someFive], ["parser said"])).toEqual(["parser said"]);
  });

  it("flags DeepSeek-style all-`=` GIFT questions end to end", () => {
    const gift = `::L6-S03-Q01:: Restrictive lung diseases can be caused by affections of: {
=Respiratory centers
=Respiratory tracts
=Thoracic cage
}

::L6-S02-Q01:: Restrictive lung disease is characterized by: {
=Reduced expansion
~Increased resistance to outflow
=Decreased FVC
}`;
    const { questions, warnings } = parseGift(gift);
    const all = importWarnings(questions, warnings);
    expect(all).toHaveLength(1);
    expect(all[0]).toContain("1 question has every option marked correct");
    expect(all[0]).toContain("Restrictive lung diseases can be caused");
  });

  it("flags all-checked Markdown questions too", () => {
    const { questions } = parseMarkdown(serializeMarkdown([allFive]));
    expect(questions).toHaveLength(1);
    expect(allCorrectWarning(questions)).toContain("1 question has");
  });
});
