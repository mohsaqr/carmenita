#!/usr/bin/env node
/**
 * Build a NEW Carmenita database holding the medical MCQ bank.
 *
 * Usage: node scripts/medical-bank/build.mjs <questions.json> <out.db>
 *   <questions.json> comes from scripts/medical-bank/fetch.py.
 *
 * The database gets the app's real schema (all Drizzle migrations) and
 * one question set per entry, but NO accounts: every row is ownerless,
 * like the public seed. The first account created on it with
 * `CARMENITA_DB=<out.db> node scripts/create-user.mjs <name>` takes
 * ownership of everything. Refuses to touch an existing file.
 * To add the bank to an existing database instead, use add.mjs.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { checkIntegrity, insertSets, isMain, migrateDb, readSetSource } from "./bank-lib.mjs";

/** Create `dbPath` with `sets` in it; returns the per-set report. */
export function buildBank(sets, dbPath, now = new Date()) {
  if (existsSync(dbPath)) throw new Error(`${dbPath} already exists — not overwriting`);
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    migrateDb(sqlite);
    const report = insertSets(sqlite, sets, { now });
    checkIntegrity(sqlite);
    sqlite.exec("VACUUM");
    return report;
  } finally {
    sqlite.close();
  }
}

if (isMain(import.meta.url)) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) {
    console.error("Usage: node scripts/medical-bank/build.mjs <questions.json> <out.db>");
    process.exit(1);
  }
  const sets = readSetSource(input);
  const report = buildBank(sets, path.resolve(out));
  console.table(report);
  console.log(`${report.reduce((a, r) => a + r.inserted, 0)} questions in ${report.length} sets → ${out}`);
}
