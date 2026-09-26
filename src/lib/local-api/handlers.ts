/**
 * Browser-side re-implementations of the HTTP /api/* routes used by
 * the client code. Each handler returns a plain JSON-serializable
 * object that the interceptor wraps in a `Response`.
 *
 * The handlers are intentionally thin: they run against the sql.js
 * Database from `./db.ts`, which mirrors the shipped `carmenita.db`
 * schema 1:1. SQL text is kept as close to the server routes as
 * possible so bugs here are easy to cross-reference with the real
 * implementation in `src/app/api/`.
 *
 * Scope: endpoints required to BROWSE, TAKE, REVIEW, IMPORT and
 * EXPORT quizzes. LLM-backed endpoints (generate-quiz, explain, retag,
 * variations) are not implemented — the static deploy has no API key
 * proxy and no server to run LLM calls.
 */
import { flushLocalDb, queryAll, queryOne, run } from "./db";
import { parseGift, serializeGift } from "@/lib/formats/gift";
import { parseAiken, serializeAiken } from "@/lib/formats/aiken";
import { parseMarkdown, serializeMarkdown } from "@/lib/formats/markdown";
import type { PortableQuestion } from "@/lib/formats/types";
import {
  isScoringMethod,
  resolveScoringMethod,
  scoreQuestion,
  SCORING_SETTING_KEY,
  STATIC_DEFAULT_SCORING,
  type QuestionType,
  type ScoringMethod,
} from "@/lib/scoring";

