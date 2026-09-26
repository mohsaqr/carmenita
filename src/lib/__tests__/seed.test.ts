import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getStaticQuizIds } from "@/lib/local-api/static-params";

/**
 * The public seed (seed/carmenita.seed.db) is committed and shipped to
 * every GitHub Pages visitor, so it must never contain accounts,
 * sessions or settings (LLM API keys). These tests cover the script that
 * produces it, the build-time reader, and the committed file itself.
 */

const ROOT = process.cwd();
const COMMITTED_SEED = path.join(ROOT, "seed", "carmenita.seed.db");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-seed-"));
const SENSITIVE = ["users", "sessions", "app_settings"] as const;

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** A migrated DB (WAL mode, like the live one) with secrets and one quiz. */
function makeSourceDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite), { migrationsFolder: path.join(ROOT, "src/db/migrations") });
  const now = new Date().toISOString();
  sqlite
    .prepare("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ('u1', 'A', 'a', 'scrypt$16384$aa$bb', ?)")
    .run(now);
  sqlite.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s1', 'u1', ?, ?)").run(now, now);
  sqlite
    .prepare("INSERT INTO app_settings (user_id, key, value, updated_at) VALUES ('u1', 'carmenita-storage', '{\"apiKey\":\"sk-SECRET-123\"}', ?)")
    .run(now);
  sqlite
    .prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at) VALUES ('quiz-1', 'Q', '{}', 'bank', 'bank', ?)")
    .run(now);
  sqlite
    .prepare("INSERT INTO quizzes (id, title, settings, provider, model, created_at, deleted_at) VALUES ('quiz-trashed', 'T', '{}', 'bank', 'bank', ?, ?)")
    .run(now, now);
  return sqlite; // left open so rows may still sit in the WAL file
}

describe("scripts/make-seed.mjs", () => {
  it("strips accounts, sessions and settings but keeps content", () => {
    const src = path.join(TMP, "live.db");
    const out = path.join(TMP, "out", "seed.db");
    const live = makeSourceDb(src);
    execFileSync("node", ["scripts/make-seed.mjs", src, out], { stdio: "pipe" });
    live.close();

    const seed = new Database(out, { readonly: true });
    SENSITIVE.forEach((t) => expect(count(seed, t)).toBe(0));
    expect(count(seed, "quizzes")).toBe(2); // content preserved, WAL rows included
    expect(seed.pragma("journal_mode", { simple: true })).toBe("delete"); // single-file seed
    seed.close();

    // VACUUM means the deleted secrets are not recoverable from free pages.
    const bytes = fs.readFileSync(out).toString("latin1");
    expect(bytes).not.toContain("sk-SECRET-123");
    expect(bytes).not.toContain("scrypt$16384$aa$bb");
    expect(fs.existsSync(`${out}.tmp`)).toBe(false);
  });

  it("fails loudly when the source DB is missing", () => {
    expect(() =>
      execFileSync("node", ["scripts/make-seed.mjs", path.join(TMP, "missing.db"), path.join(TMP, "x.db")], {
        stdio: "pipe",
      }),
    ).toThrow();
  });
});

describe("getStaticQuizIds", () => {
  it("reads non-deleted quiz ids from $CARMENITA_SEED_DB", async () => {
    const file = path.join(TMP, "params.db");
    makeSourceDb(file).close();
    process.env.CARMENITA_SEED_DB = file;
    try {
      expect(await getStaticQuizIds()).toEqual(["quiz-1"]);
    } finally {
      delete process.env.CARMENITA_SEED_DB;
    }
  });

  it("returns the sentinel when the seed is missing", async () => {
    process.env.CARMENITA_SEED_DB = path.join(TMP, "does-not-exist.db");
    try {
      expect(await getStaticQuizIds()).toEqual(["_"]);
    } finally {
      delete process.env.CARMENITA_SEED_DB;
    }
  });
});

describe("committed seed/carmenita.seed.db", () => {
  it("exists and carries no accounts, sessions or settings", () => {
    expect(fs.existsSync(COMMITTED_SEED)).toBe(true);
    const seed = new Database(COMMITTED_SEED, { readonly: true });
    SENSITIVE.forEach((t) => expect(count(seed, t)).toBe(0));
    seed.close();
    expect(fs.readFileSync(COMMITTED_SEED).toString("latin1")).not.toContain("scrypt$");
  });
});
