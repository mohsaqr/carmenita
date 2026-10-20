import type { VariationType } from "@/types";

/**
 * Display labels for variation types. A module of its own with no runtime
 * imports: VariationDialog (browser) needs only these, and importing them
 * from llm-variations.ts pulled the LLM layer — and through its logging,
 * the database driver — into the browser bundle, which fails the build.
 */
export const VARIATION_TYPE_LABELS: Record<
  VariationType,
  { label: string; description: string }
> = {
  topic: {
    label: "Topic variations",
    description:
      "New questions on the same topic or closely related subtopics. Different stems, different options.",
  },
  distractors: {
    label: "Distractor rewrite",
    description:
      "Keep the stem and correct answer; regenerate the wrong options. Great for freshening a reused question.",
  },
  paraphrase: {
    label: "Paraphrase",
    description:
      "Same meaning, different wording. Keeps the correct answer identical, rephrases stem and options.",
  },
  harder: {
    label: "Harder versions",
    description:
      "Subtler distractors, more technical language, possibly higher Bloom level. Good for advanced review.",
  },
  easier: {
    label: "Easier versions",
    description:
      "Simpler language, more clearly distinct distractors. Good for introductory review.",
  },
};
