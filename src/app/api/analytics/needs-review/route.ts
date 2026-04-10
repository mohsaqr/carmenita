import { NextRequest, NextResponse } from "next/server";
import { needsReview } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;
  const rows = await needsReview(limit);
  return NextResponse.json({ questions: rows });
}
