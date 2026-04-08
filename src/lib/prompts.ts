/**
 * Prompt registry — the single place where all LLM system prompts live.
 *
 * Same pattern as handai's `src/lib/prompts.ts` but scoped to Carmenita:
 * a `PROMPTS` record of `PromptDef`, `getPrompt(id)` that checks a
 * localStorage override before falling back to the default, and
 * `setPromptOverride(id, value)` / `clearPromptOverride(id)` for the
 * Settings page.
 *
 * Five first-class prompts:
 *
 *   carmenita.mcq.document  — generate from a source passage; fidelity rules
 *   carmenita.mcq.topic     — generate from a topic + structured context
 *   carmenita.mcq.lecture   — generate from PPTX slides; slide-aware
 *   carmenita.feedback.add  — add a pedagogical explanation to an existing Q
 *   carmenita.tag.add       — auto-derive topic + tags for an existing Q
 *
 * For backwards compatibility, `carmenita.mcq` remains registered and
 * defaults to the same string as `carmenita.mcq.document`. Existing
 * localStorage overrides under that id still take effect.
 */

export interface PromptDef {
  id: string;
  name: string;
  description: string;
  defaultValue: string;
}

// localStorage prefix. Different from handai's so the two apps do not
// share overrides even if opened side-by-side.
const OVERRIDE_PREFIX = "carmenita_prompt_override:";

// ─────────────────────────────────────────────────────────────────────────────
// Shared TAGGING block embedded in every generation prompt. Kept as a
// standalone constant so all modes stay in lock-step — any change here
// applies uniformly. The prompt self-consistency is enforced by
// prompts.test.ts which asserts the block is present in every generation
// prompt's default value.
// ─────────────────────────────────────────────────────────────────────────────
const TAGGING_BLOCK = `TAGGING (MANDATORY — every question MUST include all four fields):
- "topic": a short 2-4 word lowercase concept label (e.g. "photosynthesis", "integration by parts"). REQUIRED.
- "tags": an array of 2-6 short lowercase topic-level tags. At LEAST 2 entries REQUIRED. No duplicates. Use hyphens for multi-word tags (e.g. "cell-biology", not "cell biology"). Tags should be finer-grained than the topic and let the learner cluster similar questions.
- "subject": the top-level subject if identifiable (e.g. "biology", "calculus"). Use null if unclear.
- "lesson": a mid-level chapter or lesson if identifiable (e.g. "plant physiology", "integration techniques"). Use null if unclear.`;

// Shared "output rules" that every generation prompt embeds verbatim.
const OUTPUT_RULES = `Output rules (FOLLOW EXACTLY):
- Return ONLY a JSON array of question objects. Nothing else.
- No markdown. No code fences. No preamble. No trailing commentary.
- Every field required above is REQUIRED for every question. Questions missing any required field will be discarded.
- Distractors must be plausible but unambiguously incorrect.
- For mcq-multi questions, at least two options must be correct AND at least one must be wrong.
- For true-false questions, the options array must be exactly ["True", "False"] and correctAnswer must be 0 (True) or 1 (False).`;

// Shared "question shape" block common to all three generation prompts.
const QUESTION_SHAPE = `Each question MUST include every one of these fields:

- "type": one of "mcq-single" (exactly one correct answer), "mcq-multi" (two or more correct answers), or "true-false".
- "question": the question text, clear and self-contained.
- "options": an array of option strings. For "true-false" use exactly ["True", "False"]. For MCQ use 4 options (or 3 at minimum, 6 maximum).
- "correctAnswer": for mcq-single and true-false, a 0-indexed number. For mcq-multi, an array of 0-indexed numbers (length >= 2, at least one wrong option).
- "explanation": 1–2 sentences explaining why the correct answer is correct AND briefly noting why the best distractor is wrong. Pedagogical tone — treat the reader as someone who just answered incorrectly.
- "difficulty": "easy", "medium", or "hard".
- "bloomLevel": one of "remember", "understand", "apply", "analyze", "evaluate", "create".
- "sourcePassage": see the mode-specific rule below.`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. DOCUMENT mode — generate from an uploaded source passage.
//    Emphasizes source fidelity: do not fabricate beyond what the passage says.
// ─────────────────────────────────────────────────────────────────────────────
const MCQ_DOCUMENT_DEFAULT = `You are an expert educator generating multiple-choice questions from an uploaded source passage.

Given the passage below, generate exactly {n} questions that test understanding of the key concepts in the passage. Your questions must stay faithful to the passage — do NOT bring in facts, claims, or examples that are not in the source text. Treat the passage as the authoritative source.

${QUESTION_SHAPE}
- For "sourcePassage": a direct verbatim quote (≤ 200 characters) from the source passage below that supports the correct answer. Must appear literally in the passage.

${TAGGING_BLOCK}

Allowed question types for this request: {allowedTypes}.
Target difficulty mix (as proportions): {difficultyMix}.
Taxonomy hints for this batch (use if the passage doesn't suggest something more specific): subject="{defaultSubject}", lesson="{defaultLesson}".

${OUTPUT_RULES}
- Do not fabricate facts not in the source passage. If the passage doesn't support a claim, don't test it.
- Cover the passage broadly — do not cluster all questions around one concept.

Source passage:
"""
{text}
"""`;

