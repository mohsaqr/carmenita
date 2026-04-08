import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { GenerateQuizSchema } from "@/lib/validation";
import { generateQuizQuestions } from "@/lib/llm-quiz";
import { insertQuizAndQuestions } from "@/lib/db-helpers";
import { isLectureFilename } from "@/lib/doc-extract";

/**
 * POST /api/generate-quiz
 *
 * Body: { documentId, title, settings, provider, temperature?, systemPromptOverride?, defaultSubject?, defaultLesson?, defaultTags? }
 * Returns: { quizId, questionCount }
 *
 * Flow:
 *   1. Validate body
 *   2. Load document row
 *   3. Detect .pptx filenames → switch `promptId` to `carmenita.mcq.lecture`
 *      (slide-aware prompt). Other filenames use `carmenita.mcq.document`.
 *   4. Call generateQuizQuestions (chunking + retry)
 *   5. Persist via the shared helper (handles auto-tag fallback + transaction)
 *   6. Return the new quizId
 */
export async function POST(req: NextRequest) {
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
  } = parsed.data;

  const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Lecture/PPTX detection: if the uploaded file was a PPTX, we want the
  // slide-aware prompt (`carmenita.mcq.lecture`) instead of the generic
  // document prompt. Detection via filename suffix is sufficient because
  // extractPptx is the only path that produces "--- Slide N ---" markers.
  const promptId = isLectureFilename(doc.filename)
    ? "carmenita.mcq.lecture"
    : "carmenita.mcq.document";

  let parsedQuestions;
  try {
    parsedQuestions = await generateQuizQuestions({
      docText: doc.text,
      provider,
      settings,
      promptId,
      systemPromptOverride,
      temperature,
      defaultSubject: defaultSubject ?? null,
      defaultLesson: defaultLesson ?? null,
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
    sourceType: "document",
    sourceDocumentId: documentId,
    sourceLabel: doc.filename,
    defaultSubject,
    defaultLesson,
    defaultTags,
  });

  return NextResponse.json({ quizId, questionCount });
}
