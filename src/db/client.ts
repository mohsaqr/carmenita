import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

/**
 * Singleton Drizzle client wrapping a local `carmenita.db` file via
 * `better-sqlite3`. WAL + foreign keys are enabled for correctness.
 *
 * Why module-level singleton: Next.js dev mode reloads route modules on
 * every request, which would otherwise open a new SQLite handle each
 * time. In production (standalone), this runs once per server process.
 */

type DB = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __carmenitaDb: DB | undefined;
  var __carmenitaSqlite: Database.Database | undefined;
}

function openDb(): { db: DB; sqlite: Database.Database } {
  const dbPath = path.resolve(process.cwd(), "carmenita.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function getClient(): { db: DB; sqlite: Database.Database } {
  if (!globalThis.__carmenitaDb || !globalThis.__carmenitaSqlite) {
    const { db, sqlite } = openDb();
    globalThis.__carmenitaDb = db;
    globalThis.__carmenitaSqlite = sqlite;
  }
  return { db: globalThis.__carmenitaDb, sqlite: globalThis.__carmenitaSqlite };
}

export const db = getClient().db;
export const sqlite = getClient().sqlite;
