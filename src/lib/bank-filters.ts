import { and, eq, inArray, like, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { questionSets, questions } from "@/db/schema";
import { notArchivedQuestion, questionOwnedBy } from "@/lib/question-sets";

/**
 * The bank's question filter, shared by GET /api/bank/questions and
 * GET /api/bank/export so both always select the same questions.
 *
 * Query parameters: topic, subject, lesson, tag, difficulty, bloomLevel,
 * sourceType, ids (comma list), setId, folder, includeArchived=1.
 *
 * Questions in archived sets are left out unless the request names them
 * (setId or ids) or passes includeArchived=1 — otherwise "everything"
 * would include a whole archived collection (e.g. 189k benchmark items).
 * Server-only (uses the Drizzle singleton).
 */
export function bankQuestionWhere(userId: string, sp: URLSearchParams): SQL | undefined {
  const topic = sp.get("topic");
  const subject = sp.get("subject");
  const lesson = sp.get("lesson");
  const tag = sp.get("tag");
  const difficulty = sp.get("difficulty") as "easy" | "medium" | "hard" | null;
  const bloomLevel = sp.get("bloomLevel") as
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create"
    | null;
  const sourceType = sp.get("sourceType") as
    | "document"
    | "gift-import"
    | "aiken-import"
    | "markdown-import"
    | "manual"
    | "variation"
    | null;
  const idsCsv = sp.get("ids");
  const setId = sp.get("setId");
  const folder = sp.get("folder");

  // Private bank: only the signed-in user's questions. Scoped to one set,
  // the owner check must not steer the index choice (see questionOwnedBy).
  const conditions = [setId ? questionOwnedBy(userId) : eq(questions.userId, userId)];
  if (topic) conditions.push(eq(questions.topic, topic));
  if (subject) conditions.push(eq(questions.subject, subject));
  if (lesson) conditions.push(eq(questions.lesson, lesson));
  // Tags are stored as a JSON string like ["a","b","c"]. SQLite doesn't
  // have a native JSON array query, so we do a LIKE match on the quoted
  // tag literal.
  if (tag) {
    const escaped = tag.replace(/"/g, '\\"');
    conditions.push(like(questions.tags, `%"${escaped}"%`));
  }
  if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
  if (bloomLevel) conditions.push(eq(questions.bloomLevel, bloomLevel));
  if (sourceType) conditions.push(eq(questions.sourceType, sourceType));
  if (setId) conditions.push(eq(questions.setId, setId));
  if (folder) {
    conditions.push(
      inArray(
        questions.setId,
        db
          .select({ id: questionSets.id })
          .from(questionSets)
          .where(and(eq(questionSets.folder, folder), eq(questionSets.userId, userId))),
      ),
    );
  }
  if (idsCsv) {
    const ids = idsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) conditions.push(inArray(questions.id, ids));
  }
  // De-crowd: archived sets drop out unless asked for by set or ids, so an
  // archived set can still be opened, exported and restored.
  if (!setId && !idsCsv && sp.get("includeArchived") !== "1") {
    conditions.push(notArchivedQuestion());
  }
  return and(...conditions);
}
