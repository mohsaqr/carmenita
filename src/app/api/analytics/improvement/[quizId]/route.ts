import { NextRequest, NextResponse } from "next/server";
import { improvementCurve } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ quizId: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  const { quizId } = await context.params;
  const points = await improvementCurve(userId, quizId);
  return NextResponse.json({ curve: points });
}
