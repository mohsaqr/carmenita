import { NextRequest, NextResponse } from "next/server";
import { slowestQuestions } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const limitStr = req.nextUrl.searchParams.get("limit");
  const limit = limitStr ? Math.min(50, Math.max(1, parseInt(limitStr, 10))) : 10;
  const rows = await slowestQuestions(limit);
  return NextResponse.json({ slowest: rows });
}
