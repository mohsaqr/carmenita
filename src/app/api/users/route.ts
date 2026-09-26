import { NextRequest, NextResponse } from "next/server";
import { listOtherUsernames, requireUser } from "@/lib/auth";

/** GET /api/users — usernames of the other accounts (for "Send a copy to…"). */
export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: listOtherUsernames(auth.user.id) });
}
