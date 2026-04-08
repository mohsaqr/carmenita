import { NextRequest, NextResponse } from "next/server";
import { difficultyBreakdown } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const quizId = req.nextUrl.searchParams.get("quizId") ?? undefined;
  const rows = await difficultyBreakdown(quizId);
  return NextResponse.json({ difficulty: rows });
}