/** Static build: quiz override > this browser's Settings choice > right/wrong. */
function localScoring(quizSettings: unknown) {
  const override = (quizSettings as { scoringMethod?: unknown } | null)?.scoringMethod;
  const row = queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE user_id = 'local' AND key = ?`,
    [SCORING_SETTING_KEY],
  );
  const accountDefault = row ? jsonParse<unknown>(row.value, null) : null;
  return {
    method: resolveScoringMethod(override, accountDefault, STATIC_DEFAULT_SCORING),
    override: isScoringMethod(override) ? override : null,
    accountDefault: resolveScoringMethod(null, accountDefault, STATIC_DEFAULT_SCORING),
  };
}

// ── Generic helpers ─────────────────────────────────────────────────────

function uuid(): string {
  // crypto.randomUUID is available in all evergreen browsers.
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function jsonParse<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── /api/quizzes ────────────────────────────────────────────────────────

export function listQuizzes() {
  const rows = queryAll<{
    id: string;
    title: string;
    document_id: string | null;
    document_filename: string | null;
    provider: string;
    model: string;
    created_at: string;
    settings: string;
    question_count: number;
    attempt_count: number;
    best_score: number | null;
    last_attempt_at: string | null;
  }>(
    `SELECT
       q.id,
       q.title,
       q.document_id,
       d.filename AS document_filename,
       q.provider,
       q.model,
       q.created_at,
       q.settings,
       (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) AS question_count,
       (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS attempt_count,
       (SELECT MAX(score) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS best_score,
       (SELECT MAX(completed_at) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS last_attempt_at
     FROM quizzes q
     LEFT JOIN documents d ON d.id = q.document_id
     WHERE q.deleted_at IS NULL
     ORDER BY q.created_at DESC`,
  );

  return {
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      documentId: r.document_id,
      documentFilename: r.document_filename,
      provider: r.provider,
      model: r.model,
      createdAt: r.created_at,
      settings: jsonParse(r.settings, {}),
      questionCount: r.question_count,
      attemptCount: r.attempt_count,
      bestScore: r.best_score,
      lastAttemptAt: r.last_attempt_at,
    })),
  };
}

// ── /api/quizzes/[id] ───────────────────────────────────────────────────

export function getQuiz(id: string) {
  const quiz = queryOne<Record<string, unknown>>(
    `SELECT * FROM quizzes WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!quiz) {
    return { status: 404, body: { error: "Quiz not found" } };
  }

  const rows = queryAll<Record<string, unknown>>(
    `SELECT
       q.id, q.type, q.question, q.options, q.correct_answer, q.explanation,
       q.difficulty, q.bloom_level, q.subject, q.lesson, q.topic, q.tags,
       q.source_passage, q.source_type, q.source_document_id, q.source_label,
       q.notes, q.created_at, q.user_id,
       qq.idx
     FROM quiz_questions qq
     INNER JOIN questions q ON q.id = qq.question_id
     WHERE qq.quiz_id = ?
     ORDER BY qq.idx ASC`,
    [id],
  );

  const quizSettings = jsonParse<Record<string, unknown>>(quiz.settings, {});
  return {
    body: {
      scoring: localScoring(quizSettings),
      quiz: {
        ...quiz,
        settings: quizSettings,
        documentId: quiz.document_id,
        createdAt: quiz.created_at,
        deletedAt: quiz.deleted_at,
        userId: quiz.user_id,
      },
      questions: rows.map((r) => ({
        id: r.id,
        type: r.type,
        question: r.question,
        options: jsonParse<string[]>(r.options, []),
        correctAnswer: jsonParse<number | number[]>(r.correct_answer, 0),
        explanation: r.explanation,
        difficulty: r.difficulty,
        bloomLevel: r.bloom_level,
        subject: r.subject,
        lesson: r.lesson,
        topic: r.topic,
        tags: jsonParse<string[]>(r.tags, []),
        sourcePassage: r.source_passage,
        sourceType: r.source_type,
        sourceDocumentId: r.source_document_id,
        sourceLabel: r.source_label,
        notes: r.notes,
        createdAt: r.created_at,
        userId: r.user_id,
        idx: r.idx,
      })),
    },
  };
}

// ── DELETE /api/quizzes/[id] (soft delete) ──────────────────────────────

export async function softDeleteQuiz(id: string) {
  const changes = run(
    `UPDATE quizzes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [nowIso(), id],
  );
  if (changes === 0) {
    return { status: 404, body: { error: "Quiz not found" } };
  }
  await flushLocalDb();
  return { body: { trashed: id, deletedAt: nowIso() } };
}

// ── /api/attempts ──────────────────────────────────────────────────────

export function listAttempts() {
  const rows = queryAll<{
    id: string;
    quiz_id: string;
    quiz_title: string;
    started_at: string;
    completed_at: string | null;
    score: number | null;
    question_count: number;
  }>(
    `SELECT
       a.id, a.quiz_id, q.title AS quiz_title,
       a.started_at, a.completed_at, a.score,
       (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = a.quiz_id) AS question_count
     FROM attempts a
     INNER JOIN quizzes q ON q.id = a.quiz_id
     WHERE q.deleted_at IS NULL
     ORDER BY a.started_at DESC`,
  );
  return {
    attempts: rows.map((r) => ({
      id: r.id,
      quizId: r.quiz_id,
      quizTitle: r.quiz_title,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      score: r.score,
      questionCount: r.question_count,
    })),
  };
}

export async function createAttempt(body: { quizId: string }) {
  if (!body?.quizId) {
    return { status: 400, body: { error: "quizId required" } };
  }
  const quiz = queryOne(
    `SELECT id FROM quizzes WHERE id = ? AND deleted_at IS NULL`,
    [body.quizId],
  );
  if (!quiz) {
    return { status: 404, body: { error: "Quiz not found" } };
  }
  const id = uuid();
  const startedAt = nowIso();
  run(
    `INSERT INTO attempts (id, quiz_id, started_at, completed_at, score, user_id) VALUES (?, ?, ?, NULL, NULL, NULL)`,
    [id, body.quizId, startedAt],
  );
  await flushLocalDb();
  return { body: { id, quizId: body.quizId, startedAt } };
}

export function getAttempt(id: string) {
  const attempt = queryOne<{
    id: string;
    quiz_id: string;
    started_at: string;
    completed_at: string | null;
    score: number | null;
    scoring_method: string | null;
  }>(`SELECT * FROM attempts WHERE id = ?`, [id]);
  if (!attempt) {
    return { status: 404, body: { error: "Attempt not found" } };
  }
  const questionRows = queryAll<Record<string, unknown>>(
    `SELECT
       q.id, q.type, q.question, q.options, q.correct_answer, q.explanation,
       q.difficulty, q.bloom_level, q.topic, q.source_passage, q.source_type,
       q.source_document_id, q.source_label, q.notes, q.created_at, q.user_id,
       qq.idx
     FROM quiz_questions qq
     INNER JOIN questions q ON q.id = qq.question_id
     WHERE qq.quiz_id = ?
     ORDER BY qq.idx ASC`,
    [attempt.quiz_id],
  );
  const answerRows = queryAll<{
    question_id: string;
    user_answer: string | null;
    is_correct: number;
    points: number | null;
    time_ms: number;
  }>(
    `SELECT question_id, user_answer, is_correct, points, time_ms FROM answers WHERE attempt_id = ?`,
    [id],
  );
  const answerMap = new Map(answerRows.map((a) => [a.question_id, a]));
  return {
    body: {
      attempt: {
        id: attempt.id,
        quizId: attempt.quiz_id,
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
        score: attempt.score,
        scoringMethod: attempt.scoring_method ?? null,
      },
      questions: questionRows.map((q) => {
        const a = answerMap.get(q.id as string);
        return {
          id: q.id,
          type: q.type,
          question: q.question,
          options: jsonParse<string[]>(q.options, []),
          correctAnswer: jsonParse<number | number[]>(q.correct_answer, 0),
          explanation: q.explanation,
          difficulty: q.difficulty,
          bloomLevel: q.bloom_level,
          topic: q.topic,
          sourcePassage: q.source_passage,
          sourceType: q.source_type,
          sourceDocumentId: q.source_document_id,
          sourceLabel: q.source_label,
          notes: q.notes,
          createdAt: q.created_at,
          userId: q.user_id,
          idx: q.idx,
          answer: a
            ? {
                attemptId: id,
                questionId: a.question_id,
                userAnswer: jsonParse<number | number[] | null>(a.user_answer, null),
                isCorrect: a.is_correct === 1,
                points: a.points ?? null,
                timeMs: a.time_ms,
              }
            : null,
        };
      }),
    },
  };
}

type SubmittedAnswer = {
  questionId: string;
  userAnswer: number | number[] | null;
  timeMs: number;
};

export async function submitAttempt(
  id: string,
  body: { answers: SubmittedAnswer[] },
) {
  const attempt = queryOne<{
    id: string;
    quiz_id: string;
    completed_at: string | null;
  }>(`SELECT id, quiz_id, completed_at FROM attempts WHERE id = ?`, [id]);
  if (!attempt) return { status: 404, body: { error: "Attempt not found" } };
  if (attempt.completed_at) {
    return { status: 409, body: { error: "Attempt is already submitted" } };
  }

  const quizRow = queryOne<{ settings: string }>(`SELECT settings FROM quizzes WHERE id = ?`, [attempt.quiz_id]);
  const scoringMethod: ScoringMethod = localScoring(jsonParse(quizRow?.settings, {})).method;

  const qRows = queryAll<{ id: string; type: string; options: string; correct_answer: string }>(
    `SELECT q.id, q.type, q.options, q.correct_answer
     FROM quiz_questions qq
     INNER JOIN questions q ON q.id = qq.question_id
     WHERE qq.quiz_id = ?`,
    [attempt.quiz_id],
  );
  const qMap = new Map(
    qRows.map((q) => [
      q.id,
      {
        type: q.type as QuestionType,
        optionCount: jsonParse<string[]>(q.options, []).length,
        correct: jsonParse<number | number[]>(q.correct_answer, 0),
      },
    ]),
  );

  const scored = body.answers.map((a) => {
    const q = qMap.get(a.questionId);
    const points = q ? scoreQuestion(scoringMethod, q.type, q.correct, a.userAnswer, q.optionCount) : 0;
    return { ...a, points, isCorrect: points === 1 };
  });
  const total = qRows.length;
  const correct = scored.filter((a) => a.isCorrect).length;
  const earned = scored.reduce((sum, a) => sum + a.points, 0);
  const score = total > 0 ? earned / total : 0;
  const completedAt = nowIso();

  // Insert all answers + finalize attempt. sql.js has no explicit
  // transaction helper; wrap the batch in BEGIN/COMMIT manually.
  run("BEGIN");
  try {
    for (const a of scored) {
      run(
        `INSERT OR REPLACE INTO answers (attempt_id, question_id, user_answer, is_correct, points, time_ms) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          a.questionId,
          a.userAnswer == null ? null : JSON.stringify(a.userAnswer),
          a.isCorrect ? 1 : 0,
          a.points,
          a.timeMs,
        ],
      );
    }
    run(`UPDATE attempts SET completed_at = ?, score = ?, scoring_method = ? WHERE id = ?`, [
      completedAt,
      score,
      scoringMethod,
      id,
    ]);
    run("COMMIT");
  } catch (err) {
    run("ROLLBACK");
    throw err;
  }
  await flushLocalDb();

  return {
    body: {
      attemptId: id,
      score,
      correct,
      total,
      scoringMethod,
      pointsEarned: Math.round(earned * 100) / 10,
      maxPoints: total * 10,
      completedAt,
      answers: scored.map((a) => ({
        attemptId: id,
        questionId: a.questionId,
        userAnswer: a.userAnswer,
        isCorrect: a.isCorrect,
        points: a.points,
        timeMs: a.timeMs,
      })),
    },
  };
}

