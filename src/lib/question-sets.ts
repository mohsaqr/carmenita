import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { questionSets, questions } from "@/db/schema";

/**
 * Question sets: named batches of questions, optionally grouped into
 * folders (e.g. set "Chapter 3 MCQs" in folder "pathology").
 *
 * Every user has a PRIVATE bank: every function here is scoped to the
 * owner's user id, and a set id belonging to someone else behaves
 * exactly like a missing one. Sets move between users only as copies
 * (`sendSetCopy`). Server-only — uses the Drizzle singleton.
 */

export interface SetSummary {
  id: string;
  name: string;
  folder: string | null;
  receivedFrom: string | null;
  createdAt: string;
  questionCount: number;
}

/** Trim; empty → null. Folders are labels, so blank means "no folder". */
export function normalizeFolder(folder: string | null | undefined): string | null {
  const f = (folder ?? "").trim();
  return f ? f : null;
}

const ownedBy = (userId: string) => eq(questionSets.userId, userId);

export function listSets(userId: string): SetSummary[] {
  return db
    .select({
      id: questionSets.id,
      name: questionSets.name,
      folder: questionSets.folder,
      receivedFrom: questionSets.receivedFrom,
      createdAt: questionSets.createdAt,
      questionCount: count(questions.id),
    })
    .from(questionSets)
    .leftJoin(questions, eq(questions.setId, questionSets.id))
    .where(ownedBy(userId))
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

/** True when `setId` exists and belongs to `userId`. */
export function ownsSet(userId: string, setId: string): boolean {
  return !!db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(and(eq(questionSets.id, setId), ownedBy(userId)))
    .get();
}

function findSet(userId: string, name: string, folder: string | null): string | null {
  const row = db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(
      and(
        ownedBy(userId),
        sql`lower(${questionSets.name}) = lower(${name})`,
        folder === null ? isNull(questionSets.folder) : sql`lower(${questionSets.folder}) = lower(${folder})`,
      ),
    )
    .get();
  return row?.id ?? null;
}

/**
 * Find the user's set with this name in this folder (case-insensitive)
 * or create it. Importing twice under the same name + folder therefore
 * adds to the existing set instead of making a duplicate.
 */
export function findOrCreateSet(
  userId: string,
  name: string,
  folder: string | null | undefined,
): { id: string; created: boolean } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Set name must not be empty");
  const f = normalizeFolder(folder);
  const existing = findSet(userId, trimmed, f);
  if (existing) return { id: existing, created: false };
  const id = randomUUID();
  db.insert(questionSets)
    .values({ id, name: trimmed, folder: f, createdAt: new Date().toISOString(), userId })
    .run();
  return { id, created: true };
}

export function updateSet(
  userId: string,
  id: string,
  patch: { name?: string; folder?: string | null },
): SetSummary | null {
  if (!ownsSet(userId, id)) return null;
  const set: { name?: string; folder?: string | null } = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Set name must not be empty");
    set.name = n;
  }
  if (patch.folder !== undefined) set.folder = normalizeFolder(patch.folder);
  if (Object.keys(set).length > 0) {
    db.update(questionSets).set(set).where(and(eq(questionSets.id, id), ownedBy(userId))).run();
    // Keep the per-question label in step with the set name.
    if (set.name) {
      db.update(questions)
        .set({ sourceLabel: set.name })
        .where(and(eq(questions.setId, id), eq(questions.userId, userId)))
        .run();
    }
  }
  return listSets(userId).find((s) => s.id === id) ?? null;
}

/**
 * Delete one of the user's sets and all its questions (FK cascade
 * removes them, and their quiz links and answers). Returns null if the
 * set doesn't exist or isn't theirs.
 */
export function deleteSet(userId: string, id: string): { questionsDeleted: number } | null {
  return db.transaction((tx) => {
    if (!tx.select({ id: questionSets.id }).from(questionSets).where(and(eq(questionSets.id, id), ownedBy(userId))).get()) {
      return null;
    }
    const n = tx.select({ n: count() }).from(questions).where(eq(questions.setId, id)).get()?.n ?? 0;
    tx.delete(questionSets).where(and(eq(questionSets.id, id), ownedBy(userId))).run();
    return { questionsDeleted: n };
  });
}

/** Rename a folder across every one of the user's sets in it. Returns the number of sets moved. */
export function renameFolder(userId: string, from: string, to: string | null): number {
  const target = normalizeFolder(to);
  return db
    .update(questionSets)
    .set({ folder: target })
    .where(and(ownedBy(userId), sql`lower(${questionSets.folder}) = lower(${from.trim()})`))
    .run().changes;
}

/**
 * Send an independent COPY of one of the sender's sets to another user.
 *
 * The receiver gets a new set (same name and folder, marked "from
 * <sender>") with fresh question ids; later edits or deletes on either
 * side never affect the other. Variation links inside the set are kept,
 * links to questions outside it are dropped. Personal study data —
 * notes, attempts, answers — stays with the sender. If the receiver
 * already has a set with that name in that folder, the copy is named
 * "<name> (from <sender>)" so it never merges into their own set.
 *
 * Returns null when the set isn't the sender's.
 */
export function sendSetCopy(
  fromUser: { id: string; username: string },
  setId: string,
  toUserId: string,
): { setId: string; name: string; questionsCopied: number } | null {
  if (toUserId === fromUser.id) throw new Error("Cannot send a set to yourself");
  return db.transaction((tx) => {
    const src = tx
      .select()
      .from(questionSets)
      .where(and(eq(questionSets.id, setId), ownedBy(fromUser.id)))
      .get();
    if (!src) return null;

    const clash = tx
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(
        and(
          ownedBy(toUserId),
          sql`lower(${questionSets.name}) = lower(${src.name})`,
          src.folder === null ? isNull(questionSets.folder) : sql`lower(${questionSets.folder}) = lower(${src.folder})`,
        ),
      )
      .get();
    const name = clash ? `${src.name} (from ${fromUser.username})` : src.name;

    const newSetId = randomUUID();
    tx.insert(questionSets)
      .values({
        id: newSetId,
        name,
        folder: src.folder,
        receivedFrom: fromUser.username,
        createdAt: new Date().toISOString(),
        userId: toUserId,
      })
      .run();

    const rows = tx
      .select()
      .from(questions)
      .where(and(eq(questions.setId, setId), eq(questions.userId, fromUser.id)))
      .all();
    const idMap = new Map(rows.map((q) => [q.id, randomUUID()]));
    if (rows.length > 0) {
      tx.insert(questions)
        .values(
          rows.map((q) => ({
            ...q,
            id: idMap.get(q.id)!,
            setId: newSetId,
            userId: toUserId,
            sourceLabel: name,
            notes: null,
            // The source document belongs to the sender; don't point at it.
            sourceDocumentId: null,
            parentQuestionId: q.parentQuestionId ? (idMap.get(q.parentQuestionId) ?? null) : null,
          })),
        )
        .run();
    }
    return { setId: newSetId, name, questionsCopied: rows.length };
  });
}
