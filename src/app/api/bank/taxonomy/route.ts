import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { withLog } from "@/lib/request-log";

/**
 * GET /api/bank/taxonomy
 *
 * Returns the set of distinct subject, lesson, topic, and tag values
 * in the signed-in user's bank. Used by the bank UI to populate filter
 * autocomplete and the bulk-tag dialog.
 *
 * Tags are stored as JSON arrays, so we expand them with json_each().
 * Results are sorted alphabetically and deduped.
 */
async function handleGET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;
  // Questions in archived sets are left out so filters only offer live material.
  const live = sql`(set_id IS NULL OR set_id NOT IN (SELECT id FROM question_sets WHERE archived = 1 AND user_id = ${userId}))`;
  const subjects = db
    .all<{ subject: string }>(
      sql`SELECT DISTINCT subject FROM questions WHERE user_id = ${userId} AND ${live} AND subject IS NOT NULL AND subject != '' ORDER BY subject`,
    )
    .map((r) => r.subject);

  const lessons = db
    .all<{ lesson: string }>(
      sql`SELECT DISTINCT lesson FROM questions WHERE user_id = ${userId} AND ${live} AND lesson IS NOT NULL AND lesson != '' ORDER BY lesson`,
    )
    .map((r) => r.lesson);

  const topics = db
    .all<{ topic: string }>(
      sql`SELECT DISTINCT topic FROM questions WHERE user_id = ${userId} AND ${live} AND topic IS NOT NULL AND topic != '' ORDER BY topic`,
    )
    .map((r) => r.topic);

  // Expand tags with json_each so we get a row per tag string
  const tags = db
    .all<{ value: string }>(
      sql`SELECT DISTINCT value FROM questions, json_each(questions.tags) WHERE questions.user_id = ${userId} AND ${live} ORDER BY value`,
    )
    .map((r) => r.value);

  return NextResponse.json({ subjects, lessons, topics, tags });
}

export const GET = withLog(handleGET);