// ── /api/bank/taxonomy ──────────────────────────────────────────────────

export function getTaxonomy() {
  const subjects = queryAll<{ subject: string }>(
    `SELECT DISTINCT subject FROM questions WHERE subject IS NOT NULL AND subject != '' ORDER BY subject`,
  ).map((r) => r.subject);
  const lessons = queryAll<{ lesson: string }>(
    `SELECT DISTINCT lesson FROM questions WHERE lesson IS NOT NULL AND lesson != '' ORDER BY lesson`,
  ).map((r) => r.lesson);
  const topics = queryAll<{ topic: string }>(
    `SELECT DISTINCT topic FROM questions WHERE topic IS NOT NULL AND topic != '' ORDER BY topic`,
  ).map((r) => r.topic);
  const tags = queryAll<{ value: string }>(
    `SELECT DISTINCT value FROM questions, json_each(questions.tags) ORDER BY value`,
  ).map((r) => r.value);
  return { subjects, lessons, topics, tags };
}

// ── /api/bank/questions ─────────────────────────────────────────────────

export function listBankQuestions(url: URL) {
  const sp = url.searchParams;
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  const push = (clause: string, ...p: Array<string | number | null>) => {
    where.push(clause);
    params.push(...p);
  };
  if (sp.get("topic")) push("topic = ?", sp.get("topic"));
  if (sp.get("subject")) push("subject = ?", sp.get("subject"));
  if (sp.get("lesson")) push("lesson = ?", sp.get("lesson"));
  if (sp.get("difficulty")) push("difficulty = ?", sp.get("difficulty"));
  if (sp.get("bloomLevel")) push("bloom_level = ?", sp.get("bloomLevel"));
  if (sp.get("sourceType")) push("source_type = ?", sp.get("sourceType"));
  if (sp.get("tag")) {
    const t = (sp.get("tag") || "").replace(/"/g, '\\"');
    push(`tags LIKE ?`, `%"${t}"%`);
  }
  if (sp.get("setId")) push("set_id = ?", sp.get("setId"));
  if (sp.get("folder")) {
    push("set_id IN (SELECT id FROM question_sets WHERE folder = ?)", sp.get("folder"));
  }
  const idsCsv = sp.get("ids");
  if (idsCsv) {
    const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }
  const limit = Math.min(parseInt(sp.get("limit") || "500", 10) || 500, 2000);

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM questions ${whereSql} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit],
  );

  return {
    questions: rows.map((r) => ({
      id: r.id,
      type: r.type,
      question: r.question,
      options: jsonParse<string[]>(r.options, []),
      correctAnswer: jsonParse<number | number[]>(r.correct_answer, 0),
      explanation: r.explanation,
      difficulty: r.difficulty,
      bloomLevel: r.bloom_level,
      subject: r.subject,
      lesson: r.lesson,
      topic: r.topic,
      tags: jsonParse<string[]>(r.tags, []),
      sourcePassage: r.source_passage,
      sourceType: r.source_type,
      sourceDocumentId: r.source_document_id,
      sourceLabel: r.source_label,
      setId: r.set_id ?? null,
      notes: r.notes,
      parentQuestionId: r.parent_question_id,
      variationType: r.variation_type,
      createdAt: r.created_at,
      userId: r.user_id,
    })),
    total: rows.length,
  };
}

