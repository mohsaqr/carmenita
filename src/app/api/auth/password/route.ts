import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { changeOwnPassword, requireUser, SESSION_COOKIE } from "@/lib/auth";

const ChangeSchema = z.object({
  currentPassword: z.string().max(1000),
  newPassword: z.string().max(1000),
});

/**
 * POST /api/auth/password — body { currentPassword, newPassword }
 *
 * Any signed-in user changes their own password. 400 if the current
 * password is wrong or the new one is too short. Other devices are
 * signed out; this browser stays signed in.
 */
export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Current and new password are required" }, { status: 400 });
  }
  try {
    const result = changeOwnPassword(
      auth.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      req.cookies.get(SESSION_COOKIE)?.value,
    );
    if (result === "wrong-password") {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid password" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
