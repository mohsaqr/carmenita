import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

/** GET /api/auth/me — the logged-in user, or 401. */
async function handleGET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ user });
}

export const GET = withLog(handleGET);