// ── PATCH /api/bank/questions/[id] (notes) ──────────────────────────────

export async function updateQuestion(id: string, body: { notes?: string | null }) {
  if (body.notes !== undefined) {
    const normalized = body.notes == null || body.notes === "" ? null : body.notes;
    const changes = run(`UPDATE questions SET notes = ? WHERE id = ?`, [
      normalized,
      id,
    ]);
    if (changes === 0) {
      return { status: 404, body: { error: "Question not found" } };
    }
    await flushLocalDb();
  }
  return { body: { id, updated: 1 } };
}

// ── POST /api/bank/quick-quiz ───────────────────────────────────────────

export async function quickQuiz(body: {
  title?: string;
  count: number;
  candidateIds?: string[];
  shuffle?: boolean;
}) {
  let pool: string[] = [];
  if (body.candidateIds && body.candidateIds.length > 0) {
    const placeholders = body.candidateIds.map(() => "?").join(",");
    const rows = queryAll<{ id: string }>(
      `SELECT id FROM questions WHERE id IN (${placeholders})`,
      body.candidateIds,
    );
    pool = rows.map((r) => r.id);
  }
  if (pool.length === 0) {
    return {
      status: 404,
      body: { error: "No questions match the requested criteria." },
    };
  }

  const working = [...pool];
  if (body.shuffle !== false) {
    for (let i = working.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [working[i], working[j]] = [working[j], working[i]];
    }
  }
  const chosen = working.slice(0, Math.min(body.count, working.length));

  const quizId = uuid();
  const now = nowIso();
  const title = body.title || `Quick exam (${chosen.length} Qs)`;
  const settings = JSON.stringify({
    questionCount: chosen.length,
    allowedTypes: ["mcq-single", "mcq-multi", "true-false"],
    immediateFeedback: true,
  });

  run("BEGIN");
  try {
    run(
      `INSERT INTO quizzes (id, document_id, title, settings, provider, model, created_at, deleted_at, user_id)
       VALUES (?, NULL, ?, ?, 'bank', 'bank', ?, NULL, NULL)`,
      [quizId, title, settings, now],
    );
    chosen.forEach((questionId, idx) => {
      run(
        `INSERT INTO quiz_questions (quiz_id, question_id, idx) VALUES (?, ?, ?)`,
        [quizId, questionId, idx],
      );
    });
    run("COMMIT");
  } catch (err) {
    run("ROLLBACK");
    throw err;
  }
  await flushLocalDb();

  return {
    body: { quizId, questionCount: chosen.length, poolSize: pool.length },
  };
}

// ── /api/analytics ────────────────────────────────────────────────────

