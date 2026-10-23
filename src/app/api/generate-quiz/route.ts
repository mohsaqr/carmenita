import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { GenerateQuizSchema } from "@/lib/validation";
import { generateQuizQuestions, planGeneration } from "@/lib/llm-quiz";
import { insertQuizAndQuestions } from "@/lib/db-helpers";
import { isLectureFilename } from "@/lib/doc-extract";
import { resolvePrompt } from "@/lib/settings-store";
import { requireUser } from "@/lib/auth";
import { startJob } from "@/lib/generation-jobs";
import { noteLog, withLog } from "@/lib/request-log";

/**
 * POST /api/generate-quiz
 *
 * Body: { documentId, title, settings, provider, temperature?, systemPromptOverride?, defaultSubject?, defaultLesson?, defaultTags?, customInstructions? }
 * Returns 202 { jobId } — poll `GET /api/generate-quiz/jobs/[jobId]` for
 * progress and, when done, { quizId, questionCount, dropped }.
 *
 * Generation runs as a background job (generation-jobs.ts) because it can
 * outlast the ~100 s the Cloudflare tunnel allows one request.
 *
 * Flow:
 *   1. Validate body
 *   2. Load document row (a bad body or missing document still answers 4xx
 *      straight away)
 *   3. Detect .pptx filenames → switch `promptId` to `carmenita.mcq.lecture`
 *      (slide-aware prompt). Other filenames use `carmenita.mcq.document`.
 *   4. In the job: generateQuizQuestions (chunks in parallel), then persist
 *      via the shared helper (handles auto-tag fallback + transaction)
 */
async function handlePOST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GenerateQuizSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    documentId,
    title,
    settings,
    provider,
    temperature,
    systemPromptOverride,
    defaultSubject,
    defaultLesson,
    defaultTags,
    customInstructions,
  } = parsed.data;

  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .get();
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Lecture/PPTX detection: if the uploaded file was a PPTX, we want the
  // slide-aware prompt (`carmenita.mcq.lecture`) instead of the generic
  // document prompt. Detection via filename suffix is sufficient because
  // extractPptx is the only path that produces "--- Slide N ---" markers.
  const model = `${provider.providerType}/${provider.defaultModel}`;
  noteLog({ file: doc.filename, chars: doc.charCount, questions: settings.questionCount, model });

  const promptId = isLectureFilename(doc.filename)
    ? "carmenita.mcq.lecture"
    : "carmenita.mcq.document";

  const job = startJob(userId, planGeneration(doc.text, settings.questionCount).length, async (progress) => {
    const { questions: parsedQuestions, dropped } = await generateQuizQuestions({
      docText: doc.text,
      provider,
      settings,
      promptId,
      // An explicit per-request override wins; otherwise the user's
      // saved override from Settings (or the default).
      systemPromptOverride:
        systemPromptOverride ?? resolvePrompt(userId, promptId),
      temperature,
      defaultSubject: defaultSubject ?? null,
      defaultLesson: defaultLesson ?? null,
      customInstructions,
      onProgress: progress,
    });
    if (parsedQuestions.length === 0) {
      throw new Error(
        dropped.copied + dropped.duplicate > 0
          ? "Every generated question copied the document word for word or repeated another, so none were kept — try again."
          : "No questions were generated — the LLM output was empty or malformed.",
      );
    }
    const { quizId, questionCount } = insertQuizAndQuestions({
      userId,
      title,
      settings,
      provider,
      parsedQuestions,
      sourceType: "document",
      sourceDocumentId: documentId,
      sourceLabel: doc.filename,
      defaultSubject,
      defaultLesson,
      defaultTags,
    });
    return { quizId, questionCount, dropped };
  }, { file: doc.filename, chars: doc.charCount, questions: settings.questionCount, model });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

export const POST = withLog(handlePOST);
