import { NextResponse } from "next/server";
import { listSets } from "@/lib/question-sets";

/**
 * GET /api/bank/sets — every question set with its folder and question
 * count, ordered by folder then name.
 *
 * Returns: { sets: Array<{ id, name, folder, createdAt, questionCount }> }
 */
export async function GET() {
  return NextResponse.json({ sets: listSets() });
}
