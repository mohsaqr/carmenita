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

export interface InsertQuizOptions {
  title: string;
  settings: QuizSettings;
  provider: ProviderConfig;
  parsedQuestions: ParsedQuestion[];
  sourceType: QuestionSource;
  sourceDocumentId?: string | null;
  sourceLabel?: string | null;
  defaultSubject?: string | null;
  defaultLesson?: string | null;
  defaultTags?: string[];
}

export interface InsertQuizResult {
  quizId: string;
  questionCount: number;
  questionIds: string[];
}

export function insertQuizAndQuestions(opts: InsertQuizOptions): InsertQuizResult {
  const {
    title,
    settings,
    provider,
    parsedQuestions,
    sourceType,
    sourceDocumentId = null,
    sourceLabel = null,
    defaultSubject,
    defaultLesson,
    defaultTags = [],
  } = opts;

  if (parsedQuestions.length === 0) {
    throw new Error("insertQuizAndQuestions: parsedQuestions is empty");
  }

  const quizId = randomUUID();
  const now = new Date().toISOString();

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

  const questionRows = enriched.map((q, idx) => ({
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
    userId: null,
    _idx: idx,
  }));

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
        userId: null,
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