export function analyticsOverview() {
  const [row] = queryAll<{
    quiz_count: number;
    attempt_count: number;
    document_count: number;
    avg_score: number | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM quizzes WHERE deleted_at IS NULL) AS quiz_count,
       (SELECT COUNT(*) FROM attempts WHERE completed_at IS NOT NULL) AS attempt_count,
       (SELECT COUNT(*) FROM documents) AS document_count,
       (SELECT AVG(score) FROM attempts WHERE completed_at IS NOT NULL) AS avg_score`,
  );
  return {
    quizCount: row?.quiz_count ?? 0,
    attemptCount: row?.attempt_count ?? 0,
    documentCount: row?.document_count ?? 0,
    avgScore: row?.avg_score ?? null,
  };
}

export function analyticsTopics() {
  return queryAll<{ topic: string; total: number; correct: number; rate: number }>(
    `SELECT q.topic, COUNT(*) AS total,
       SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
       AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     JOIN attempts at ON at.id = a.attempt_id
     WHERE at.completed_at IS NOT NULL
     GROUP BY q.topic ORDER BY rate ASC`,
  );
}

export function analyticsDifficulty() {
  return queryAll<{ difficulty: string; total: number; correct: number; rate: number }>(
    `SELECT q.difficulty, COUNT(*) AS total,
       SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
       AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     JOIN attempts at ON at.id = a.attempt_id
     WHERE at.completed_at IS NOT NULL
     GROUP BY q.difficulty
     ORDER BY CASE q.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 END`,
  );
}

export function analyticsBloom() {
  const rows = queryAll<{ bloom_level: string; total: number; correct: number; rate: number }>(
    `SELECT q.bloom_level, COUNT(*) AS total,
       SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct,
       AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     JOIN attempts at ON at.id = a.attempt_id
     WHERE at.completed_at IS NOT NULL
     GROUP BY q.bloom_level
     ORDER BY CASE q.bloom_level
       WHEN 'remember' THEN 1 WHEN 'understand' THEN 2 WHEN 'apply' THEN 3
       WHEN 'analyze' THEN 4 WHEN 'evaluate' THEN 5 WHEN 'create' THEN 6 END`,
  );
  return rows.map((r) => ({ bloomLevel: r.bloom_level, total: r.total, correct: r.correct, rate: r.rate }));
}

export function analyticsSlowest(limit = 10) {
  const rows = queryAll<{ id: string; question: string; avg_ms: number; answered: number }>(
    `SELECT q.id, q.question, AVG(a.time_ms) AS avg_ms, COUNT(*) AS answered
     FROM answers a JOIN questions q ON q.id = a.question_id
     GROUP BY q.id HAVING answered > 0
     ORDER BY avg_ms DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ questionId: r.id, question: r.question, avgMs: r.avg_ms, answered: r.answered }));
}

export function analyticsImprovement(quizId: string) {
  return queryAll<{ trial: number; completed_at: string; score: number }>(
    `SELECT ROW_NUMBER() OVER (ORDER BY completed_at ASC) AS trial,
       completed_at, score
     FROM attempts
     WHERE quiz_id = ? AND completed_at IS NOT NULL AND score IS NOT NULL
     ORDER BY completed_at ASC`,
    [quizId],
  ).map((r) => ({ trial: r.trial, completedAt: r.completed_at, score: r.score }));
}

// ── /api/analytics/needs-review ────────────────────────────────────────

export function needsReview(limit = 50) {
  const rows = queryAll<{
    id: string;
    question: string;
    topic: string;
    difficulty: string;
    answered: number;
    wrong: number;
    rate: number;
  }>(
    `SELECT
       q.id, q.question, q.topic, q.difficulty,
       COUNT(*) AS answered,
       SUM(CASE WHEN a.is_correct THEN 0 ELSE 1 END) AS wrong,
       AVG(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS rate
     FROM answers a
     JOIN questions q  ON q.id  = a.question_id
     JOIN attempts  at ON at.id = a.attempt_id
     WHERE at.completed_at IS NOT NULL
     GROUP BY q.id
     HAVING wrong > 0
     ORDER BY rate ASC, wrong DESC
     LIMIT ?`,
    [limit],
  );

  return rows.map((r) => ({
    questionId: r.id,
    question: r.question,
    topic: r.topic,
    difficulty: r.difficulty,
    answered: r.answered,
    wrong: r.wrong,
    rate: r.rate,
  }));
}

// ── /api/trash ──────────────────────────────────────────────────────────

