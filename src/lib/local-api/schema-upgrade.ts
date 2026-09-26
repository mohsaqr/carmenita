/**
 * Idempotent schema upgrade for the static build's sql.js database.
 *
 * Browsers keep their own copy of `carmenita.db` in IndexedDB, so a
 * visitor who first loaded an older release has a DB without the
 * tables/columns added since (question sets, app settings). The server
 * build gets these through Drizzle migrations 0005/0006; this function
 * brings a browser copy to the same shape. Safe to run on every load.
 *
 * Takes a minimal adapter rather than a sql.js Database so tests can
 * drive it with better-sqlite3.
 */

export interface SqlAdapter {
  exec(sql: string): void;
  all(sql: string): Array<Record<string, unknown>>;
}

const IMPORT_TYPES = "('gift-import', 'aiken-import', 'markdown-import')";

export function upgradeLocalSchema(db: SqlAdapter): { changed: boolean } {
  const hasTable = (name: string) =>
    db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`).length > 0;
  const hasColumn = (table: string, column: string) =>
    db.all(`PRAGMA table_info(${table})`).some((c) => c.name === column);

  let changed = false;

  if (!hasTable("app_settings")) {
    db.exec(`CREATE TABLE app_settings (
      user_id text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      updated_at text NOT NULL,
      PRIMARY KEY (user_id, key)
    )`);
    changed = true;
  }

  if (!hasTable("question_sets")) {
    db.exec(`CREATE TABLE question_sets (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      folder text,
      created_at text NOT NULL,
      user_id text
    )`);
    db.exec(`CREATE INDEX idx_question_sets_folder ON question_sets (folder)`);
    changed = true;
  }

  if (!hasColumn("questions", "set_id")) {
    db.exec(`ALTER TABLE questions ADD set_id text REFERENCES question_sets(id) ON DELETE cascade`);
    db.exec(`CREATE INDEX idx_questions_set_id ON questions (set_id)`);
    // Same backfill as migration 0006: earlier imports become named sets.
    db.exec(`INSERT INTO question_sets (id, name, folder, created_at, user_id)
      SELECT lower(hex(randomblob(16))), COALESCE(source_label, 'Untitled import'), NULL, MIN(created_at), NULL
      FROM questions WHERE source_type IN ${IMPORT_TYPES}
      GROUP BY COALESCE(source_label, 'Untitled import')`);
    db.exec(`UPDATE questions SET set_id = (
        SELECT s.id FROM question_sets s
        WHERE s.name = COALESCE(questions.source_label, 'Untitled import')
      ) WHERE source_type IN ${IMPORT_TYPES}`);
    changed = true;
  }

  // Migration 0007 (per-user banks) added question_sets.received_from.
  // The static build has no accounts, but the column must exist so the
  // shared SELECTs match the server schema.
  if (!hasColumn("question_sets", "received_from")) {
    db.exec(`ALTER TABLE question_sets ADD received_from text`);
    changed = true;
  }

  return { changed };
}
