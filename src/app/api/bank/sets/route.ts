import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listSets } from "@/lib/question-sets";
import { withLog } from "@/lib/request-log";

/**
 * GET /api/bank/sets — the signed-in user's question sets with folder,
 * question count and (for received copies) the sender, ordered by
 * folder then name.
 *
 * Returns: { sets: Array<{ id, name, folder, receivedFrom, createdAt, questionCount }> }
 */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ sets: listSets(auth.user.id) });
}

export const GET = withLog(handleGET);
