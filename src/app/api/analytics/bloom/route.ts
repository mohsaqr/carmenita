import { NextRequest, NextResponse } from "next/server";
import { bloomBreakdown } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const quizId = req.nextUrl.searchParams.get("quizId") ?? undefined;
  const rows = await bloomBreakdown(quizId);
  return NextResponse.json({ bloom: rows });
}
