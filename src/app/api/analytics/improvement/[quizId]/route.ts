import { NextRequest, NextResponse } from "next/server";
import { improvementCurve } from "@/lib/analytics";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ quizId: string }> },
) {
  const { quizId } = await context.params;
  const points = await improvementCurve(quizId);
  return NextResponse.json({ curve: points });
}
