/**
 * Chatbot prompt templates — students copy-paste these into ChatGPT,
 * Claude, Gemini, or any other LLM to generate questions in a format
 * Carmenita can import directly.
 *
 * Each template has three placeholders the student replaces:
 *   {N}       — number of questions to generate
 *   {TOPIC}   — the topic or short description
 *   {SOURCE}  — the source material (notes, chapter text, etc.)
 *
 * Design goals:
 *   • Strict output format with zero ambiguity
 *   • Complete worked example inside the prompt so the chatbot has a
 *     concrete pattern to follow
 *   • Explicit negative constraints ("no preamble", "no code fences")
 *     since chatbots love to wrap output in ```markdown … ```
 *   • Enum values listed exactly as Carmenita expects them
 *   • Works with every major LLM we've tested (GPT-4o, Claude 3.5,
 *     Gemini 1.5, Llama 3.3)
 *
 * Each prompt's embedded example is verified by
 * `src/lib/__tests__/chatbot-prompts.test.ts` — the example must
 * successfully parse through its target format's parser. If you edit
 * the examples, run the tests.
 */

export type ChatbotPromptFormat = "markdown" | "gift" | "aiken";

export interface PromptVars {
  n: number;
  topic: string;
  source: string;
  subject: string;
  lesson: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown format prompt — RECOMMENDED
// ─────────────────────────────────────────────────────────────────────────────

export const MARKDOWN_PROMPT = `You are an expert educator generating multiple-choice quiz questions for a student's learning app called Carmenita. The student will import your output directly into the app, so your output MUST follow the format below EXACTLY.

# Task

Generate exactly {N} high-quality multiple-choice questions covering: {TOPIC}

Subject: {SUBJECT}
Lesson: {LESSON}

Use the source material at the end of this prompt. Do not fabricate facts that are not in the source.

# Output format (FOLLOW EXACTLY)

Each question is a block with this structure:

## Q1
**Type:** mcq-single
**Difficulty:** easy
**Bloom:** remember
**Subject:** biology
**Lesson:** plants
**Topic:** photosynthesis
**Tags:** chlorophyll, light

**Question:** What color is chlorophyll?

- [ ] Red
- [x] Green
- [ ] Blue
- [ ] Yellow

**Explanation:** Chlorophyll absorbs red and blue wavelengths and reflects green light.
**Source:** "Chlorophyll is the green pigment in plant cells that absorbs light primarily in the blue and red wavelengths."

---

# Field rules

- **Type** is one of EXACTLY: \`mcq-single\` (one correct), \`mcq-multi\` (two or more correct), \`true-false\`.
- **Difficulty** is EXACTLY one of: \`easy\`, \`medium\`, \`hard\`.
- **Bloom** is EXACTLY one of: \`remember\`, \`understand\`, \`apply\`, \`analyze\`, \`evaluate\`, \`create\`.
- **Subject** is the broad discipline (e.g. biology, mathematics, history). Use the value \`{SUBJECT}\` if provided; otherwise pick one short lowercase word.
- **Lesson** is the specific lesson, chapter, or unit (e.g. "chapter 5", "photosynthesis", "integration by parts"). Use the value \`{LESSON}\` if provided; otherwise leave it out or pick a short descriptive name.
- **Topic** is a short lowercase concept tag, 2-4 words (the most specific level). Reuse the same tag across related questions.
- **Tags** is an optional comma-separated list of extra keywords (e.g. \`chlorophyll, light, green\`). Omit the line if no tags apply.
- **Question** is the question stem, self-contained, clear, one line.
- Options use GitHub checkbox syntax: \`- [ ]\` for wrong, \`- [x]\` for correct.
- For \`mcq-single\`: EXACTLY 4 options, EXACTLY one \`[x]\`.
- For \`mcq-multi\`: 4 options, TWO OR MORE marked \`[x]\`, at least one \`[ ]\`.
- For \`true-false\`: EXACTLY these two options in this order:
  \`\`\`
  - [x] True     (or [x] on False)
  - [ ] False
  \`\`\`
- **Explanation** is 1-2 sentences explaining why the correct answer is correct.
- **Source** is a direct verbatim quote (up to ~200 characters) from the source material that supports the correct answer, wrapped in double quotes.

# Separator

Separate questions with a line containing exactly: \`---\`

# STRICT output rules

1. Output ONLY the question blocks. No preamble. No trailing commentary. No summary.
2. Do NOT wrap the output in a code fence. Do NOT output \\\`\\\`\\\`markdown or \\\`\\\`\\\`. Just the raw markdown.
3. Every field above is REQUIRED for every question.
4. Distractors must be plausible but unambiguously incorrect.
5. Cover the source material broadly — do not cluster all questions around one concept.
6. Do not fabricate facts not in the source.
7. Number questions sequentially: \`## Q1\`, \`## Q2\`, \`## Q3\`, …

# Complete worked example (three questions of different types)

## Q1
**Type:** mcq-single
**Difficulty:** easy
**Bloom:** remember
**Subject:** biology
**Lesson:** plants
**Topic:** photosynthesis
**Tags:** chlorophyll, pigments

**Question:** What color is chlorophyll?

- [ ] Red
- [x] Green
- [ ] Blue
- [ ] Yellow

**Explanation:** Chlorophyll absorbs red and blue wavelengths and reflects green light, which is why leaves look green.
**Source:** "Chlorophyll is the green pigment in plant cells that absorbs light primarily in the blue and red wavelengths."

---

## Q2
**Type:** mcq-multi
**Difficulty:** medium
**Bloom:** apply
**Subject:** physics
**Lesson:** optics
**Topic:** color theory
**Tags:** light, additive mixing

**Question:** Which of these are primary colors in additive color mixing?

- [x] Red
- [x] Green
- [x] Blue
- [ ] Yellow

**Explanation:** Red, green, and blue are the three additive primary colors; yellow is produced by mixing red and green light.
**Source:** "In additive color mixing, the primary colors are red, green, and blue."

---

## Q3
**Type:** true-false
**Difficulty:** easy
**Bloom:** understand
**Subject:** astronomy
**Lesson:** solar system
**Topic:** the sun

**Question:** The Sun is a star.

- [x] True
- [ ] False

**Explanation:** The Sun is a G-type main-sequence star at the center of our solar system.
**Source:** "The Sun is the star at the center of the Solar System."

# Source material

{SOURCE}

# Final reminder

Produce exactly {N} questions in the format shown above. Output nothing else — no preamble, no code fence, no closing remarks. Start with \`## Q1\` on the very first line of your response.`;

// ─────────────────────────────────────────────────────────────────────────────
// GIFT format prompt
// ─────────────────────────────────────────────────────────────────────────────

export const GIFT_PROMPT = `You are an expert educator generating multiple-choice quiz questions in Moodle GIFT format for a student's learning app called Carmenita. The student will import your output directly into the app, so your output MUST follow GIFT format EXACTLY.

# Task

Generate exactly {N} high-quality multiple-choice questions covering: {TOPIC}

Subject: {SUBJECT}
Lesson: {LESSON}

Use the source material at the end of this prompt. Do not fabricate facts not in the source.

# GIFT format reference

GIFT is a plain-text question format used by Moodle. Each question is a block ending with an answer group in braces \`{ ... }\` and an optional \`####\` question-level feedback.

Supported question types:
  • Multiple choice, single answer   — \`{ =correct ~wrong ~wrong ~wrong }\`
  • Multiple choice, multiple answer — \`{ ~%50%right ~%50%right ~%-100%wrong ~%-100%wrong }\`
  • True/False                       — \`{ T }\` or \`{ F }\`

# Special characters that MUST be escaped

If any of these characters appear in a question stem, option, or feedback, escape them with a backslash:
  \\\\  \\:  \\#  \\=  \\~  \\{  \\}

# Output format by type

## Single-answer multiple choice

\`\`\`
$CATEGORY: topic

::Title:: Question stem? {
	=correct answer
	~wrong 1
	~wrong 2
	~wrong 3
}####Explanation of why the correct answer is correct.
\`\`\`

## Multiple-answer multiple choice (weighted)

For a 4-option question with 2 correct, each correct gets weight 50 and each wrong gets -100:

\`\`\`
::Title:: Which of these are primary colors? {
	~%50%Red
	~%50%Green
	~%-100%Yellow
	~%-100%Purple
}####Red and green are primary colors; yellow and purple are secondary.
\`\`\`

For 3 correct out of 4 options: correct = 33, wrong = -100 (weights do not need to sum to 100).

## True/False

\`\`\`
::Title:: Photosynthesis produces oxygen as a byproduct. {T}####Plants release O2 while consuming CO2 during the light reactions.
\`\`\`

Use \`{T}\` for True, \`{F}\` for False.

# STRICT output rules

1. Output ONLY valid GIFT text. No preamble, no code fence, no trailing commentary.
2. Do NOT wrap the output in \\\`\\\`\\\`gift or \\\`\\\`\\\`. Just the raw GIFT text.
3. Start with \`$CATEGORY: {SUBJECT}/{LESSON}/{TOPIC}\` on the first line — the slash-separated path encodes subject/lesson/topic so Carmenita can split it into its three-level taxonomy on import. If Subject or Lesson is empty, drop that segment (e.g. \`$CATEGORY: {LESSON}/{TOPIC}\`).
4. Use \`::Short Title::\` before every question stem. The title is a 2-4 word concept tag (reused across related questions where possible).
5. Every question MUST end with \`####\` followed by the explanation.
6. Separate questions with a single blank line.
7. Escape special characters in stems, options, and feedback.
8. For multi-answer, weights must be non-zero and include at least two positive and one negative entry.

# Complete worked example (three questions)

$CATEGORY: biology/plants

::Chlorophyll:: What color is chlorophyll? {
	~Red
	=Green
	~Blue
	~Yellow
}####Chlorophyll absorbs red and blue wavelengths and reflects green, which is why leaves look green.

::Primary producers:: Which of these are primary producers? {
	~%50%Algae
	~%50%Grass
	~%-100%Lions
	~%-100%Mushrooms
}####Algae and grass photosynthesize; lions and fungi do not produce their own food.

::Photosynthesis output:: Photosynthesis produces oxygen as a byproduct. {T}####Plants release O2 while consuming CO2 during the light reactions.

# Source material

{SOURCE}

# Final reminder

Produce exactly {N} questions in GIFT format. Start with \`$CATEGORY: {TOPIC}\` on the very first line. Output nothing else — no preamble, no code fence, no closing remarks.`;

// ─────────────────────────────────────────────────────────────────────────────
// Aiken format prompt
// ─────────────────────────────────────────────────────────────────────────────

export const AIKEN_PROMPT = `You are an expert educator generating multiple-choice quiz questions in Moodle Aiken format for a student's learning app called Carmenita. The student will import your output directly into the app, so your output MUST follow Aiken format EXACTLY.

# Task

Generate exactly {N} multiple-choice questions covering: {TOPIC}

Subject: {SUBJECT}
Lesson: {LESSON}

Use the source material at the end of this prompt. Do not fabricate facts not in the source.

# IMPORTANT LIMITATION: Aiken does NOT support feedback or metadata

The Aiken format is intentionally minimal and CANNOT carry:
  • Explanations of why the answer is correct
  • Difficulty levels
  • Bloom's taxonomy tags
  • Subject, lesson, or topic categories
  • Tags
  • Source citations
  • Multi-answer questions (only ONE correct answer per question)

If the student wants feedback or taxonomy metadata, they should use the Markdown or GIFT prompt instead. This prompt produces Aiken because Aiken is the simplest format and some platforms only accept it. Subject and Lesson above are for YOUR context only — do not emit them.

# Output format (FOLLOW EXACTLY)

Each question is a block with this exact structure:

\`\`\`
The question stem goes on one line.
A. First option
B. Second option
C. Third option
D. Fourth option
ANSWER: B
\`\`\`

Separate questions with a single blank line.

# STRICT rules

1. Output ONLY the question blocks. No preamble. No trailing commentary. No code fence.
2. Do NOT wrap the output in \\\`\\\`\\\` or any code marker.
3. The question stem is a SINGLE line — use one logical sentence. Do not split it across multiple lines.
4. Options start at \`A.\` and continue in alphabetical order (\`A.\`, \`B.\`, \`C.\`, \`D.\`).
5. Use the period form \`A.\` (not \`A)\` or \`(A)\`).
6. Provide 2 to 4 options per question. 4 is strongly preferred.
7. The answer line is EXACTLY \`ANSWER: X\` in all caps with a space after the colon, where X is the letter of the correct option.
8. There must be EXACTLY ONE correct answer per question — multi-answer is not supported.
9. For True/False questions, use exactly this form:
   \`\`\`
   The statement goes here.
   A. True
   B. False
   ANSWER: A
   \`\`\`
10. Do NOT include explanations, feedback, difficulty labels, or any metadata — Aiken will reject them.
11. Separate questions with ONE blank line. No other separators (no \`---\`, no numbering).

# Complete worked example (three questions)

What is the capital of France?
A. Berlin
B. Paris
C. London
D. Madrid
ANSWER: B

What color is chlorophyll?
A. Red
B. Green
C. Blue
D. Yellow
ANSWER: B

The Sun is a star.
A. True
B. False
ANSWER: A

# Source material

{SOURCE}

# Final reminder

Produce exactly {N} questions in Aiken format. The first line of your response must be the stem of question 1. Do NOT include any preamble, code fence, explanation, difficulty, or feedback — Aiken does not support them and the import will reject the output.`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export const CHATBOT_PROMPTS: Record<ChatbotPromptFormat, string> = {
  markdown: MARKDOWN_PROMPT,
  gift: GIFT_PROMPT,
  aiken: AIKEN_PROMPT,
};

/**
 * Substitute {N}, {TOPIC}, {SUBJECT}, {LESSON}, and {SOURCE} placeholders.
 * If `source` is empty, emits a friendly placeholder so the student knows
 * to paste their own material.
 */
export function buildChatbotPrompt(
  format: ChatbotPromptFormat,
  vars: Partial<PromptVars>,
): string {
  const template = CHATBOT_PROMPTS[format];
  const n = String(vars.n ?? 10);
  const topic = (vars.topic ?? "").trim() || "(fill in your topic here)";
  const subject = (vars.subject ?? "").trim() || "(not specified)";
  const lesson = (vars.lesson ?? "").trim() || "(not specified)";
  const source =
    (vars.source ?? "").trim() ||
    "(Paste your notes, textbook passage, or article text here. " +
      "Replace this placeholder with the actual source material before " +
      "sending to the chatbot.)";
  return template
    .replace(/\{N\}/g, n)
    .replace(/\{TOPIC\}/g, topic)
    .replace(/\{SUBJECT\}/g, subject)
    .replace(/\{LESSON\}/g, lesson)
    .replace(/\{SOURCE\}/g, source);
}

/** Human-readable descriptions used by the UI. */
export const FORMAT_DESCRIPTIONS: Record<
  ChatbotPromptFormat,
  { label: string; short: string; long: string }
> = {
  markdown: {
    label: "Markdown (recommended)",
    short: "Full metadata support",
    long:
      "Carmenita's native format. Supports all question types, difficulty, Bloom level, topic, explanation, and source citation. Every chatbot knows Markdown well, so this is the most reliable format.",
  },
  gift: {
    label: "Moodle GIFT",
    short: "Good for Moodle users",
    long:
      "Moodle's plain-text question format. Supports all three question types and question-level feedback (explanations), but not Bloom level or difficulty. Round-trips cleanly to Moodle if you also use Moodle.",
  },
  aiken: {
    label: "Moodle Aiken",
    short: "Simplest, but no feedback",
    long:
      "Moodle's simplest format. Single-answer MCQs and true/false only. Does NOT support explanations, feedback, difficulty, Bloom level, or any metadata. Use only if your target platform only accepts Aiken.",
  },
};