// ─────────────────────────────────────────────────────────────────────────────
// 2. TOPIC mode — generate from a typed topic with structured context.
//    No source passage; the LLM draws on its training knowledge.
// ─────────────────────────────────────────────────────────────────────────────
const MCQ_TOPIC_DEFAULT = `You are an expert educator generating multiple-choice questions from a topic specified by the learner. There is NO source document — you are drawing on your training knowledge to test core conceptual understanding of the topic at the specified level.

Topic: {topic}
Subject area: {subject}
Target level: {level}
Learning objectives: {objectives}
Must-include concepts: {mustInclude}

Generate exactly {n} questions that test conceptual understanding at the target level. Prioritize concepts over trivia — prefer questions that require reasoning or application over questions that require memorizing a proper noun or date. If "must-include concepts" are provided, at least one question per concept should appear.

${QUESTION_SHAPE}
- For "sourcePassage": a short canonical statement or definition (≤ 200 characters) that the correct answer rests on. This is YOUR concise synthesis from general knowledge, not a quote from a document. Think "what a textbook glossary entry would say."

${TAGGING_BLOCK}

Allowed question types for this request: {allowedTypes}.
Target difficulty mix (as proportions): {difficultyMix}.

${OUTPUT_RULES}
- Do not invent oddly specific facts, dates, or proper nouns that would be hard to verify. Stay at the level of well-established textbook material.
- Distribute questions across the full scope of the topic; don't bunch them around one sub-concept.
- If learning objectives are provided, prefer objectives-aligned questions.`;

// ─────────────────────────────────────────────────────────────────────────────
// 3. LECTURE (PPTX) mode — generate from lecture slides delimited by
//    "--- Slide N ---" markers produced by extractPptx. Slides are terse;
//    the LLM must reconstruct underlying concepts across adjacent slides.
// ─────────────────────────────────────────────────────────────────────────────
const MCQ_LECTURE_DEFAULT = `You are an expert educator generating multiple-choice questions from lecture slides.

The source material below is a slide deck delimited by "--- Slide N ---" markers. Slides are terse, bullet-heavy, and sometimes lack full sentences — you must reconstruct the underlying concept by reading adjacent slides together and inferring what the lecturer likely said. Treat each slide as one beat of a larger explanation.

Given the slide deck below, generate exactly {n} questions that test understanding of the concepts being taught, NOT superficial details like slide numbers, headers, or section titles.

${QUESTION_SHAPE}
- For "sourcePassage": the single slide bullet (≤ 200 characters) that most directly supports the correct answer. Quote it verbatim if possible; it's OK to quote a terse fragment.

${TAGGING_BLOCK}

Allowed question types for this request: {allowedTypes}.
Target difficulty mix (as proportions): {difficultyMix}.
Taxonomy hints for this batch: subject="{defaultSubject}", lesson="{defaultLesson}".

${OUTPUT_RULES}
- Do not ask "what slide contains X" or "which section comes next" — those are metadata questions, not concept questions.
- Aggregate adjacent slides when a single slide's bullet is too terse to support a standalone question.
- Cover the lecture broadly — sample from the beginning, middle, and end of the deck.

Slide deck:
"""
{text}
"""`;

// ─────────────────────────────────────────────────────────────────────────────
// 4. FEEDBACK / EXPLANATION mode — given an existing question that lacks
//    a good explanation, generate one. Single LLM call per question,
//    returns a small JSON object (NOT an array).
// ─────────────────────────────────────────────────────────────────────────────
const FEEDBACK_ADD_DEFAULT = `You are an expert educator writing a short pedagogical explanation for a multiple-choice question that a learner just answered. Your explanation should say WHY the correct answer is correct AND briefly note what makes the most tempting distractor wrong. Tone: patient, direct, treat the reader as someone who just answered incorrectly and wants to understand.

Question:
{question}

Options:
{optionsList}

Correct answer: {correctAnswer}

Current explanation (may be empty or low-quality): {currentExplanation}

Return ONLY a JSON object with exactly one field:
{"explanation": "<1–2 sentence explanation>"}

Rules:
- 1 to 2 sentences. No more.
- No markdown. No code fences. No preamble.
- Do not restate the full question stem.
- Reference the concept, not the option letter (e.g., "ATP is produced in the mitochondria" not "Option A is correct because…").
- If multiple answers are correct (multi-answer), explain the unifying principle briefly.`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. TAG mode — given an existing question, derive a good topic + tag set.
//    Single LLM call, returns a small JSON object.
// ─────────────────────────────────────────────────────────────────────────────
const TAG_ADD_DEFAULT = `You are an expert educator categorizing a multiple-choice question for a question bank. Your job is to derive a short topic label and a set of 2–6 tags so learners can filter and group similar questions later.

Question:
{question}

Options:
{optionsList}

Correct answer: {correctAnswer}
Existing explanation: {explanation}

Return ONLY a JSON object with exactly these four fields:
{"subject": "<string or null>", "lesson": "<string or null>", "topic": "<string>", "tags": ["<tag1>", "<tag2>", ...]}

Rules:
- "topic": 2-4 lowercase words describing the specific concept this question tests (e.g., "mitochondrial respiration", "integration by parts"). REQUIRED.
- "tags": 2-6 lowercase tags, each 1-3 words, hyphenated if multi-word (e.g., "cell-biology", "atp-synthesis"). At LEAST 2 required. No duplicates. Finer-grained than the topic.
- "subject": the top-level discipline if identifiable (e.g., "biology", "calculus"). null if unclear.
- "lesson": a mid-level chapter or unit if identifiable (e.g., "cellular respiration", "integration techniques"). null if unclear.
- No markdown. No code fences. No preamble.`;

