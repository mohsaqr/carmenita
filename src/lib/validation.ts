import { z } from "zod";

/**
 * Zod schemas for every API route request body. Route handlers parse
 * the incoming JSON through these before touching the DB or LLM.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

export const ProviderConfigSchema = z.object({
  id: z.string(),
  providerType: z.enum([
    "openai",
    "anthropic",
    "google",
    "groq",
    "together",
    "azure",
    "openrouter",
    "ollama",
    "lmstudio",
    "custom",
  ]),
  displayName: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  defaultModel: z.string(),
  isEnabled: z.boolean(),
});

export const QuizSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(50),
  allowedTypes: z
    .array(z.enum(["mcq-single", "mcq-multi", "true-false"]))
    .min(1),
  difficultyMix: z
    .object({
      easy: z.number().min(0).max(1).optional(),
      medium: z.number().min(0).max(1).optional(),
      hard: z.number().min(0).max(1).optional(),
    })
    .optional(),
  immediateFeedback: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/documents
// ─────────────────────────────────────────────────────────────────────────────

export const CreateDocumentSchema = z.object({
  filename: z.string().min(1).max(512),
  // Base64-encoded file content. Using base64 (not multipart/form-data)
  // keeps the API symmetric with the rest of the JSON routes.
  contentBase64: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/generate-quiz
// ─────────────────────────────────────────────────────────────────────────────

export const GenerateQuizSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1).max(200),
  settings: QuizSettingsSchema,
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
  systemPromptOverride: z.string().optional(),
  // Optional taxonomy defaults — if provided, every generated question
  // gets this subject/lesson/tag(s) overlay even if the LLM doesn't
  // populate them itself. Useful for a whole-chapter generation flow
  // where the student knows the subject/lesson up front.
  defaultSubject: z.string().max(200).optional(),
  defaultLesson: z.string().max(200).optional(),
  defaultTags: z.array(z.string().max(100)).max(20).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/generate-from-topic — generate questions from a typed topic
// (no source document). Used by the Topic tab of /create.
// ─────────────────────────────────────────────────────────────────────────────

export const GenerateFromTopicSchema = z.object({
  topic: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  subject: z.string().max(200).optional(),
  level: z.string().max(100).optional(),
  objectives: z.string().max(5000).optional(),
  mustInclude: z.string().max(5000).optional(),
  settings: QuizSettingsSchema,
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
  systemPromptOverride: z.string().optional(),
  defaultSubject: z.string().max(200).optional(),
  defaultLesson: z.string().max(200).optional(),
  defaultTags: z.array(z.string().max(100)).max(20).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/questions/explain — bulk-add explanations to existing questions
// ─────────────────────────────────────────────────────────────────────────────

export const BankExplainSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
  /**
   * If true, skip questions that already have a non-empty explanation
   * and only fill in the blank ones. If false, overwrite all of them.
   * Default: true (non-destructive).
   */
  onlyIfMissing: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/quick-quiz — assemble a quiz on the fly from a filter selection
// ─────────────────────────────────────────────────────────────────────────────

export const QuickQuizSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    count: z.number().int().min(1).max(2000),
    // Filter criteria (all optional — empty means "any question in the bank")
    subject: z.string().max(200).optional(),
    lesson: z.string().max(200).optional(),
    topic: z.string().max(200).optional(),
    tag: z.string().max(100).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    bloomLevel: z
      .enum(["remember", "understand", "apply", "analyze", "evaluate", "create"])
      .optional(),
    sourceType: z
      .enum([
        "document",
        "gift-import",
        "aiken-import",
        "markdown-import",
        "manual",
        "variation",
      ])
      .optional(),
    // If caller already has a list of candidate ids (e.g. from the bank page
    // grouped view), pass them through — the server shuffles and slices to
    // the requested count. Ignored if absent; filter criteria are used instead.
    candidateIds: z.array(z.string().min(1)).max(2000).optional(),
    immediateFeedback: z.boolean().optional(),
    shuffle: z.boolean().optional(), // default true
  })
  .refine(
    (v) =>
      v.candidateIds !== undefined ||
      v.subject !== undefined ||
      v.lesson !== undefined ||
      v.topic !== undefined ||
      v.tag !== undefined ||
      v.difficulty !== undefined ||
      v.bloomLevel !== undefined ||
      v.sourceType !== undefined ||
      true, // actually: allow unfiltered "any question in the bank" mode
    { message: "filter criteria placeholder" },
  );

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/variations-batch — generate variations for many parent questions
// in one request. Each parent gets `count` variations of the given type.
// ─────────────────────────────────────────────────────────────────────────────

