import { NextRequest, NextResponse } from "next/server";
import { slowestQuestions } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const limitStr = req.nextUrl.searchParams.get("limit");
  const limit = limitStr ? Math.min(50, Math.max(1, parseInt(limitStr, 10))) : 10;
  const rows = await slowestQuestions(userId, limit);
  return NextResponse.json({ slowest: rows });
}
