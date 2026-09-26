import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { UpdateSetSchema } from "@/lib/validation";
import { deleteSet, updateSet } from "@/lib/question-sets";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/bank/sets/[id] — body { name?, folder? } renames or moves one of your sets. `folder: null` or "" removes it from its folder. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = UpdateSetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const set = updateSet(auth.user.id, id, parsed.data);
  if (!set) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  return NextResponse.json({ set });
}

/** DELETE /api/bank/sets/[id] — deletes one of your sets AND all of its questions. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const result = deleteSet(auth.user.id, id);
  if (!result) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  return NextResponse.json({ deleted: id, questionsDeleted: result.questionsDeleted });
}