export const BankVariationsBatchSchema = z.object({
  parentIds: z.array(z.string().min(1)).min(1).max(100),
  variationType: z.enum(["topic", "distractors", "paraphrase", "harder", "easier"]),
  countPerParent: z.number().int().min(1).max(10),
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/questions/retag — bulk-derive subject/lesson/topic/tags
// ─────────────────────────────────────────────────────────────────────────────

export const BankRetagSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/attempts
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAttemptSchema = z.object({
  quizId: z.string().min(1),
});

export const SubmitAnswerSchema = z.object({
  questionId: z.string().min(1),
  userAnswer: z.union([
    z.number().int().nonnegative(),
    z.array(z.number().int().nonnegative()),
    z.null(),
  ]),
  timeMs: z.number().int().nonnegative(),
});

export const SubmitAttemptSchema = z.object({
  answers: z.array(SubmitAnswerSchema).min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/import
// ─────────────────────────────────────────────────────────────────────────────

export const BankImportSchema = z.object({
  format: z.enum(["gift", "aiken", "markdown"]),
  text: z.string().min(1).max(5_000_000), // 5 MB cap
  sourceLabel: z.string().min(1).max(512).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/quiz-from-questions — build a quiz by selecting bank questions
// ─────────────────────────────────────────────────────────────────────────────

export const CreateQuizFromBankSchema = z.object({
  title: z.string().min(1).max(200),
  questionIds: z.array(z.string().min(1)).min(1).max(200),
  immediateFeedback: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/variations — generate N variations of an existing question
// ─────────────────────────────────────────────────────────────────────────────

export const GenerateVariationsSchema = z.object({
  questionId: z.string().min(1),
  variationType: z.enum(["topic", "distractors", "paraphrase", "harder", "easier"]),
  count: z.number().int().min(1).max(20),
  provider: ProviderConfigSchema,
  temperature: z.number().min(0).max(2).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/bank/questions/bulk-tag — bulk-assign taxonomy
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bank/questions — create a question manually
// ─────────────────────────────────────────────────────────────────────────────

export const CreateQuestionSchema = z
  .object({
    type: z.enum(["mcq-single", "mcq-multi", "true-false"]),
    question: z.string().min(5).max(2000),
    options: z.array(z.string().min(1).max(500)).min(2).max(8),
    correctAnswer: z.union([
      z.number().int().nonnegative(),
      z.array(z.number().int().nonnegative()).min(1),
    ]),
    explanation: z.string().max(2000).default(""),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    bloomLevel: z
      .enum(["remember", "understand", "apply", "analyze", "evaluate", "create"])
      .default("understand"),
    subject: z.string().max(200).nullable().optional(),
    lesson: z.string().max(200).nullable().optional(),
    topic: z.string().min(1).max(200),
    tags: z.array(z.string().max(100)).max(20).default([]),
    sourcePassage: z.string().max(500).default(""),
  })
  .refine(
    (v) => {
      // Type-specific constraint checks mirroring question-schema.ts so
      // manually created questions obey the same rules as LLM-generated ones.
      if (v.type === "true-false") {
        if (v.options.length !== 2) return false;
        if (typeof v.correctAnswer !== "number") return false;
        return v.correctAnswer === 0 || v.correctAnswer === 1;
      }
      if (v.type === "mcq-single") {
        if (typeof v.correctAnswer !== "number") return false;
        return v.correctAnswer >= 0 && v.correctAnswer < v.options.length;
      }
      // mcq-multi
      if (!Array.isArray(v.correctAnswer)) return false;
      if (v.correctAnswer.length < 2) return false;
      if (v.correctAnswer.length >= v.options.length) return false;
      if (new Set(v.correctAnswer).size !== v.correctAnswer.length) return false;
      return v.correctAnswer.every((i) => i >= 0 && i < v.options.length);
    },
    {
      message: "Invalid type/options/correctAnswer combination",
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bank/questions/bulk-delete — delete many bank questions
// ─────────────────────────────────────────────────────────────────────────────

export const BulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export const BulkTagSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    // nullable = explicit clear, undefined = leave as-is
    subject: z.string().max(200).nullable().optional(),
    lesson: z.string().max(200).nullable().optional(),
    topic: z.string().min(1).max(200).optional(),
    addTags: z.array(z.string().min(1).max(100)).max(50).optional(),
    removeTags: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .refine(
    (v) =>
      v.subject !== undefined ||
      v.lesson !== undefined ||
      v.topic !== undefined ||
      (v.addTags?.length ?? 0) > 0 ||
      (v.removeTags?.length ?? 0) > 0,
    {
      message:
        "At least one of subject/lesson/topic/addTags/removeTags must be set",
    },
  );

// Inferred types
export type CreateDocumentBody = z.infer<typeof CreateDocumentSchema>;
export type GenerateQuizBody = z.infer<typeof GenerateQuizSchema>;
export type GenerateFromTopicBody = z.infer<typeof GenerateFromTopicSchema>;
export type CreateAttemptBody = z.infer<typeof CreateAttemptSchema>;
export type SubmitAttemptBody = z.infer<typeof SubmitAttemptSchema>;
export type BankImportBody = z.infer<typeof BankImportSchema>;
export type CreateQuizFromBankBody = z.infer<typeof CreateQuizFromBankSchema>;
export type GenerateVariationsBody = z.infer<typeof GenerateVariationsSchema>;
export type BulkTagBody = z.infer<typeof BulkTagSchema>;
export type CreateQuestionBody = z.infer<typeof CreateQuestionSchema>;
export type BulkDeleteBody = z.infer<typeof BulkDeleteSchema>;
export type BankExplainBody = z.infer<typeof BankExplainSchema>;
export type BankRetagBody = z.infer<typeof BankRetagSchema>;
export type QuickQuizBody = z.infer<typeof QuickQuizSchema>;
export type BankVariationsBatchBody = z.infer<typeof BankVariationsBatchSchema>;
