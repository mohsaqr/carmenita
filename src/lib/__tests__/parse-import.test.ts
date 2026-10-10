import { describe, it, expect } from "vitest";
import { parseImport } from "@/lib/formats/parse-import";
import { serializeMarkdown } from "@/lib/formats/markdown";
import type { PortableQuestion } from "@/lib/formats/types";
import { DEFAULT_METADATA } from "@/lib/formats/types";

const GIFT = `::L6-S02-Q01:: Restrictive lung disease is characterized by: {
=Reduced expansion of the lung parenchyma
~Increased resistance to outflow
=Decreased FVC
}

::L6-S03-Q01:: Restrictive lung diseases can be caused by affections of: {
=Respiratory centers
=Respiratory tracts
=Thoracic cage
}`;

const AIKEN = `What is 2 + 2?
A. 3
B. 4
ANSWER: B`;

const mdQuestion: PortableQuestion = {
  ...DEFAULT_METADATA,
  type: "mcq-single",
  question: "Pick B",
  options: ["A", "B", "C"],
  correctAnswer: 1,
};

describe("parseImport", () => {
  it("uses the chosen format when it finds questions, with no format note", () => {
    const r = parseImport("gift", GIFT);
    expect(r.format).toBe("gift");
    expect(r.questions).toHaveLength(2);
    expect(r.warnings).toHaveLength(1); // the all-correct warning only
    expect(r.warnings[0]).toContain("every option marked correct");
  });

  it("falls back to GIFT when GIFT text is imported as Markdown", () => {
    const r = parseImport("markdown", GIFT);
    expect(r.format).toBe("gift");
    expect(r.questions).toHaveLength(2);
    expect(r.warnings[0]).toBe(
      "This text is in GIFT format, not Markdown — imported it as GIFT.",
    );
    expect(r.warnings[1]).toContain("every option marked correct");
  });

  it("falls back to GIFT when GIFT text is imported as Aiken", () => {
    const r = parseImport("aiken", GIFT);
    expect(r.format).toBe("gift");
    expect(r.questions).toHaveLength(2);
  });

  it("falls back to Aiken and to Markdown too", () => {
    expect(parseImport("gift", AIKEN).format).toBe("aiken");
    const md = serializeMarkdown([mdQuestion]);
    const r = parseImport("aiken", md);
    expect(r.format).toBe("markdown");
    expect(r.questions[0].correctAnswer).toBe(1);
  });

  it("returns the chosen format's warnings when nothing parses in any format", () => {
    const r = parseImport("gift", "just some prose, no questions here");
    expect(r.questions).toHaveLength(0);
    expect(r.format).toBe("gift");
    expect(r.warnings.join(" ")).not.toContain("imported it as");
  });
});
