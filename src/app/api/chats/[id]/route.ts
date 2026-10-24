import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { deleteChat, getChat, renameChat } from "@/lib/chat";
import { withLog } from "@/lib/request-log";
import { ChatRenameSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/chats/[id] — one of your saved chats, every message. */
async function handleGET(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const chat = getChat(auth.user.id, id);
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ chat });
}

/** PATCH /api/chats/[id] — body { title } renames it. */
async function handlePATCH(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ChatRenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const chat = renameChat(auth.user.id, id, parsed.data.title);
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ chat });
}

/** DELETE /api/chats/[id] — deletes it for good (chats have no trash). */
async function handleDELETE(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!deleteChat(auth.user.id, id)) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}

export const GET = withLog(handleGET);
export const PATCH = withLog(handlePATCH);
export const DELETE = withLog(handleDELETE);
