import { NextRequest, NextResponse } from "next/server";
import { topicBreakdown } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const quizId = req.nextUrl.searchParams.get("quizId") ?? undefined;
  const rows = await topicBreakdown(quizId);
  return NextResponse.json({ topics: rows });
}
