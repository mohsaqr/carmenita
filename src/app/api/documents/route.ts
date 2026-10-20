import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { extractText, isServerFault, ServerReadError } from "@/lib/doc-extract";
import { CreateDocumentSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { noteLog, withLog } from "@/lib/request-log";

/**
 * POST /api/documents — upload + extract a document.
 * Body: { filename, contentBase64 }
 * Returns: { id, filename, charCount, truncated, createdAt }
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

  const parsed = CreateDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { filename, contentBase64 } = parsed.data;
  noteLog({ file: filename });

  // Decode base64 → Uint8Array
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(Buffer.from(contentBase64, "base64"));
  } catch {
    return NextResponse.json({ error: "contentBase64 is not valid base64" }, { status: 400 });
  }

  noteLog({ bytes: buffer.length });

  // Extract text. A problem with the file is the user's to fix (400, the
  // message says what); a problem on our side (a missing module, the PDF
  // worker) is ours (500, the message says the file is probably fine and
  // the technical cause goes to the log).
  let extracted;
  try {
    extracted = await extractText(buffer, filename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ServerReadError || isServerFault(msg)) {
      // The user sees a plain message; the technical cause is for the log.
      noteLog({ cause: msg });
      return NextResponse.json(
        {
          error:
            `The server could not read "${filename}" because of a problem on our side — the file itself is probably fine. ` +
            "Please send this message to the admin.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  noteLog({ chars: extracted.charCount, truncated: extracted.truncated || undefined, failedPages: extracted.failedPages || undefined });

  const usable = extracted.text.trim().length;
  if (usable < 200) {
    return NextResponse.json(
      {
        error:
          `Only ${usable} characters of text could be read from "${filename}" (at least 200 are needed). ` +
          "Pages or slides that are pictures have no text to read — use a file with selectable text, or run OCR first.",
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
    userId,
  }).run();

  return NextResponse.json({
    id,
    filename,
    charCount: extracted.charCount,
    truncated: extracted.truncated,
    failedPages: extracted.failedPages ?? 0,
    createdAt: now,
  });
}

/**
 * GET /api/documents — list all documents (without the full text).
 */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const rows = db
    .select({
      id: documents.id,
      filename: documents.filename,
      charCount: documents.charCount,
      truncated: documents.truncated,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt))
    .all();

  return NextResponse.json({ documents: rows });
}

export const POST = withLog(handlePOST);
export const GET = withLog(handleGET);