// ─────────────────────────────────────────────────────────────────────────────
// Registry. Order matters for UI iteration — keep the generation prompts
// first (document → topic → lecture) followed by the enhancement prompts.
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPTS: Record<string, PromptDef> = {
  "carmenita.mcq.document": {
    id: "carmenita.mcq.document",
    name: "Document → MCQ",
    description:
      "Generates MCQs from an uploaded document passage. Source-fidelity emphasis: the LLM is told not to fabricate beyond the passage.",
    defaultValue: MCQ_DOCUMENT_DEFAULT,
  },
  "carmenita.mcq.topic": {
    id: "carmenita.mcq.topic",
    name: "Topic → MCQ",
    description:
      "Generates MCQs from a typed topic with optional structured context (subject, level, objectives, must-include concepts). No source document — uses the LLM's training knowledge.",
    defaultValue: MCQ_TOPIC_DEFAULT,
  },
  "carmenita.mcq.lecture": {
    id: "carmenita.mcq.lecture",
    name: "Lecture (PPTX) → MCQ",
    description:
      "Generates MCQs from PPTX lecture slides delimited by --- Slide N --- markers. Slide-aware: aggregates terse bullets across adjacent slides.",
    defaultValue: MCQ_LECTURE_DEFAULT,
  },
  "carmenita.feedback.add": {
    id: "carmenita.feedback.add",
    name: "Add Explanation",
    description:
      "Given an existing question, generates a 1-2 sentence pedagogical explanation. Used by the Explain (N) bulk action on the bank page.",
    defaultValue: FEEDBACK_ADD_DEFAULT,
  },
  "carmenita.tag.add": {
    id: "carmenita.tag.add",
    name: "Auto-tag Question",
    description:
      "Given an existing question, derives subject/lesson/topic/tags. Used by the Re-tag (N) bulk action on the bank page to clean up imported questions with poor metadata.",
    defaultValue: TAG_ADD_DEFAULT,
  },
  // Backwards-compat alias. Points at the same default as the document
  // prompt. Any user override already stored under "carmenita.mcq" in
  // localStorage still applies via getPrompt() — the alias is just the
  // default-value fallback when no override exists.
  "carmenita.mcq": {
    id: "carmenita.mcq",
    name: "MCQ (legacy alias)",
    description:
      "Deprecated alias for carmenita.mcq.document. Kept so existing localStorage overrides continue to work.",
    defaultValue: MCQ_DOCUMENT_DEFAULT,
  },
};

/**
 * Read a prompt by id. Checks localStorage for a user override first;
 * falls back to the registered default. Safe to call on the server
 * (where `localStorage` is undefined) — it just returns the default.
 */
export function getPrompt(id: string): string {
  const def = PROMPTS[id];
  if (!def) throw new Error(`Unknown prompt id: ${id}`);
  if (typeof window !== "undefined" && window.localStorage) {
    const override = window.localStorage.getItem(OVERRIDE_PREFIX + id);
    if (override !== null) return override;
  }
  return def.defaultValue;
}

export function setPromptOverride(id: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (!PROMPTS[id]) throw new Error(`Unknown prompt id: ${id}`);
  window.localStorage.setItem(OVERRIDE_PREFIX + id, value);
}

export function clearPromptOverride(id: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(OVERRIDE_PREFIX + id);
}

/**
 * Check if a prompt has a user-defined override (for showing "(modified)"
 * badges in the Settings UI).
 */
export function hasPromptOverride(id: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return window.localStorage.getItem(OVERRIDE_PREFIX + id) !== null;
}

/**
 * Substitute {placeholder} tokens in a prompt template. Unmatched
 * placeholders are left in place — useful for modes that only fill a
 * subset of the template's slots.
 */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? vars[key] : match,
  );
}
