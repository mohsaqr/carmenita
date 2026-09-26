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
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SENSITIVE_TABLES = ["sessions", "users", "app_settings"];

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
const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
SENSITIVE_TABLES.forEach((t) => {
  if (exists.get(t)) db.prepare(`DELETE FROM ${t}`).run();
});
db.exec("VACUUM");
const counts = ["questions", "question_sets", "quizzes", "attempts"]
  .filter((t) => exists.get(t))
  .map((t) => `${t}=${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`);
db.close();

fs.renameSync(tmp, target);
console.log(`Wrote ${path.relative(root, target)} (${counts.join(", ")}; users/sessions/app_settings stripped)`);
