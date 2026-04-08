import { NextRequest, NextResponse } from "next/server";
import { GenerateFromTopicSchema } from "@/lib/validation";
import { generateQuestionsFromTopic } from "@/lib/llm-topic";
import { insertQuizAndQuestions } from "@/lib/db-helpers";

/**
 * POST /api/generate-from-topic
 *
 * Generate a quiz from a typed topic (no source document). Used by the
 * "Topic" tab on the /create page.
 *
 * Body: {
 *   topic, title, subject?, level?, objectives?, mustInclude?,
 *   settings, provider, temperature?, systemPromptOverride?,
 *   defaultSubject?, defaultLesson?, defaultTags?
 * }
 * Returns: { quizId, questionCount }
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
 * The response shape is identical to /api/generate-quiz so the frontend
 * can navigate the same way (`router.push('/quiz/' + data.quizId)`).
 */
export async function POST(req: NextRequest) {
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
    mustInclude,
    settings,
    provider,
    temperature,
    systemPromptOverride,
    defaultSubject,
    defaultLesson,
    defaultTags,
  } = parsed.data;

  let parsedQuestions;
  try {
    parsedQuestions = await generateQuestionsFromTopic({
      topic,
      subject,
      level,
      objectives,
      mustInclude,
      count: settings.questionCount,
      allowedTypes: settings.allowedTypes,
      difficultyMix: settings.difficultyMix,
      provider,
      temperature,
      systemPromptOverride,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown generation error";
    const status = /401|403|invalid api key|authentication/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  if (parsedQuestions.length === 0) {
    return NextResponse.json(
      { error: "No questions were generated — the LLM output was empty or malformed." },
      { status: 502 },
    );
  }

  const { quizId, questionCount } = insertQuizAndQuestions({
    title,
    settings,
    provider,
    parsedQuestions,
    sourceType: "manual", // topic mode has no document source
    sourceDocumentId: null,
    sourceLabel: `topic: ${topic}`.slice(0, 200),
    // If the user didn't set explicit defaults, fall back to the topic
    // mode's own subject as a soft default so every generated question
    // has at least a subject hint in the bank.
    defaultSubject: defaultSubject ?? subject,
    defaultLesson,
    defaultTags,
  });

  return NextResponse.json({ quizId, questionCount });
}
