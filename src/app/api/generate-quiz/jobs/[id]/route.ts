import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getJob } from "@/lib/generation-jobs";

/**
 * GET /api/generate-quiz/jobs/[id] — progress of a generation job started
 * by POST /api/generate-quiz.
 *
 * Returns { status: "running" | "done" | "error", done, total } plus, when
 * done, { quizId, questionCount, dropped }, or, on error, { error }.
 * 404 for an unknown job, another user's job, or one lost to a server
 * restart.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;

  const job = getJob(auth.user.id, id);
  if (!job) {
    return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
  }
  return NextResponse.json({
    status: job.status,
    done: job.done,
    total: job.total,
    ...job.result,
    ...(job.error ? { error: job.error } : {}),
  });
}
