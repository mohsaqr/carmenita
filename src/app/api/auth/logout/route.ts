import { NextRequest, NextResponse } from "next/server";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

/** POST /api/auth/logout — ends the current session and clears the cookie. */
async function handlePOST(req: NextRequest) {
  deleteSession(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const POST = withLog(handlePOST);
