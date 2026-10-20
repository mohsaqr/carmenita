import { NextRequest, NextResponse } from "next/server";
import { GenerateFromTopicSchema } from "@/lib/validation";
import { generateQuestionsFromTopic } from "@/lib/llm-topic";
import { appendQuestionsToQuiz, insertQuizAndQuestions } from "@/lib/db-helpers";
import { resolvePrompt } from "@/lib/settings-store";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/generate-from-topic
 *
 * Generate a quiz from a typed topic (no source document). Used by the
 * "Topic" tab on the /create page.
 *
 * Body: {
 *   topic, title, subject?, level?, objectives?, customInstructions?,
 *   settings, provider, temperature?, systemPromptOverride?,
 *   defaultSubject?, defaultLesson?, defaultTags?,
 *   batchCount?, appendToQuizId?, avoid?
 * }
 * Returns: { quizId, questionCount, questions, dropped } — `questions` is
 * this batch's question texts, which the client passes back as `avoid`;
 * `dropped` counts what the quality gate left out (question-quality.ts).
 *
 * Large runs are split by the client into batches (see TOPIC_BATCH_SIZE):
 * the first request creates the quiz, each later one sends
 * `appendToQuizId` and adds its questions to the end.
 *
 * Flow:
 *   1. Validate body
 *   2. Call generateQuestionsFromTopic (single LLM call, no chunking)
 *   3. Persist via the shared helper. `sourceType` is "manual" because
 *      topic-only generation has no document provenance and the bank UI
 *      displays "manual" questions with the same semantics (bank-level,
 *      user-authored).
 *   4. Return the new quizId
 *
 * Unlike /api/generate-quiz (a background job), each batch answers
 * directly: one LLM call of ≤ TOPIC_BATCH_SIZE questions fits within the
 * tunnel's ~100 s request limit.
 */
export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GenerateFromTopicSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    topic,
    title,
    subject,
    level,
    objectives,
    customInstructions,
    settings,
    provider,
    temperature,
    systemPromptOverride,
    defaultSubject,
    defaultLesson,
    defaultTags,
    batchCount,
    appendToQuizId,
    avoid,
  } = parsed.data;

  let generated;
  try {
    generated = await generateQuestionsFromTopic({
      topic,
      subject,
      level,
      objectives,
      customInstructions,
      count: batchCount ?? settings.questionCount,
      allowedTypes: settings.allowedTypes,
      purpose: settings.purpose,
      style: settings.style,
      difficultyMix: settings.difficultyMix,
      provider,
      temperature,
      systemPromptOverride:
        systemPromptOverride ??
        resolvePrompt(userId, "carmenita.mcq.topic"),
      avoid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown generation error";
    const status = /401|403|invalid api key|authentication/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const { questions: parsedQuestions, dropped } = generated;
  if (parsedQuestions.length === 0) {
    const copied = dropped.copied + dropped.duplicate > 0;
    return NextResponse.json(
      {
        error: copied
          ? "Every generated question copied the pasted notes word for word or repeated an earlier one, so none were kept — try again, or shorten the pasted text."
          : "No questions were generated — the LLM output was empty or malformed.",
        dropped,
      },
      { status: 502 },
    );
  }

  const batch = {
    userId,
    parsedQuestions,
    sourceType: "manual" as const, // topic mode has no document source
    sourceDocumentId: null,
    sourceLabel: `topic: ${topic}`.slice(0, 200),
    // If the user didn't set explicit defaults, fall back to the topic
    // mode's own subject as a soft default so every generated question
    // has at least a subject hint in the bank.
    defaultSubject: defaultSubject ?? subject,
    defaultLesson,
    defaultTags,
  };

  const result = appendToQuizId
    ? appendQuestionsToQuiz({ ...batch, quizId: appendToQuizId })
    : insertQuizAndQuestions({ ...batch, title, settings, provider });
  if (!result) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  return NextResponse.json({
    quizId: result.quizId,
    questionCount: result.questionCount,
    questions: parsedQuestions.map((q) => q.question),
    dropped,
  });
}
