import { randomUUID } from "node:crypto";
import { db, sqlite } from "@/db/client";
import { quizzes, questions, quizQuestions } from "@/db/schema";
import { ensureTags } from "@/lib/tag-fallback";
import type { ParsedQuestion } from "@/lib/question-schema";
import type {
  ProviderConfig,
  QuestionSource,
  QuizSettings,
} from "@/types";

/**
 * Shared "assemble a quiz from a batch of generated questions" helper.
 *
 * Runs in a single SQLite transaction:
 *   1. Insert the quiz row
 *   2. Insert N rows into the global questions bank
 *   3. Insert N rows into the quiz_questions junction (ordered by idx)
 *
 * Used by:
 *   - /api/generate-quiz (document source)
 *   - /api/generate-from-topic (topic source)
 *   - (implicitly) the same route for lecture source (PPTX, via filename detection)
 *
 * Applies `ensureTags()` to every parsed question before insert, so even
 * questions the LLM left under-tagged get at least 2 tags in the DB.
 * Normalizes taxonomy to lowercase. Merges batch-level taxonomy defaults
 * where the LLM didn't provide its own.
 */

export interface InsertQuizOptions extends BatchSource {
  title: string;
  settings: QuizSettings;
  provider: ProviderConfig;
}

export interface InsertQuizResult {
  quizId: string;
  questionCount: number;
  questionIds: string[];
}

/** Taxonomy and provenance shared by every question of one batch. */
interface BatchSource {
  /** Owner of the questions (private bank). */
  userId: string;
  parsedQuestions: ParsedQuestion[];
  sourceType: QuestionSource;
  sourceDocumentId?: string | null;
  sourceLabel?: string | null;
  defaultSubject?: string | null;
  defaultLesson?: string | null;
  defaultTags?: string[];
}

/**
 * Bank rows for a batch: tag fallback, lowercase taxonomy, batch defaults
 * where the LLM gave none. `_idx` is the position within the batch.
 */
function buildQuestionRows(batch: BatchSource, now: string) {
  const {
    userId,
    parsedQuestions,
    sourceType,
    sourceDocumentId = null,
    sourceLabel = null,
    defaultSubject,
    defaultLesson,
    defaultTags = [],
  } = batch;

  const normalizedDefaultSubject =
    defaultSubject?.trim().toLowerCase() || null;
  const normalizedDefaultLesson =
    defaultLesson?.trim().toLowerCase() || null;
  const normalizedDefaultTags = defaultTags
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // Apply tag fallback + taxonomy merge to every question before insert.
  const enriched = parsedQuestions.map((q) => {
    const withTags = ensureTags(q, {
      subject: normalizedDefaultSubject,
      lesson: normalizedDefaultLesson,
      tags: normalizedDefaultTags,
    });
    return {
      ...withTags,
      subject: withTags.subject ?? normalizedDefaultSubject,
      lesson: withTags.lesson ?? normalizedDefaultLesson,
      topic: withTags.topic.trim().toLowerCase(),
    };
  });

  return enriched.map((q, idx) => ({
    id: randomUUID(),
    type: q.type,
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    difficulty: q.difficulty,
    bloomLevel: q.bloomLevel,
    subject: q.subject,
    lesson: q.lesson,
    topic: q.topic,
    tags: q.tags,
    sourcePassage: q.sourcePassage,
    sourceType,
    sourceDocumentId: sourceDocumentId ?? null,
    sourceLabel: sourceLabel ?? null,
    createdAt: now,
    userId,
    _idx: idx,
  }));
}

export function insertQuizAndQuestions(opts: InsertQuizOptions): InsertQuizResult {
  const { userId, title, settings, provider, parsedQuestions, sourceDocumentId = null } = opts;

  if (parsedQuestions.length === 0) {
    throw new Error("insertQuizAndQuestions: parsedQuestions is empty");
  }

  const quizId = randomUUID();
  const now = new Date().toISOString();
  const questionRows = buildQuestionRows(opts, now);

  const tx = sqlite.transaction(() => {
    db.insert(quizzes)
      .values({
        id: quizId,
        documentId: sourceDocumentId ?? null,
        title,
        settings,
        provider: provider.providerType,
        model: provider.defaultModel,
        createdAt: now,
        userId,
      })
      .run();

    db.insert(questions)
      .values(
        questionRows.map(({ _idx, ...rest }) => {
          void _idx;
          return rest;
        }),
      )
      .run();

    db.insert(quizQuestions)
      .values(
        questionRows.map((q) => ({
          quizId,
          questionId: q.id,
          idx: q._idx,
        })),
      )
      .run();
  });
  tx();

  return {
    quizId,
    questionCount: questionRows.length,
    questionIds: questionRows.map((q) => q.id),
  };
}

export interface AppendQuestionsOptions extends BatchSource {
  quizId: string;
}

/**
 * Add a further batch of generated questions to the end of an existing quiz
 * — how a topic run larger than one batch is assembled, one request per
 * batch, so no single request outlives the tunnel's response limit.
 *
 * Returns null when the quiz is not this user's (or is in the trash): a
 * foreign id behaves like a missing one.
 */
export function appendQuestionsToQuiz(opts: AppendQuestionsOptions): InsertQuizResult | null {
  const { userId, quizId, parsedQuestions } = opts;

  if (parsedQuestions.length === 0) {
    throw new Error("appendQuestionsToQuiz: parsedQuestions is empty");
  }

  const owned = sqlite
    .prepare("SELECT 1 FROM quizzes WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .get(quizId, userId);
  if (!owned) return null;

  const questionRows = buildQuestionRows(opts, new Date().toISOString());

  const tx = sqlite.transaction(() => {
    const { next } = sqlite
      .prepare("SELECT COALESCE(MAX(idx) + 1, 0) AS next FROM quiz_questions WHERE quiz_id = ?")
      .get(quizId) as { next: number };

    db.insert(questions)
      .values(
        questionRows.map(({ _idx, ...rest }) => {
          void _idx;
          return rest;
        }),
      )
      .run();

    db.insert(quizQuestions)
      .values(
        questionRows.map((q) => ({
          quizId,
          questionId: q.id,
          idx: next + q._idx,
        })),
      )
      .run();
  });
  tx();

  return {
    quizId,
    questionCount: questionRows.length,
    questionIds: questionRows.map((q) => q.id),
  };
}
