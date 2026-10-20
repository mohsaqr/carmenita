import { NextRequest, NextResponse } from "next/server";
import { topicBreakdown } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const quizId = req.nextUrl.searchParams.get("quizId") ?? undefined;
  const rows = await topicBreakdown(userId, quizId);
  return NextResponse.json({ topics: rows });
}

export const GET = withLog(handleGET);
