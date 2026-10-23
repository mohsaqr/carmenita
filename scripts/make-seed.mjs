#!/usr/bin/env node
/**
 * Write the public seed database from the local working DB.
 *
 * Usage: node scripts/make-seed.mjs [source.db] [target.db]
 *   defaults: ./carmenita.db → ./seed/carmenita.seed.db
 *
 * The seed is COMMITTED and PUBLISHED (GitHub Pages ships it to every
 * visitor, and fresh server installs start from it), so it must never
 * contain accounts, sessions or per-user settings (LLM API keys). This
 * script copies via SQLite's online backup API (safe with WAL), wipes
 * those tables, and VACUUMs so the deleted rows aren't recoverable from
 * free pages. `carmenita.db` itself is gitignored — it's live data.
 *
 * Archived sets (and their questions) are left out: they are material a
 * user tucked away — e.g. the 189k-question medical benchmark bank —
 * not demo content, and would make the seed far too big to publish.
 * The script refuses to write a seed larger than MAX_SEED_BYTES.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SENSITIVE_TABLES = ["sessions", "users", "app_settings"];
const MAX_SEED_BYTES = 25 * 1024 * 1024;

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = path.resolve(process.argv[2] ?? path.join(root, "carmenita.db"));
const target = path.resolve(process.argv[3] ?? path.join(root, "seed", "carmenita.seed.db"));

if (!fs.existsSync(source)) {
  console.error(`Source DB not found: ${source}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
const tmp = `${target}.tmp`;
fs.rmSync(tmp, { force: true });

const src = new Database(source, { readonly: true, fileMustExist: true });
await src.backup(tmp);
src.close();

const db = new Database(tmp);
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON"); // deleting a set cascades to its questions
const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
SENSITIVE_TABLES.forEach((t) => {
  if (exists.get(t)) db.prepare(`DELETE FROM ${t}`).run();
});
// Content is per-user on the server. The seed publishes no account ids;
// the first account created from it takes ownership (create-user.mjs).
["question_sets", "questions", "quizzes", "attempts", "documents"].forEach((t) => {
  if (exists.get(t)) db.prepare(`UPDATE ${t} SET user_id = NULL`).run();
});
let archivedSetsDropped = 0;
if (exists.get("question_sets")) {
  const cols = db.prepare("PRAGMA table_info(question_sets)").all().map((c) => c.name);
  if (cols.includes("received_from")) db.prepare("UPDATE question_sets SET received_from = NULL").run();
  if (cols.includes("archived")) {
    archivedSetsDropped = db.prepare("DELETE FROM question_sets WHERE archived = 1").run().changes;
  }
}
db.exec("VACUUM");
const counts = ["questions", "question_sets", "quizzes", "attempts"]
  .filter((t) => exists.get(t))
  .map((t) => `${t}=${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`);
db.close();

const bytes = fs.statSync(tmp).size;
if (bytes > MAX_SEED_BYTES) {
  fs.rmSync(tmp, { force: true });
  console.error(
    `Refusing to write the seed: ${(bytes / 1048576).toFixed(1)} MB is over the ${MAX_SEED_BYTES / 1048576} MB limit (${counts.join(", ")}). ` +
      "Archive or delete the large sets in the source DB first, or pass a smaller source.",
  );
  process.exit(1);
}
fs.renameSync(tmp, target);
console.log(
  `Wrote ${path.relative(root, target)} (${counts.join(", ")}; users/sessions/app_settings stripped` +
    `${archivedSetsDropped ? `; ${archivedSetsDropped} archived sets left out` : ""})`,
);
