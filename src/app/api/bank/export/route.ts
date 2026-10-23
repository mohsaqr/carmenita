import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { serializeGift } from "@/lib/formats/gift";
import { serializeAiken } from "@/lib/formats/aiken";
import { serializeMarkdown } from "@/lib/formats/markdown";
import type { PortableQuestion } from "@/lib/formats/types";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";
import { bankQuestionWhere } from "@/lib/bank-filters";

/**
 * GET /api/bank/export?format=gift|aiken|markdown&[topic=]&[difficulty=]&[bloomLevel=]&[sourceType=]&[ids=]
 *
 * Accepts the same filter parameters as /api/bank/questions. Returns
 * the serialized text as text/plain with a Content-Disposition header
 * so the browser triggers a download.
 *
 * Aiken is lossy and drops mcq-multi questions — the response body
 * will still contain the successfully serialized questions, but the
 * `X-Carmenita-Skipped` response header reports how many were skipped
 * and why. Markdown and GIFT round-trip losslessly.
 */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format");
  if (format !== "gift" && format !== "aiken" && format !== "markdown") {
    return NextResponse.json(
      { error: "format must be 'gift', 'aiken', or 'markdown'" },
      { status: 400 },
    );
  }

  const topic = sp.get("topic");
  // Same selection as the bank list (archived sets only when named).
  const where = bankQuestionWhere(userId, sp);

  const rows = db.select().from(questions).where(where).all();

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No questions match the given filters" },
      { status: 404 },
    );
  }

  // Convert DB rows to PortableQuestion (strip id, createdAt, etc.)
  const portable: PortableQuestion[] = rows.map((r) => ({
    type: r.type,
    question: r.question,
    options: r.options,
    correctAnswer: r.correctAnswer,
    explanation: r.explanation,
    difficulty: r.difficulty,
    bloomLevel: r.bloomLevel,
    subject: r.subject,
    lesson: r.lesson,
    topic: r.topic,
    tags: r.tags,
    sourcePassage: r.sourcePassage,
  }));

  const category = topic || undefined;

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
        .map((s) => `${s.index}:${s.reason}`)
        .join("; ");
    }
  }

  const extension =
    format === "gift"
      ? "gift.txt"
      : format === "markdown"
        ? "md"
        : "aiken.txt";
  const filename = `carmenita-bank.${extension}`;

  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Carmenita-Skipped": skippedHeader,
      "X-Carmenita-Exported-Count": String(rows.length),
    },
  });
}

export const GET = withLog(handleGET);
