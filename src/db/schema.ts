import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Documents — source material (PDF/DOCX/text) uploaded by the user.
// ─────────────────────────────────────────────────────────────────────────────
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  text: text("text").notNull(),
  charCount: integer("char_count").notNull(),
  truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  userId: text("user_id"), // nullable — forward-compat with multi-user
});

// ─────────────────────────────────────────────────────────────────────────────
// Quizzes — a generated quiz belongs to one document.
// ─────────────────────────────────────────────────────────────────────────────
export type QuestionType = "mcq-single" | "mcq-multi" | "true-false";
export type Difficulty = "easy" | "medium" | "hard";
export type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export interface QuizSettings {
  questionCount: number;
  allowedTypes: QuestionType[];
  difficultyMix?: Partial<Record<Difficulty, number>>;
  immediateFeedback: boolean;
}

export const quizzes = sqliteTable(
  "quizzes",
  {
    id: text("id").primaryKey(),
    // Nullable because quizzes can also be assembled from the question
    // bank (imported or manual questions) with no single source document.
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    settings: text("settings", { mode: "json" }).$type<QuizSettings>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
    // Soft-delete marker. NULL = active; ISO timestamp = in trash.
    // Trash is listed via /api/trash and restorable via POST
    // /api/trash/[id]/restore. Permanent deletion happens via
    // DELETE /api/trash/[id].
    deletedAt: text("deleted_at"),
    userId: text("user_id"),
  },
  (t) => ({
    byDocument: index("idx_quizzes_document_id").on(t.documentId),
    byCreated: index("idx_quizzes_created_at").on(t.createdAt),
    byDeleted: index("idx_quizzes_deleted_at").on(t.deletedAt),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Questions — standalone question bank. Questions are NOT owned by any
// single quiz; quizzes reference them via the `quiz_questions` junction
// table below. A question can appear in multiple quizzes, be imported
// from GIFT/Aiken, be created manually, or be generated from a document.
//
// `correctAnswer` is stored as JSON because it can be either a number
// (mcq-single / true-false) or number[] (mcq-multi).
// ─────────────────────────────────────────────────────────────────────────────
export type QuestionSource =
  | "document"
  | "gift-import"
  | "aiken-import"
  | "markdown-import"
  | "manual"
  | "variation";

export type VariationType =
  | "topic"
  | "distractors"
  | "paraphrase"
  | "harder"
  | "easier";

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: ["mcq-single", "mcq-multi", "true-false"],
    }).notNull(),
    question: text("question").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    correctAnswer: text("correct_answer", { mode: "json" })
      .$type<number | number[]>()
      .notNull(),
    explanation: text("explanation").notNull(),
    difficulty: text("difficulty", {
      enum: ["easy", "medium", "hard"],
    }).notNull(),
    bloomLevel: text("bloom_level", {
      enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"],
    }).notNull(),
    // Hierarchical taxonomy: subject → lesson → topic.
    // `topic` is the most specific and is required (since generation always
    // produces one). `subject` and `lesson` are optional — they're added by
    // the student (or by the import parser when the source format carries
    // them, e.g. GIFT `$CATEGORY: subject/lesson/topic`).
    subject: text("subject"),
    lesson: text("lesson"),
    topic: text("topic").notNull(),
    // Free-form tags beyond the subject/lesson/topic hierarchy. Stored as
    // a JSON string[]. Default is an empty array so queries never see null.
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    sourcePassage: text("source_passage").notNull(),
    // Per-question free-text notes the user writes while studying.
    // Persistent across sessions; NULL means no note yet. Edited via
    // PATCH /api/bank/questions/[id] with body { notes: string | null }.
    notes: text("notes"),
    // Provenance
    sourceType: text("source_type", {
      enum: [
        "document",
        "gift-import",
        "aiken-import",
        "markdown-import",
        "manual",
        "variation",
      ],
    }).notNull().default("document"),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    sourceLabel: text("source_label"), // e.g. import filename, or null
    // If this question was generated as a VARIATION of another, point back
    // to the original. Self-reference with ON DELETE SET NULL so deleting
    // a parent doesn't cascade-delete its variations.
    parentQuestionId: text("parent_question_id"),
    variationType: text("variation_type", {
      enum: ["topic", "distractors", "paraphrase", "harder", "easier"],
    }),
    createdAt: text("created_at").notNull(),
    userId: text("user_id"),
  },
  (t) => ({
    byTopic: index("idx_questions_topic").on(t.topic),
    bySubject: index("idx_questions_subject").on(t.subject),
    byLesson: index("idx_questions_lesson").on(t.lesson),
    byDifficulty: index("idx_questions_difficulty").on(t.difficulty),
    byBloom: index("idx_questions_bloom_level").on(t.bloomLevel),
    bySource: index("idx_questions_source_type").on(t.sourceType),
    bySourceDoc: index("idx_questions_source_doc").on(t.sourceDocumentId),
    byParent: index("idx_questions_parent").on(t.parentQuestionId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// quiz_questions — junction table linking quizzes to questions with order.
// Composite primary key (quiz_id, question_id). `idx` defines display
// order within the quiz; duplicate idx values within one quiz are
// discouraged but allowed.
// ─────────────────────────────────────────────────────────────────────────────
export const quizQuestions = sqliteTable(
  "quiz_questions",
  {
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.quizId, t.questionId] }),
    byQuizIdx: index("idx_quiz_questions_quiz_idx").on(t.quizId, t.idx),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Attempts — one row per quiz retake.
// `completedAt` and `score` are null while the attempt is in progress.
// ─────────────────────────────────────────────────────────────────────────────
export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    score: real("score"),
    userId: text("user_id"),
  },
  (t) => ({
    byQuiz: index("idx_attempts_quiz_id").on(t.quizId),
    byCompleted: index("idx_attempts_completed_at").on(t.completedAt),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Answers — per-question answers within an attempt.
// Composite primary key (attemptId, questionId).
// ─────────────────────────────────────────────────────────────────────────────
export const answers = sqliteTable(
  "answers",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userAnswer: text("user_answer", { mode: "json" }).$type<number | number[] | null>(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
    timeMs: integer("time_ms").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.attemptId, t.questionId] }),
    byAttempt: index("idx_answers_attempt_id").on(t.attemptId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Relations (for typed Drizzle queries like `db.query.quizzes.findFirst(...)`)
// ─────────────────────────────────────────────────────────────────────────────
export const documentsRelations = relations(documents, ({ many }) => ({
  quizzes: many(quizzes),
}));

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  document: one(documents, { fields: [quizzes.documentId], references: [documents.id] }),
  quizQuestions: many(quizQuestions),
  attempts: many(attempts),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  sourceDocument: one(documents, {
    fields: [questions.sourceDocumentId],
    references: [documents.id],
  }),
  parent: one(questions, {
    fields: [questions.parentQuestionId],
    references: [questions.id],
    relationName: "variation_lineage",
  }),
  variations: many(questions, { relationName: "variation_lineage" }),
  quizQuestions: many(quizQuestions),
  answers: many(answers),
}));

export const quizQuestionsRelations = relations(quizQuestions, ({ one }) => ({
  quiz: one(quizzes, { fields: [quizQuestions.quizId], references: [quizzes.id] }),
  question: one(questions, {
    fields: [quizQuestions.questionId],
    references: [questions.id],
  }),
}));

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  quiz: one(quizzes, { fields: [attempts.quizId], references: [quizzes.id] }),
  answers: many(answers),
}));

export const answersRelations = relations(answers, ({ one }) => ({
  attempt: one(attempts, { fields: [answers.attemptId], references: [attempts.id] }),
  question: one(questions, { fields: [answers.questionId], references: [questions.id] }),
}));

// Inferred types — the single source of truth for domain objects
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type NewQuizQuestion = typeof quizQuestions.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
