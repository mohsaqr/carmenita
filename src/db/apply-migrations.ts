import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Brings the database up to the schema this build ships, at server start.
 *
 * The mac-push deploy ships a built bundle and never runs `npm run
 * db:migrate` on the server, so the server applies its own pending
 * migrations before it takes requests. It uses the same `__drizzle_migrations`
 * journal as drizzle-kit and `scripts/create-user.mjs`, so the three agree on
 * what has run. Throws on failure: a server that can't migrate must not start
 * (the deploy's health gate then rolls the release back).
 */
export function applyMigrations(dbPath: string, migrationsFolder: string): { applied: number } {
  const journal = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journal)) {
    throw new Error(`No migrations at ${migrationsFolder} (missing meta/_journal.json)`);
  }
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const count = () => countApplied(sqlite);
    const before = count();
    migrate(drizzle(sqlite), { migrationsFolder });
    return { applied: count() - before };
  } finally {
    sqlite.close();
  }
}

function countApplied(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
}

/** Where a build's migrations live: `src/db/migrations` under the server's cwd. */
export function migrationsFolderFor(cwd = process.cwd()): string {
  return path.join(cwd, "src", "db", "migrations");
}
