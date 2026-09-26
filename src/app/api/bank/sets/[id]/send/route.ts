import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByUsername, requireUser } from "@/lib/auth";
import { sendSetCopy } from "@/lib/question-sets";

const SendSchema = z.object({ toUsername: z.string().trim().min(1).max(200) });

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/bank/sets/[id]/send — body { toUsername }
 *
 * Sends an independent copy of one of your sets into another user's
 * bank (see sendSetCopy). Returns { sentTo, name, questionsCopied }.
 * 404 if the set isn't yours or the user doesn't exist.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose who to send it to" }, { status: 400 });
  }
  const to = findUserByUsername(parsed.data.toUsername);
  if (!to) return NextResponse.json({ error: `No user named "${parsed.data.toUsername}"` }, { status: 404 });
  if (to.id === auth.user.id) {
    return NextResponse.json({ error: "You can't send a set to yourself" }, { status: 400 });
  }
  const result = sendSetCopy(auth.user, id, to.id);
  if (!result) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  return NextResponse.json({ sentTo: to.username, name: result.name, questionsCopied: result.questionsCopied });
}
