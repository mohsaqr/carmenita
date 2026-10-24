import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { readBuildInfo, EDITION } from "@/lib/build-info";
import { applyMigrations, migrationsFolderFor } from "@/db/apply-migrations";

/**
 * What the mac-push deploy relies on at runtime: the build identity
 * /api/health reports (the release gate matches commit + edition) and
 * the migrations the server applies to the live DB at start.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-deploy-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const MIGRATIONS = migrationsFolderFor(process.cwd());
const journalEntries = (
  JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }
).entries.length;

describe("readBuildInfo", () => {
  it("reports unknown when there is no BUILD_INFO.json (dev, plain next build)", () => {
    const dir = fs.mkdtempSync(path.join(TMP, "none-"));
    expect(readBuildInfo(dir)).toEqual({ version: "unknown", commit: "unknown", builtAt: "unknown", dirty: false });
  });

  it("reads the file the artifact build writes", () => {
    const dir = fs.mkdtempSync(path.join(TMP, "info-"));
    const info = { version: "0.1.0", commit: "2305052", builtAt: "2026-10-24T12:00:00Z", dirty: false };
    fs.writeFileSync(path.join(dir, "BUILD_INFO.json"), JSON.stringify(info));
    expect(readBuildInfo(dir)).toEqual(info);
  });

  it("never passes junk through as a commit", () => {
    const dir = fs.mkdtempSync(path.join(TMP, "junk-"));
    fs.writeFileSync(path.join(dir, "BUILD_INFO.json"), JSON.stringify({ commit: 42, version: "", dirty: "yes" }));
    expect(readBuildInfo(dir)).toMatchObject({ commit: "unknown", version: "unknown", dirty: false });
    fs.writeFileSync(path.join(dir, "BUILD_INFO.json"), "{not json");
    expect(readBuildInfo(dir).commit).toBe("unknown");
  });
});

describe("applyMigrations", () => {
  it("brings an empty DB to the shipped schema, then is a no-op", () => {
    const db = path.join(TMP, "fresh.db");
    expect(applyMigrations(db, MIGRATIONS)).toEqual({ applied: journalEntries });
    expect(applyMigrations(db, MIGRATIONS)).toEqual({ applied: 0 });
    const sqlite = new Database(db, { readonly: true });
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    sqlite.close();
    expect(tables).toEqual(expect.arrayContaining(["questions", "quizzes", "users", "sessions", "app_settings", "question_sets"]));
  });

  it("re-runs only the missing migration, and fails loudly rather than starting half-migrated", () => {
    const db = path.join(TMP, "partial.db");
    applyMigrations(db, MIGRATIONS);
    const sqlite = new Database(db);
    // Forget the newest migration, as if the DB predates it. (Its `id` is
    // declared SERIAL, which SQLite leaves NULL — select by timestamp.)
    const gone = sqlite
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)")
      .run();
    expect(gone.changes).toBe(1);
    sqlite.close();
    // Only 0012 is re-run; its first statement drops an index that no longer exists.
    expect(() => applyMigrations(db, MIGRATIONS)).toThrow(/idx_questions_user_id/);
  });

  it("refuses a folder with no migrations instead of starting on an unknown schema", () => {
    const empty = fs.mkdtempSync(path.join(TMP, "nomig-"));
    expect(() => applyMigrations(path.join(TMP, "x.db"), empty)).toThrow(/No migrations/);
  });
});

describe("GET /api/health", () => {
  it("answers ok with the edition the deploy gate expects and a commit field", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new NextRequest("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, edition: EDITION });
    expect(EDITION).toBe("server");
    expect(typeof body.commit).toBe("string");
  });
});
