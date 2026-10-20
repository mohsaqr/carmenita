import { NextRequest, NextResponse } from "next/server";
import { needsReview } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;
  const rows = await needsReview(userId, limit);
  return NextResponse.json({ questions: rows });
}

export const GET = withLog(handleGET);
