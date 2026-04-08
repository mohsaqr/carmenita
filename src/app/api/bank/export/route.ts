import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { questions } from "@/db/schema";
import { serializeGift } from "@/lib/formats/gift";
import { serializeAiken } from "@/lib/formats/aiken";
import { serializeMarkdown } from "@/lib/formats/markdown";
import type { PortableQuestion } from "@/lib/formats/types";

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
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format");
  if (format !== "gift" && format !== "aiken" && format !== "markdown") {
    return NextResponse.json(
      { error: "format must be 'gift', 'aiken', or 'markdown'" },
      { status: 400 },
    );
  }

  const topic = sp.get("topic");
  const subject = sp.get("subject");
  const lesson = sp.get("lesson");
  const tag = sp.get("tag");
  const difficulty = sp.get("difficulty") as "easy" | "medium" | "hard" | null;
  const bloomLevel = sp.get("bloomLevel") as
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create"
    | null;
  const sourceType = sp.get("sourceType") as
    | "document"
    | "gift-import"
    | "aiken-import"
    | "markdown-import"
    | "manual"
    | "variation"
    | null;
  const idsCsv = sp.get("ids");

  const conditions = [];
  if (topic) conditions.push(eq(questions.topic, topic));
  if (subject) conditions.push(eq(questions.subject, subject));
  if (lesson) conditions.push(eq(questions.lesson, lesson));
  if (tag) {
    const escaped = tag.replace(/"/g, '\\"');
    conditions.push(like(questions.tags, `%"${escaped}"%`));
  }
  if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
  if (bloomLevel) conditions.push(eq(questions.bloomLevel, bloomLevel));
  if (sourceType) conditions.push(eq(questions.sourceType, sourceType));
  if (idsCsv) {
    const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) conditions.push(inArray(questions.id, ids));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
