import { describe, it, expect } from "vitest";
import { buildTopicPrompt } from "@/lib/llm-topic";
import type { QuestionType } from "@/types";

/**
 * Tests for the topic-mode prompt builder. We verify that each
 * structured field lands in the rendered prompt and that defaults are
 * applied when a field is omitted. No real LLM calls.
 */

const baseArgs = {
  topic: "mitochondrial respiration",
  count: 5,
  allowedTypes: ["mcq-single", "true-false"] as QuestionType[],
};

describe("buildTopicPrompt", () => {
  it("embeds the topic in the rendered prompt", () => {
    const p = buildTopicPrompt(baseArgs);
    expect(p).toContain("mitochondrial respiration");
  });

  it("substitutes {n} with the requested count", () => {
    const p = buildTopicPrompt({ ...baseArgs, count: 12 });
    expect(p).toContain("12");
    expect(p).not.toContain("{n}");
  });

  it("embeds subject when provided", () => {
    const p = buildTopicPrompt({ ...baseArgs, subject: "cell biology" });
    expect(p).toContain("cell biology");
    expect(p).not.toContain("{subject}");
  });

  it("falls back to '(unspecified)' when subject is omitted", () => {
    const p = buildTopicPrompt(baseArgs);
    expect(p).toContain("(unspecified)");
  });

  it("embeds the target level", () => {
    const p = buildTopicPrompt({ ...baseArgs, level: "grad" });
    expect(p).toContain("grad");
  });

  it("defaults level to undergraduate when omitted", () => {
    const p = buildTopicPrompt(baseArgs);
    expect(p).toContain("undergraduate");
  });

  it("embeds learning objectives when provided", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      objectives: "Distinguish substrate-level from oxidative phosphorylation",
    });
    expect(p).toContain("Distinguish substrate-level");
  });

  it("embeds must-include concepts when provided", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      mustInclude: "electron transport chain, NADH, ATP synthase",
    });
    expect(p).toContain("electron transport chain");
  });

  it("embeds the allowed question types as a CSV", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      allowedTypes: ["mcq-single", "mcq-multi", "true-false"],
    });
    expect(p).toContain("mcq-single, mcq-multi, true-false");
  });

  it("embeds a default difficulty mix when omitted", () => {
    const p = buildTopicPrompt(baseArgs);
    // Default is { easy: 0.3, medium: 0.5, hard: 0.2 }
    expect(p).toContain("0.3");
    expect(p).toContain("0.5");
    expect(p).toContain("0.2");
  });

  it("embeds a caller-provided difficulty mix", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      difficultyMix: { easy: 0.1, medium: 0.4, hard: 0.5 },
    });
    expect(p).toContain("0.1");
    expect(p).toContain("0.4");
    expect(p).toContain("0.5");
  });

  it("includes the mandatory TAGGING block", () => {
    const p = buildTopicPrompt(baseArgs);
    expect(p).toContain("TAGGING (MANDATORY");
    expect(p).toMatch(/at\s+least\s+2/i);
  });

  it("honors a systemPromptOverride by ignoring the registered template", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      systemPromptOverride: "OVERRIDE: topic is {topic}",
    });
    expect(p).toBe("OVERRIDE: topic is mitochondrial respiration");
  });

  it("leaves no unsubstituted placeholders when all fields are set", () => {
    const p = buildTopicPrompt({
      ...baseArgs,
      subject: "cell biology",
      level: "undergrad",
      objectives: "understand atp production",
      mustInclude: "electron transport chain",
    });
    // No {topic} / {subject} / etc. should remain
    expect(p).not.toMatch(/\{topic\}/);
    expect(p).not.toMatch(/\{subject\}/);
    expect(p).not.toMatch(/\{level\}/);
    expect(p).not.toMatch(/\{objectives\}/);
    expect(p).not.toMatch(/\{mustInclude\}/);
    expect(p).not.toMatch(/\{n\}/);
    expect(p).not.toMatch(/\{allowedTypes\}/);
    expect(p).not.toMatch(/\{difficultyMix\}/);
  });

  it("trims whitespace from the topic before embedding", () => {
    const p = buildTopicPrompt({ ...baseArgs, topic: "  krebs cycle  " });
    expect(p).toContain("krebs cycle");
    expect(p).not.toContain("  krebs cycle  ");
  });
});
