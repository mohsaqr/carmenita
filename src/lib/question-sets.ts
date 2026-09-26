import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { questionSets, questions } from "@/db/schema";

/**
 * Question sets: named batches of imported questions, optionally
 * grouped into folders (e.g. set "Chapter 3 MCQs" in folder
 * "pathology"). Server-only — uses the Drizzle singleton.
 */

export interface SetSummary {
  id: string;
  name: string;
  folder: string | null;
  createdAt: string;
  questionCount: number;
}

/** Trim; empty → null. Folders are labels, so blank means "no folder". */
export function normalizeFolder(folder: string | null | undefined): string | null {
  const f = (folder ?? "").trim();
  return f ? f : null;
}

export function listSets(): SetSummary[] {
  return db
    .select({
      id: questionSets.id,
      name: questionSets.name,
      folder: questionSets.folder,
      createdAt: questionSets.createdAt,
      questionCount: count(questions.id),
    })
    .from(questionSets)
    .leftJoin(questions, eq(questions.setId, questionSets.id))
    .groupBy(questionSets.id)
    // Folderless sets last; then alphabetical folder, then set name.
    .orderBy(
      sql`${questionSets.folder} IS NULL`,
      sql`lower(${questionSets.folder})`,
      sql`lower(${questionSets.name})`,
      asc(questionSets.createdAt),
    )
    .all();
}

/**
 * Find the set with this name in this folder (case-insensitive) or
 * create it. Importing twice under the same name + folder therefore
 * adds to the existing set instead of making a duplicate.
 */
export function findOrCreateSet(name: string, folder: string | null | undefined): { id: string; created: boolean } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Set name must not be empty");
  const f = normalizeFolder(folder);
  const existing = db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(
      and(
        sql`lower(${questionSets.name}) = lower(${trimmed})`,
        f === null ? isNull(questionSets.folder) : sql`lower(${questionSets.folder}) = lower(${f})`,
      ),
    )
    .get();
  if (existing) return { id: existing.id, created: false };
  const id = randomUUID();
  db.insert(questionSets)
    .values({ id, name: trimmed, folder: f, createdAt: new Date().toISOString(), userId: null })
    .run();
  return { id, created: true };
}

export function updateSet(
  id: string,
  patch: { name?: string; folder?: string | null },
): SetSummary | null {
  const set: { name?: string; folder?: string | null } = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Set name must not be empty");
    set.name = n;
  }
  if (patch.folder !== undefined) set.folder = normalizeFolder(patch.folder);
  if (Object.keys(set).length > 0) {
    const res = db.update(questionSets).set(set).where(eq(questionSets.id, id)).run();
    if (res.changes === 0) return null;
    // Keep the per-question label in step with the set name.
    if (set.name) db.update(questions).set({ sourceLabel: set.name }).where(eq(questions.setId, id)).run();
  }
  return listSets().find((s) => s.id === id) ?? null;
}

/**
 * Delete a set and all its questions (FK cascade removes them, and
 * their quiz links and answers). Returns null if the set didn't exist.
 */
export function deleteSet(id: string): { questionsDeleted: number } | null {
  return db.transaction((tx) => {
    const n = tx.select({ n: count() }).from(questions).where(eq(questions.setId, id)).get()?.n ?? 0;
    const res = tx.delete(questionSets).where(eq(questionSets.id, id)).run();
    if (res.changes === 0) return null;
    return { questionsDeleted: n };
  });
}

/** Rename a folder across every set in it. Returns the number of sets moved. */
export function renameFolder(from: string, to: string | null): number {
  const target = normalizeFolder(to);
  return db
    .update(questionSets)
    .set({ folder: target })
    .where(sql`lower(${questionSets.folder}) = lower(${from.trim()})`)
    .run().changes;
}
