import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, resetPassword } from "@/lib/auth";

const ResetSchema = z.object({ password: z.string().max(1000) });

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/password — body { password }
 * Admin-only. Sets a new password and signs that user out everywhere.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = requireAdmin(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ResetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Password is required" }, { status: 400 });
  try {
    if (!resetPassword(id, parsed.data.password)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid password" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
