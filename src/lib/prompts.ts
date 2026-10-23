import { DEFAULT_PURPOSE, DEFAULT_STYLE, type QuestionPurpose, type QuestionStyle } from "@/lib/question-purpose";
/**
 * Prompt registry — the single place where all LLM system prompts live.
 *
 * Same pattern as handai's `src/lib/prompts.ts` but scoped to Carmenita:
 * a `PROMPTS` record of `PromptDef` and `getPrompt(id)` returning the
 * default. Per-user overrides are stored in the database (see
 * `settings-store.ts` / `prompt-overrides-client.ts`).
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

// Legacy localStorage prefix (pre-database versions). Only read now, to
// migrate old overrides into the DB the first time the Settings page loads.
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
- Every question has exactly 5 options.
- For mcq-multi questions, 2 to 4 of the 5 options are correct AND at least one is wrong — never all five.`;

// Shared "question shape" block common to all three generation prompts.
const QUESTION_SHAPE = `Each question MUST include every one of these fields:

- "type": "mcq-single" (exactly one correct answer) or "mcq-multi" (2 to 4 correct answers).
- "question": the question text, clear and self-contained.
- "options": an array of exactly 5 option strings.
- "correctAnswer": for mcq-single, a 0-indexed number. For mcq-multi, an array of 2 to 4 0-indexed numbers (at least one option stays wrong).
- "explanation": 2–4 sentences. Say why the correct answer is correct (the mechanism or reasoning, not a restatement of the option), then why the most tempting distractor is wrong. Write for a learner who just picked that distractor.
- "difficulty": "easy", "medium", or "hard".
- "bloomLevel": one of "remember", "understand", "apply", "analyze", "evaluate", "create".
- "sourcePassage": see the mode-specific rule below.`;

// Shared item-writing standard for every generation prompt. The material a
// user supplies (a document, slides, pasted notes) is what to TEST, not text
// to copy back — recycled sentences make recognition items that a learner
// answers by remembering wording rather than understanding.
// question-quality.ts enforces the copying rule after generation.
const ITEM_WRITING = `How to write the questions (this is what makes a quiz worth taking):

Test understanding, not recognition of wording.
- Never copy a sentence or a long phrase from the material into the question or the options. Restate ideas in your own words; a learner who memorised the text's wording without understanding it should not be able to answer.
- Prefer questions that make the learner use an idea: apply it to a short concrete scenario or case, predict a consequence, explain a cause, compare two related things, or pick the best option for a given situation. Use plain recall only for facts a learner genuinely has to know by heart.
- Across the batch, aim for roughly half the questions at "apply" or higher on Bloom's scale, and match bloomLevel honestly to what each question demands.
- Each question tests one idea. Different questions test different ideas — never the same fact twice in different words.

Write the stem so it can be answered before looking at the options.
- One clear question or an incomplete statement, with everything needed to answer it. Put shared wording in the stem, not repeated in every option.
- Ask positively. Avoid "Which is NOT…" / "All EXCEPT…" — they test reading more than knowledge.

Make the options fair.
- Distractors are things a learner who misunderstands would really choose: common misconceptions, confusable neighbours (a drug from the same class, a similar process, a reversed cause and effect), or a partly-correct answer that misses the key point.
- All options are the same kind of thing, similar in length, detail and grammar, so none stands out. The correct answer must not be the longest, the most precise or the only hedged one.
- No "all of the above", "none of the above", "both A and B", or joke options.
- Exactly one option is defensibly correct for mcq-single; an expert should not be able to argue for a second.
- In mcq-multi, each option is a separate true-or-false judgement: clearly correct or clearly wrong on its own, never "partly true".

Get the facts right. If you are not confident a claim is accurate and standard, do not build a question on it.`;

// Purpose and style blocks, appended after a rendered generation prompt
// (default or user-overridden) by `purposeStyleBlock()`. Difficulty is left
// to the request's difficulty mix, which the purpose only pre-sets in the UI.
export const PURPOSE_BLOCKS: Record<QuestionPurpose, string> = {
  formative: `PURPOSE: formative check. These questions help a learner find gaps while they are still learning, so the feedback matters more than the score.
- Keep stems short and focused on one idea.
- Mix recall of facts a learner must know (about half) with understanding and simple application.
- Make the explanation the most useful part: why the correct answer is right, and for each wrong option, the misunderstanding that would lead someone to pick it.`,
  training: `PURPOSE: training. These questions build skill through practice.
- Mix short questions with brief scenarios that make the learner use an idea.
- About half at "apply" or higher.
- Explanations: why the correct answer is right, and why the most tempting wrong option is wrong.`,
  exam: `PURPOSE: exam (high stakes). These questions must reliably separate learners who understand the topic from those who do not, and be fair to both.
- About 70% of stems present a scenario or case that requires applying or analysing knowledge.
- In single-answer items exactly one option is unarguably best; in multiple-answer items every option is unambiguously correct or wrong. Every wrong option is plausible to a learner with a specific gap, and none is a trick.
- Test important ideas, never obscure detail.
- Explanations are one or two sentences, for review after the exam.`,
};

export const BOARD_STYLE_BLOCK = `STYLE: board exam. Follow the NBME item-writing guidelines used for USMLE.
- Choose the stem to fit the content:
  - Clinical content (diagnosis, management, adverse effects in patients): a clinical vignette, in this order: age and sex, setting, presenting complaint, relevant history and medications, examination findings, then test results if needed.
  - Basic science (mechanisms, pharmacology, physiology, biochemistry): an experimental or laboratory scenario, a description of data to interpret, or a mechanism question. No patient is needed; do not invent one just to have a case.
- Lead-in: one clear question. Single-answer: "Which of the following is the most likely diagnosis / mechanism / drug / explanation for these findings?" — answerable with the options covered. Multiple-answer: "Which of the following are …? Select all that apply."
- Options: 5 short options of the same kind (all diagnoses, all drugs or all mechanisms), in a logical order (alphabetical or numerical).
- Test applying and integrating knowledge, not isolated recall of a fact.`;

/** The text appended to a generation prompt for this purpose and style. */
export function purposeStyleBlock(
  purpose: QuestionPurpose = DEFAULT_PURPOSE,
  style: QuestionStyle = DEFAULT_STYLE,
): string {
  return style === "board"
    ? `${PURPOSE_BLOCKS[purpose]}\n\n${BOARD_STYLE_BLOCK}`
    : PURPOSE_BLOCKS[purpose];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DOCUMENT mode — generate from an uploaded source passage.
//    Emphasizes source fidelity: do not fabricate beyond what the passage says.
// ─────────────────────────────────────────────────────────────────────────────
const MCQ_DOCUMENT_DEFAULT = `You are an expert educator generating multiple-choice questions from an uploaded source passage.

Given the passage below, generate exactly {n} questions that test understanding of the key concepts in the passage. The passage is the authority on WHAT is true — do NOT bring in facts or claims it does not support. But the questions are yours: rephrase, combine ideas from different parts of the passage, and build scenarios that apply what it teaches, rather than turning its sentences into questions.

${QUESTION_SHAPE}
- For "sourcePassage": a direct verbatim quote (≤ 200 characters) from the source passage below that supports the correct answer. Must appear literally in the passage. This is the evidence for the answer — it belongs here, and only here; the question and options must not reuse its wording.

${ITEM_WRITING}

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

Generate exactly {n} questions that test conceptual understanding at the target level.

The objectives field may contain notes the learner pasted in. Treat them as a map of what to cover, never as text to copy: test the ideas they name with questions written in your own words, at the target level, drawing on standard knowledge of the topic.

${QUESTION_SHAPE}
- For "sourcePassage": a short canonical statement or definition (≤ 200 characters) that the correct answer rests on. This is YOUR concise synthesis from general knowledge, not a quote from a document. Think "what a textbook glossary entry would say."

${ITEM_WRITING}

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
- For "sourcePassage": the single slide bullet (≤ 200 characters) that most directly supports the correct answer. Quote it verbatim if possible; it's OK to quote a terse fragment. The question and options must not reuse the bullet's wording.

${ITEM_WRITING}

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
      "Generates MCQs from a typed topic with optional structured context (subject, level, objectives) and the learner's custom instructions, which the builder appends last. No source document — uses the LLM's training knowledge.",
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
 * The registered default for a prompt id. User overrides live in the
 * database (`app_settings`, key `prompt:<id>`): the server resolves them
 * with `resolvePrompt()` in `settings-store.ts`, and the Settings page
 * edits them through `prompt-overrides-client.ts`.
 */
export function getPrompt(id: string): string {
  const def = PROMPTS[id];
  if (!def) throw new Error(`Unknown prompt id: ${id}`);
  return def.defaultValue;
}

/** localStorage key used by older versions — read once to migrate into the DB. */
export function legacyPromptOverrideKey(id: string): string {
  return OVERRIDE_PREFIX + id;
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
