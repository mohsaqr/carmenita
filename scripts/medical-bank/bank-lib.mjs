/**
 * Shared insert + verify for the medical bank scripts (build.mjs, add.mjs).
 *
 * A set source is either
 *   - one JSON file from fetch.py: {"sets": [{name, folder, source, questions}]}
 *     (parsing all 189k questions at once peaks at ~1.2 GB RSS), or
 *   - a directory written by split.mjs: index.json listing each set with
 *     its question count and file, one JSON array of questions per set.
 *     Sets are then read one at a time (peak = the largest set), which is
 *     what to use on a small server.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

/** Apply every pending Drizzle migration (same as create-user.mjs). */
export function migrateDb(sqlite) {
  migrate(drizzle(sqlite), { migrationsFolder: path.join(root, "src/db/migrations") });
}

/**
 * Read a set source (file or split directory, see above) into
 * [{name, folder, source, count, load}] where load() returns the questions.
 */
export function readSetSource(input) {
  if (statSync(input).isDirectory()) {
    const { sets } = JSON.parse(readFileSync(path.join(input, "index.json"), "utf8"));
    return sets.map(({ file, ...meta }) => ({
      ...meta,
      load: () => JSON.parse(readFileSync(path.join(input, file), "utf8")),
    }));
  }
  const { sets } = JSON.parse(readFileSync(input, "utf8"));
  return sets.map(({ questions, ...meta }) => ({ ...meta, count: questions.length, load: () => questions }));
}

/** Write `input` (a fetch.py JSON file) as a split directory for readSetSource. */
export function splitSetSource(input, outDir) {
  const { sets } = JSON.parse(readFileSync(input, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const index = sets.map(({ questions, ...meta }, i) => {
    const file = `set-${String(i + 1).padStart(3, "0")}.json`;
    writeFileSync(path.join(outDir, file), JSON.stringify(questions));
    return { ...meta, count: questions.length, file };
  });
  writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ sets: index }, null, 1));
  return index;
}

/**
 * Insert every set and its questions in ONE transaction, owned by `userId`
 * (null = ownerless) and archived or not, then verify inside that same
 * transaction: any mismatch throws and rolls the whole insert back, so a
 * failed run leaves the database exactly as it was.
 * Returns one row per set: {name, folder, expected, inserted}.
 */
export function insertSets(sqlite, sets, { userId = null, archived = false, now = new Date() } = {}) {
  const insertSet = sqlite.prepare(
    "INSERT INTO question_sets (id, name, folder, created_at, user_id, archived) VALUES (?, ?, ?, ?, ?, ?)",
  );
  // set_archived is written with its correct value so the 0012 insert
  // trigger's WHEN clause is false and it does no extra UPDATE per row.
  const insertQuestion = sqlite.prepare(`
    INSERT INTO questions
      (id, type, question, options, correct_answer, explanation,
       difficulty, bloom_level, subject, lesson, topic, tags,
       source_passage, source_type, source_label, set_id, created_at, user_id, set_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'markdown-import', ?, ?, ?, ?, ?)`);
  const check = sqlite.prepare(`
    SELECT s.user_id AS owner, s.archived AS archived, s.question_count AS storedCount,
           COUNT(q.id) AS n,
           SUM(CASE WHEN q.user_id IS ? AND q.set_archived = s.archived THEN 0 ELSE 1 END) AS mismatched
    FROM question_sets s LEFT JOIN questions q ON q.set_id = s.id
    WHERE s.id = ? GROUP BY s.id`);
  const baseTime = now.getTime();
  // Sets may come from readSetSource (count + lazy load) or as plain
  // {questions} objects; loading inside the loop keeps one set in memory.
  const countOf = (set) => set.count ?? set.questions.length;
  const loadQuestions = (set) => (set.load ? set.load() : set.questions);
  return sqlite.transaction(() => {
    const setIds = sets.map((set) => {
      const setId = randomUUID();
      insertSet.run(setId, set.name, set.folder ?? null, now.toISOString(), userId, archived ? 1 : 0);
      const setQuestions = loadQuestions(set);
      if (setQuestions.length !== countOf(set)) {
        throw new Error(`Set "${set.name}": index says ${countOf(set)} questions, file has ${setQuestions.length} — rolled back`);
      }
      // created_at counts down so the bank's ORDER BY created_at DESC
      // shows each set in dataset order (same trick as the import route).
      const total = setQuestions.length;
      setQuestions.forEach((q, i) => {
        insertQuestion.run(
          randomUUID(), q.type, q.question, JSON.stringify(q.options),
          JSON.stringify(q.correctAnswer), q.explanation, q.difficulty, q.bloomLevel,
          q.subject, q.lesson, q.topic, JSON.stringify(q.tags), q.sourcePassage,
          set.source ?? set.name, setId,
          new Date(baseTime + (total - 1 - i)).toISOString(), userId, archived ? 1 : 0,
        );
      });
      return setId;
    });
    const report = sets.map((s, i) => {
      const r = check.get(userId, setIds[i]);
      const expected = countOf(s);
      if (!r || r.owner !== userId || r.archived !== (archived ? 1 : 0) || r.mismatched || r.n !== expected || r.storedCount !== expected) {
        throw new Error(`Set "${s.name}" failed verification (expected ${expected}): ${JSON.stringify(r)} — rolled back`);
      }
      return { name: s.name, folder: s.folder ?? null, expected, inserted: r.n };
    });
    const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
    if (fk.length) throw new Error(`Foreign key violations: ${fk.length} — rolled back`);
    return report;
  })();
}

/** Whole-database integrity check (run after the insert committed). */
export function checkIntegrity(sqlite) {
  const integrity = sqlite.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`integrity_check: ${integrity}`);
}

/** True when this module file is the script node was started with. */
export function isMain(importMetaUrl) {
  return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
}
