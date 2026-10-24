import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createChat, getChatQuestion, listChats } from "@/lib/chat";
import { withLog } from "@/lib/request-log";
import { ChatSaveSchema } from "@/lib/validation";

/** GET /api/chats — your saved chats, newest activity first, with token totals. */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ chats: listChats(auth.user.id) });
}

/**
 * POST /api/chats — save a temporary chat as it stands.
 * Body: { messages, title?, questionId? }. Returns { chat }.
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
  const parsed = ChatSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const { title, messages } = parsed.data;
  const questionId = parsed.data.questionId ?? null;
  if (questionId && !getChatQuestion(userId, questionId)) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  const chat = createChat(userId, { title, questionId, messages });
  return NextResponse.json({ chat }, { status: 201 });
}

export const GET = withLog(handleGET);
export const POST = withLog(handlePOST);
