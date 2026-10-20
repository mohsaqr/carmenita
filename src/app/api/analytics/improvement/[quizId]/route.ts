import { NextRequest, NextResponse } from "next/server";
import { improvementCurve } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

async function handleGET(
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

export const GET = withLog(handleGET);
