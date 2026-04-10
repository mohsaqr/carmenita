#!/usr/bin/env node
/**
 * One-time fix: retroactively assign incrementing timestamps to imported
 * questions that share the same created_at (from batch imports before the
 * 1ms-offset fix). Preserves SQLite rowid order, which matches insertion
 * order (i.e. file order).
 *
 * Usage: node scripts/fix-import-order.mjs
 *
 * Safe to run multiple times — only touches groups of 2+ questions with
 * identical created_at and an import source type.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const DB_PATH = process.argv[2] || "./carmenita.db";
if (!existsSync(DB_PATH)) {
  console.log(`Database not found at ${DB_PATH}, nothing to fix.`);
  process.exit(0);
}

const db = new Database(DB_PATH);

// Find groups of imported questions that share the exact same created_at
const groups = db
  .prepare(
    `SELECT created_at, COUNT(*) AS cnt
     FROM questions
     WHERE source_type IN ('gift-import', 'aiken-import', 'markdown-import')
     GROUP BY created_at
     HAVING cnt > 1
     ORDER BY created_at ASC`,
  )
  .all();

if (groups.length === 0) {
  console.log("No duplicate-timestamp import batches found. Nothing to fix.");
  process.exit(0);
}

const update = db.prepare(
  `UPDATE questions SET created_at = ? WHERE id = ?`,
);

let totalFixed = 0;

const tx = db.transaction(() => {
  for (const { created_at } of groups) {
    // Get questions in this batch ordered by rowid (= insertion order = file order)
    const rows = db
      .prepare(
        `SELECT id, rowid FROM questions
         WHERE created_at = ? AND source_type IN ('gift-import', 'aiken-import', 'markdown-import')
         ORDER BY rowid ASC`,
      )
      .all(created_at);

    const baseTime = new Date(created_at).getTime();
    const total = rows.length;

    for (let i = 0; i < total; i++) {
      // Q1 (first in file) gets highest timestamp so DESC order = file order
      const newTime = new Date(baseTime + (total - 1 - i)).toISOString();
      update.run(newTime, rows[i].id);
    }

    totalFixed += total;
    console.log(`  Fixed ${total} questions at ${created_at}`);
  }
});

tx();
console.log(`Done. Fixed ${totalFixed} questions across ${groups.length} batches.`);
db.close();
