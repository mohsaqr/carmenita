import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * GET /api/bank/taxonomy
 *
 * Returns the set of distinct subject, lesson, topic, and tag values
 * currently in the bank. Used by the bank UI to populate filter
 * autocomplete and the bulk-tag dialog.
 *
 * Tags are stored as JSON arrays, so we expand them with json_each().
 * Results are sorted alphabetically and deduped.
 */
export async function GET() {
  const subjects = db
    .all<{ subject: string }>(
      sql`SELECT DISTINCT subject FROM questions WHERE subject IS NOT NULL AND subject != '' ORDER BY subject`,
    )
    .map((r) => r.subject);

  const lessons = db
    .all<{ lesson: string }>(
      sql`SELECT DISTINCT lesson FROM questions WHERE lesson IS NOT NULL AND lesson != '' ORDER BY lesson`,
    )
    .map((r) => r.lesson);

  const topics = db
    .all<{ topic: string }>(
      sql`SELECT DISTINCT topic FROM questions WHERE topic IS NOT NULL AND topic != '' ORDER BY topic`,
    )
    .map((r) => r.topic);

  // Expand tags with json_each so we get a row per tag string
  const tags = db
    .all<{ value: string }>(
      sql`SELECT DISTINCT value FROM questions, json_each(questions.tags) ORDER BY value`,
    )
    .map((r) => r.value);

  return NextResponse.json({ subjects, lessons, topics, tags });
}
