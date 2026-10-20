import { NextRequest, NextResponse } from "next/server";
import { listOtherUsernames, requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

/** GET /api/users — usernames of the other accounts (for "Send a copy to…"). */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: listOtherUsernames(auth.user.id) });
}

export const GET = withLog(handleGET);
