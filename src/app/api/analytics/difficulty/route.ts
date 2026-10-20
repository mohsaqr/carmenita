import { NextRequest, NextResponse } from "next/server";
import { difficultyBreakdown } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const quizId = req.nextUrl.searchParams.get("quizId") ?? undefined;
  const rows = await difficultyBreakdown(userId, quizId);
  return NextResponse.json({ difficulty: rows });
}

export const GET = withLog(handleGET);
