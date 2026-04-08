import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { extractText } from "@/lib/doc-extract";
import { CreateDocumentSchema } from "@/lib/validation";

/**
 * POST /api/documents — upload + extract a document.
 * Body: { filename, contentBase64 }
 * Returns: { id, filename, charCount, truncated, createdAt }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { filename, contentBase64 } = parsed.data;

  // Decode base64 → Uint8Array
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(Buffer.from(contentBase64, "base64"));
  } catch {
    return NextResponse.json({ error: "contentBase64 is not valid base64" }, { status: 400 });
  }

  // Extract text
  let extracted;
  try {
    extracted = await extractText(buffer, filename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown extraction error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (extracted.text.trim().length < 200) {
    return NextResponse.json(
      {
        error:
          "Document text is too short (<200 chars). It may be image-only or empty — please upload a text-bearing PDF, DOCX, or plain text file.",
      },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(documents).values({
    id,
    filename,
    text: extracted.text,
    charCount: extracted.charCount,
    truncated: extracted.truncated,
    createdAt: now,
    userId: null,
  }).run();

  return NextResponse.json({
    id,
    filename,
    charCount: extracted.charCount,
    truncated: extracted.truncated,
    createdAt: now,
  });
}

/**
 * GET /api/documents — list all documents (without the full text).
 */
export async function GET() {
  const rows = db
    .select({
      id: documents.id,
      filename: documents.filename,
      charCount: documents.charCount,
      truncated: documents.truncated,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .all();

  return NextResponse.json({ documents: rows });
}
