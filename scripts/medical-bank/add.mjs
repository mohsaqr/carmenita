#!/usr/bin/env node
/**
 * Add the medical MCQ bank to an EXISTING Carmenita database, in one
 * account's bank, every set ARCHIVED (hidden from the bank list, the
 * taxonomy filters and quick quizzes until the user restores a set).
 *
 * Usage:
 *   CARMENITA_DB=<db> node scripts/medical-bank/add.mjs <questions.json> <username> --backup <path>
 *
 *   <questions.json>  output of scripts/medical-bank/fetch.py, or a directory
 *                     from split.mjs (one set in memory at a time — use this
 *                     on a small server; the single file peaks at ~1.2 GB)
 *   <username>        the account that gets the sets (case-insensitive)
 *   --backup <path>   required; a full online backup of the DB is written
 *                     here first. Must not exist yet.
 *
 * Target DB: $CARMENITA_DB or ./carmenita.db. Applies pending migrations.
 * Refuses if the account already has any of these sets (same name and
 * folder), so running it twice never duplicates 189k questions.
 *
 * STOP THE APP FIRST on a live server: the insert is one transaction that
 * holds SQLite's write lock for its whole duration (seconds for 189k rows),
 * and the app blocks on any write meanwhile (then fails with SQLITE_BUSY).
 * Everything is verified inside that transaction; on any mismatch it rolls
 * back and the database is left as it was.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { checkIntegrity, insertSets, isMain, migrateDb, readSetSource } from "./bank-lib.mjs";

class AddError extends Error {}

/** Add `sets` (archived) to `username`'s bank in `dbPath`; returns the report. */
export async function addBank(sets, dbPath, username, backupPath, now = new Date()) {
  if (!existsSync(dbPath)) throw new AddError(`${dbPath} does not exist`);
  if (!backupPath) throw new AddError("--backup <path> is required");
  if (existsSync(backupPath)) throw new AddError(`${backupPath} already exists — not overwriting`);
  const sqlite = new Database(dbPath, { fileMustExist: true });
  try {
    sqlite.pragma("foreign_keys = ON");
    // The live app may be writing too: wait for its locks instead of failing.
    sqlite.pragma("busy_timeout = 30000");
    const user = sqlite
      .prepare("SELECT id, username FROM users WHERE username_key = ?")
      .get(username.trim().toLowerCase());
    if (!user) throw new AddError(`No account "${username}" in ${dbPath}`);

    // Same matching as the app: case-insensitive name within the same folder.
    const existing = sqlite.prepare(
      `SELECT 1 FROM question_sets WHERE user_id = ? AND lower(name) = lower(?)
       AND (folder IS NULL AND ? IS NULL OR lower(folder) = lower(?))`,
    );
    const clashes = sets.filter((s) => existing.get(user.id, s.name, s.folder ?? null, s.folder ?? null));
    if (clashes.length) {
      throw new AddError(
        `${user.username} already has ${clashes.length} of these sets (e.g. "${clashes[0].name}" in "${clashes[0].folder ?? "no folder"}") — not adding again`,
      );
    }

    await sqlite.backup(backupPath);
    migrateDb(sqlite);
    let report;
    try {
      report = insertSets(sqlite, sets, { userId: user.id, archived: true, now });
    } catch (err) {
      throw new AddError(`Nothing was added: ${err.message}`);
    }
    checkIntegrity(sqlite);
    return { user: user.username, report };
  } finally {
    sqlite.close();
  }
}

/** Split `<json> <user> --backup <path>` (or `--backup=<path>`) in any order. */
export function parseArgs(argv) {
  const eq = argv.find((a) => a.startsWith("--backup="));
  const b = argv.indexOf("--backup");
  const backupPath = eq ? eq.slice("--backup=".length) : b >= 0 ? argv[b + 1] : undefined;
  const positional = argv.filter((a, i) => a !== eq && (b < 0 || (i !== b && i !== b + 1)));
  return { input: positional[0], username: positional[1], backupPath: backupPath || undefined };
}

if (isMain(import.meta.url)) {
  const { input, username, backupPath } = parseArgs(process.argv.slice(2));
  if (!input || !username || !backupPath) {
    console.error("Usage: CARMENITA_DB=<db> node scripts/medical-bank/add.mjs <questions.json> <username> --backup <path>");
    process.exit(1);
  }
  const dbPath = path.resolve(process.env.CARMENITA_DB ?? "carmenita.db");
  try {
    const sets = readSetSource(input);
    const { user, report } = await addBank(sets, dbPath, username, path.resolve(backupPath));
    console.table(report);
    console.log(
      `Added ${report.reduce((a, r) => a + r.inserted, 0)} questions in ${report.length} archived sets to ${user} in ${dbPath} (backup: ${backupPath})`,
    );
  } catch (err) {
    if (!(err instanceof AddError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