export function listTrash() {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT
       q.id, q.title, q.document_id, d.filename AS document_filename,
       q.provider, q.model, q.created_at, q.deleted_at, q.settings,
       (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) AS question_count,
       (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS attempt_count,
       (SELECT MAX(score) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS best_score,
       (SELECT MAX(completed_at) FROM attempts WHERE quiz_id = q.id AND completed_at IS NOT NULL) AS last_attempt_at
     FROM quizzes q
     LEFT JOIN documents d ON d.id = q.document_id
     WHERE q.deleted_at IS NOT NULL
     ORDER BY q.deleted_at DESC`,
  );
  return {
    quizzes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      documentId: r.document_id,
      documentFilename: r.document_filename,
      provider: r.provider,
      model: r.model,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
      settings: jsonParse(r.settings, {}),
      questionCount: r.question_count,
      attemptCount: r.attempt_count,
      bestScore: r.best_score,
      lastAttemptAt: r.last_attempt_at,
    })),
  };
}

export async function restoreTrash(id: string) {
  const changes = run(
    `UPDATE quizzes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
    [id],
  );
  if (changes === 0) {
    return { status: 404, body: { error: "Trashed quiz not found" } };
  }
  await flushLocalDb();
  return { body: { restored: id } };
}

export async function permanentDeleteTrash(id: string) {
  const changes = run(
    `DELETE FROM quizzes WHERE id = ? AND deleted_at IS NOT NULL`,
    [id],
  );
  if (changes === 0) {
    return { status: 404, body: { error: "Trashed quiz not found" } };
  }
  await flushLocalDb();
  return { body: { deleted: id } };
}

// ── POST /api/bank/import ──────────────────────────────────────────────

export async function importBank(body: {
  format: string;
  text: string;
  setName?: string;
  folder?: string | null;
}) {
  const { format, text } = body;
  const setName = (body.setName ?? "").trim();
  if (!setName) {
    return { status: 400, body: { error: "Give this set a name" } };
  }
  if (format !== "gift" && format !== "aiken" && format !== "markdown") {
    return {
      status: 400,
      body: { error: "format must be 'gift', 'aiken', or 'markdown'" },
    };
  }
  if (!text || typeof text !== "string") {
    return { status: 400, body: { error: "text is required" } };
  }

  const result =
    format === "gift"
      ? parseGift(text)
      : format === "aiken"
        ? parseAiken(text)
        : parseMarkdown(text);

  if (result.questions.length === 0) {
    return {
      status: 400,
      body: { error: "No valid questions found in the provided text.", warnings: result.warnings },
    };
  }

  const baseTime = Date.now();
  const total = result.questions.length;
  const sourceType =
    format === "gift"
      ? "gift-import"
      : format === "aiken"
        ? "aiken-import"
        : "markdown-import";

  const ids: string[] = [];
  let set: { id: string; created: boolean };
  run("BEGIN");
  try {
    set = findOrCreateLocalSet(setName, body.folder);
    result.questions.forEach((q, i) => {
      const id = uuid();
      ids.push(id);
      // Offset createdAt by 1ms per question so DESC order = file order
      const createdAt = new Date(baseTime + (total - 1 - i)).toISOString();
      run(
        `INSERT INTO questions
           (id, type, question, options, correct_answer, explanation,
            difficulty, bloom_level, subject, lesson, topic, tags,
            source_passage, source_type, source_document_id, source_label,
            set_id, notes, parent_question_id, variation_type, created_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, NULL)`,
        [
          id,
          q.type,
          q.question,
          JSON.stringify(q.options),
          JSON.stringify(q.correctAnswer),
          q.explanation,
          q.difficulty,
          q.bloomLevel,
          q.subject,
          q.lesson,
          q.topic.trim().toLowerCase(),
          JSON.stringify(q.tags),
          q.sourcePassage,
          sourceType,
          setName,
          set.id,
          createdAt,
        ],
      );
    });
    run("COMMIT");
  } catch (err) {
    run("ROLLBACK");
    throw err;
  }
  await flushLocalDb();

  return {
    body: {
      imported: ids.length,
      warnings: result.warnings,
      ids,
      setId: set.id,
      setCreated: set.created,
    },
  };
}

// ── GET /api/bank/export ───────────────────────────────────────────────

export function exportBank(url: URL) {
  const sp = url.searchParams;
  const format = sp.get("format");
  if (format !== "gift" && format !== "aiken" && format !== "markdown") {
    return {
      status: 400,
      body: { error: "format must be 'gift', 'aiken', or 'markdown'" },
    };
  }

  // Build WHERE clause using the same filter pattern as listBankQuestions.
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  const push = (clause: string, ...p: Array<string | number | null>) => {
    where.push(clause);
    params.push(...p);
  };
  if (sp.get("topic")) push("topic = ?", sp.get("topic"));
  if (sp.get("subject")) push("subject = ?", sp.get("subject"));
  if (sp.get("lesson")) push("lesson = ?", sp.get("lesson"));
  if (sp.get("difficulty")) push("difficulty = ?", sp.get("difficulty"));
  if (sp.get("bloomLevel")) push("bloom_level = ?", sp.get("bloomLevel"));
  if (sp.get("sourceType")) push("source_type = ?", sp.get("sourceType"));
  if (sp.get("tag")) {
    const t = (sp.get("tag") || "").replace(/"/g, '\\"');
    push(`tags LIKE ?`, `%"${t}"%`);
  }
  const idsCsv = sp.get("ids");
  if (idsCsv) {
    const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM questions ${whereSql} ORDER BY created_at DESC`,
    params,
  );

  if (rows.length === 0) {
    return { status: 404, body: { error: "No questions match the given filters" } };
  }

  const portable: PortableQuestion[] = rows.map((r) => ({
    type: r.type as PortableQuestion["type"],
    question: r.question as string,
    options: jsonParse<string[]>(r.options, []),
    correctAnswer: jsonParse<number | number[]>(r.correct_answer, 0),
    explanation: (r.explanation ?? "") as string,
    difficulty: r.difficulty as PortableQuestion["difficulty"],
    bloomLevel: r.bloom_level as PortableQuestion["bloomLevel"],
    subject: (r.subject as string) ?? null,
    lesson: (r.lesson as string) ?? null,
    topic: (r.topic ?? "imported") as string,
    tags: jsonParse<string[]>(r.tags, []),
    sourcePassage: (r.source_passage ?? "") as string,
  }));

  const category = sp.get("topic") || undefined;
  let text: string;
  let skippedHeader = "0";
  if (format === "gift") {
    text = serializeGift(portable, { category, includeMetadataComments: true });
  } else if (format === "markdown") {
    text = serializeMarkdown(portable);
  } else {
    const result = serializeAiken(portable);
    text = result.text;
    if (result.skipped.length > 0) {
      skippedHeader = result.skipped
        .map((s: { index: number; reason: string }) => `${s.index}:${s.reason}`)
        .join("; ");
    }
  }

  const extension =
    format === "gift"
      ? "gift.txt"
      : format === "markdown"
        ? "md"
        : "aiken.txt";

  // Return as a special shape that the interceptor handles as a
  // text/plain download rather than wrapping in JSON.
  return {
    __download: true as const,
    text,
    filename: `carmenita-bank.${extension}`,
    skipped: skippedHeader,
    exported: rows.length,
  };
}

// ── Question deletion (single + bulk) ───────────────────────────────────
//
// sql.js copies may not have foreign_keys enabled, so child rows
// (answers, quiz links) are removed explicitly rather than relying on
// ON DELETE CASCADE as the server build does.

function deleteQuestionRows(ids: string[]): number {
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(",");
  run(`DELETE FROM answers WHERE question_id IN (${marks})`, ids);
  run(`DELETE FROM quiz_questions WHERE question_id IN (${marks})`, ids);
  run(`UPDATE questions SET parent_question_id = NULL WHERE parent_question_id IN (${marks})`, ids);
  return run(`DELETE FROM questions WHERE id IN (${marks})`, ids);
}

function inTransaction<T>(fn: () => T): T {
  run("BEGIN");
  try {
    const out = fn();
    run("COMMIT");
    return out;
  } catch (err) {
    run("ROLLBACK");
    throw err;
  }
}

export async function deleteQuestion(id: string) {
  const deleted = inTransaction(() => deleteQuestionRows([id]));
  if (deleted === 0) return { status: 404, body: { error: "Question not found" } };
  await flushLocalDb();
  return { body: { deleted: id } };
}

export async function bulkDeleteQuestions(body: { ids?: unknown }) {
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return { status: 400, body: { error: "ids must be a non-empty array" } };
  const deleted = inTransaction(() => deleteQuestionRows(ids));
  await flushLocalDb();
  return { body: { deleted, requested: ids.length } };
}

// ── /api/bank/sets ──────────────────────────────────────────────────────

function normalizeFolder(folder: unknown): string | null {
  const f = typeof folder === "string" ? folder.trim() : "";
  return f ? f : null;
}

function findOrCreateLocalSet(name: string, folder: unknown): { id: string; created: boolean } {
  const f = normalizeFolder(folder);
  const existing = queryOne<{ id: string }>(
    f === null
      ? `SELECT id FROM question_sets WHERE lower(name) = lower(?) AND folder IS NULL`
      : `SELECT id FROM question_sets WHERE lower(name) = lower(?) AND lower(folder) = lower(?)`,
    f === null ? [name] : [name, f],
  );
  if (existing) return { id: existing.id, created: false };
  const id = uuid();
  run(
    `INSERT INTO question_sets (id, name, folder, created_at, user_id) VALUES (?, ?, ?, ?, NULL)`,
    [id, name, f, nowIso()],
  );
  return { id, created: true };
}

export function listSets() {
  const rows = queryAll<Record<string, unknown>>(
    `SELECT s.id, s.name, s.folder, s.received_from, s.created_at, COUNT(q.id) AS n
       FROM question_sets s LEFT JOIN questions q ON q.set_id = s.id
      GROUP BY s.id
      ORDER BY s.folder IS NULL, lower(s.folder), lower(s.name), s.created_at`,
  );
  return {
    sets: rows.map((r) => ({
      id: r.id,
      name: r.name,
      folder: r.folder ?? null,
      receivedFrom: r.received_from ?? null,
      createdAt: r.created_at,
      questionCount: Number(r.n),
    })),
  };
}

export async function updateSet(id: string, body: { name?: unknown; folder?: unknown }) {
  const sets: string[] = [];
  const params: Array<string | null> = [];
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { status: 400, body: { error: "Set name must not be empty" } };
    sets.push("name = ?");
    params.push(name);
  }
  if (body.folder !== undefined) {
    sets.push("folder = ?");
    params.push(normalizeFolder(body.folder));
  }
  if (sets.length === 0) return { status: 400, body: { error: "Provide name and/or folder" } };
  const changes = run(`UPDATE question_sets SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  if (changes === 0) return { status: 404, body: { error: "Set not found" } };
  if (typeof body.name === "string") {
    run(`UPDATE questions SET source_label = ? WHERE set_id = ?`, [body.name.trim(), id]);
  }
  await flushLocalDb();
  const set = listSets().sets.find((x) => x.id === id);
  return { body: { set } };
}

export async function deleteSet(id: string) {
  const result = inTransaction(() => {
    const ids = queryAll<{ id: string }>(`SELECT id FROM questions WHERE set_id = ?`, [id]).map((r) => r.id);
    const questionsDeleted = deleteQuestionRows(ids);
    const setsDeleted = run(`DELETE FROM question_sets WHERE id = ?`, [id]);
    return { questionsDeleted, setsDeleted };
  });
  if (result.setsDeleted === 0) return { status: 404, body: { error: "Set not found" } };
  await flushLocalDb();
  return { body: { deleted: id, questionsDeleted: result.questionsDeleted } };
}

// ── /api/settings ───────────────────────────────────────────────────────
//
// The static build has no accounts; everything is stored under one
// local user id in this browser's sql.js DB.

const LOCAL_USER = "local";

export function getSettingValue(key: string) {
  const row = queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE user_id = ? AND key = ?`,
    [LOCAL_USER, key],
  );
  return { body: { value: row ? jsonParse<unknown>(row.value, null) : null } };
}

export async function putSettingValue(key: string, body: { value?: unknown }) {
  if (body.value === undefined || body.value === null) {
    return { status: 400, body: { error: "Use DELETE to clear a setting" } };
  }
  if (key === SCORING_SETTING_KEY && !isScoringMethod(body.value)) {
    return { status: 400, body: { error: "Unknown scoring method" } };
  }
  run(
    `INSERT INTO app_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [LOCAL_USER, key, JSON.stringify(body.value), nowIso()],
  );
  const rescored = key === SCORING_SETTING_KEY ? localRescore() : undefined;
  await flushLocalDb();
  return { body: { ok: true, ...(rescored !== undefined ? { rescored } : {}) } };
}

export async function deleteSettingValue(key: string) {
  run(`DELETE FROM app_settings WHERE user_id = ? AND key = ?`, [LOCAL_USER, key]);
  const rescored = key === SCORING_SETTING_KEY ? localRescore() : undefined;
  await flushLocalDb();
  return { body: { ok: true, ...(rescored !== undefined ? { rescored } : {}) } };
}

/**
 * Static-build twin of src/lib/rescore.ts: re-score finished attempts
 * (optionally one quiz's) with the method now in effect. Returns the
 * number of attempts re-scored.
 */
function localRescore(quizId?: string): number {
  const rows = queryAll<{ id: string; quiz_id: string; settings: string }>(
    `SELECT a.id, a.quiz_id, z.settings FROM attempts a JOIN quizzes z ON z.id = a.quiz_id
     WHERE a.completed_at IS NOT NULL ${quizId ? "AND a.quiz_id = ?" : ""}`,
    quizId ? [quizId] : [],
  );
  if (rows.length === 0) return 0;
  run("BEGIN");
  try {
    rows.forEach((attempt) => {
      const method = localScoring(jsonParse(attempt.settings, {})).method;
      const qs = new Map(
        queryAll<{ id: string; type: string; options: string; correct_answer: string }>(
          `SELECT q.id, q.type, q.options, q.correct_answer FROM quiz_questions qq
           JOIN questions q ON q.id = qq.question_id WHERE qq.quiz_id = ?`,
          [attempt.quiz_id],
        ).map((q) => [q.id, q]),
      );
      const given = queryAll<{ question_id: string; user_answer: string | null }>(
        `SELECT question_id, user_answer FROM answers WHERE attempt_id = ?`,
        [attempt.id],
      );
      const earned = given.reduce((sum, a) => {
        const q = qs.get(a.question_id);
        const points = q
          ? scoreQuestion(
              method,
              q.type as QuestionType,
              jsonParse<number | number[]>(q.correct_answer, 0),
              jsonParse<number | number[] | null>(a.user_answer, null),
              jsonParse<string[]>(q.options, []).length,
            )
          : 0;
        run(`UPDATE answers SET points = ?, is_correct = ? WHERE attempt_id = ? AND question_id = ?`, [
          points,
          points === 1 ? 1 : 0,
          attempt.id,
          a.question_id,
        ]);
        return sum + points;
      }, 0);
      run(`UPDATE attempts SET score = ?, scoring_method = ? WHERE id = ?`, [
        qs.size > 0 ? earned / qs.size : 0,
        method,
        attempt.id,
      ]);
    });
    run("COMMIT");
  } catch (err) {
    run("ROLLBACK");
    throw err;
  }
  return rows.length;
}

// ── PATCH /api/quizzes/[id] (scoring override) ──────────────────────────

export async function updateQuizScoring(id: string, body: { scoringMethod?: unknown }) {
  const quiz = queryOne<{ settings: string }>(
    `SELECT settings FROM quizzes WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!quiz) return { status: 404, body: { error: "Quiz not found" } };
  const next = body.scoringMethod;
  if (next !== null && !isScoringMethod(next)) {
    return { status: 400, body: { error: "Unknown scoring method" } };
  }
  const settings = jsonParse<Record<string, unknown>>(quiz.settings, {});
  if (next === null) delete settings.scoringMethod;
  else settings.scoringMethod = next;
  run(`UPDATE quizzes SET settings = ? WHERE id = ?`, [JSON.stringify(settings), id]);
  const rescored = localRescore(id);
  await flushLocalDb();
  return { body: { scoring: localScoring(settings), rescored } };
}
