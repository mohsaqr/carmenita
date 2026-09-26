import { NextRequest, NextResponse } from "next/server";
import { UpdateSetSchema } from "@/lib/validation";
import { deleteSet, updateSet } from "@/lib/question-sets";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/bank/sets/[id] — body { name?, folder? } renames or moves a set. `folder: null` or "" removes it from its folder. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
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
  const set = updateSet(id, parsed.data);
  if (!set) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  return NextResponse.json({ set });
}

/** DELETE /api/bank/sets/[id] — deletes the set AND all of its questions. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const result = deleteSet(id);
  if (!result) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  return NextResponse.json({ deleted: id, questionsDeleted: result.questionsDeleted });
}
