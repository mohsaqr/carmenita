import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { upgradeLocalSchema } from "@/lib/local-api/schema-upgrade";
import { serializeMarkdown } from "@/lib/formats/markdown";

/**
 * Auth (users + sessions), per-user settings, question sets, the named
 * import contract, the login proxy, and both schema-upgrade paths
 * (Drizzle migration 0006 and the static build's upgradeLocalSchema).
 *
 * Same pattern as analytics.test.ts: a temp SQLite DB with the real
 * migrations, installed as the global Drizzle singleton BEFORE the
 * modules under test are dynamically imported.
 */

const MIGRATIONS = path.join(process.cwd(), "src/db/migrations");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-auth-"));
const TEST_DB_PATH = path.join(TMP, "test.db");

const sqlite = new Database(TEST_DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });

declare global {
  var __carmenitaDb: typeof testDb | undefined;
  var __carmenitaSqlite: Database.Database | undefined;
}
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: MIGRATIONS });

const { hashPassword, verifyPassword } = await import("@/lib/password");
const auth = await import("@/lib/auth");
const settings = await import("@/lib/settings-store");
const sets = await import("@/lib/question-sets");
const { POST: importRoute } = await import("@/app/api/bank/import/route");
const { proxy } = await import("@/proxy");
const { PROMPTS } = await import("@/lib/prompts");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Apply migration .sql files by index range, the way drizzle does. */
function applySqlMigrations(db: Database.Database, upToIndex: number, fromIndex = 0) {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .filter((f) => {
      const n = Number(f.slice(0, 4));
      return n >= fromIndex && n <= upToIndex;
    });
  files.forEach((f) => {
    fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
      .split("--> statement-breakpoint")
      .map((stmt) => stmt.trim())
      .filter(Boolean)
      .forEach((stmt) => db.exec(stmt));
  });
}

/** An old-schema (pre-sets) DB holding two labelled imports + one manual question. */
function makeLegacyDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  applySqlMigrations(db, 4);
  const insert = db.prepare(
    `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty,
       bloom_level, topic, tags, source_passage, source_type, source_label, created_at)
     VALUES (?, 'mcq-single', 'Q?', '["a","b"]', '0', '', 'easy', 'remember', 't', '[]', '', ?, ?, ?)`,
  );
  insert.run("q1", "markdown-import", "Genetics", "2026-01-01T00:00:00.000Z");
  insert.run("q2", "markdown-import", "Genetics", "2026-01-01T00:00:00.001Z");
  insert.run("q3", "gift-import", null, "2026-01-02T00:00:00.000Z");
  insert.run("q4", "manual", "sample", "2026-01-03T00:00:00.000Z");
  return db;
}

// The account that owns the set/import fixtures below (private banks).
const OWNER = auth.upsertUser("set-owner", "owner-pass-1");
const OWNER_TOKEN = auth.createSession(OWNER.id).token;

function insertQuestion(setId: string | null, id = randomUUID(), userId: string = OWNER.id) {
  sqlite
    .prepare(
      `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty,
         bloom_level, topic, tags, source_passage, source_type, set_id, created_at, user_id)
       VALUES (?, 'mcq-single', 'Q?', '["a","b"]', '0', '', 'easy', 'remember', 't', '[]', '', 'markdown-import', ?, ?, ?)`,
    )
    .run(id, setId, new Date().toISOString(), userId);
  return id;
}

// Built with the real serializer so the fixture can't drift from the parser.
const MD_ONE_QUESTION = serializeMarkdown([
  {
    type: "mcq-single",
    question: "What is the capital of France?",
    options: ["Berlin", "Paris", "London"],
    correctAnswer: 1,
    explanation: "Paris is the capital.",
    difficulty: "easy",
    bloomLevel: "remember",
    subject: null,
    lesson: null,
    topic: "capitals",
    tags: ["geography", "europe"],
    sourcePassage: "Paris is the capital of France.",
  },
]);

function importReq(body: unknown, token: string | null = OWNER_TOKEN) {
  return new NextRequest("http://localhost/api/bank/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `${auth.SESSION_COOKIE}=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", () => {
    const h = hashPassword("Test-Pass-42");
    expect(h).toMatch(/^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword("Test-Pass-42", h)).toBe(true);
    expect(verifyPassword("test-pass-42", h)).toBe(false);
    expect(verifyPassword("", h)).toBe(false);
  });

  it("salts: the same password hashes differently each time", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("rejects malformed stored hashes instead of throwing", () => {
    ["", "plain", "scrypt$abc$00$00", "bcrypt$16384$00$00", "scrypt$16384$$"].forEach((bad) =>
      expect(verifyPassword("x", bad)).toBe(false),
    );
  });

  it("accepts a hash produced by scripts/create-user.mjs (format interop)", () => {
    const dbFile = path.join(TMP, "script-user.db");
    execFileSync("node", ["scripts/create-user.mjs", "ScriptUser", "s3cret-pass"], {
      env: { ...process.env, CARMENITA_DB: dbFile },
      stdio: "pipe",
    });
    const db = new Database(dbFile);
    const row = db.prepare("SELECT username, username_key, password_hash FROM users").get() as {
      username: string;
      username_key: string;
      password_hash: string;
    };
    db.close();
    expect(row.username).toBe("ScriptUser");
    expect(row.username_key).toBe("scriptuser");
    expect(verifyPassword("s3cret-pass", row.password_hash)).toBe(true);
    expect(verifyPassword("wrong", row.password_hash)).toBe(false);
  });
});

describe("users and sessions", () => {
  it("authenticates case-insensitively on username, exactly on password", () => {
    const u = auth.upsertUser("TestUser", "Test-Pass-42");
    expect(auth.authenticate("testuser", "Test-Pass-42")).toEqual(u);
    expect(auth.authenticate("TESTUSER", "Test-Pass-42")?.id).toBe(u.id);
    expect(auth.authenticate("TestUser", "wrong")).toBeNull();
    expect(auth.authenticate("nobody", "Test-Pass-42")).toBeNull();
  });

  it("upsert on an existing username resets the password, keeps the id", () => {
    const a = auth.upsertUser("resetme", "first-pass");
    const b = auth.upsertUser("ResetMe", "second-pass");
    expect(b.id).toBe(a.id);
    expect(auth.authenticate("resetme", "first-pass")).toBeNull();
    expect(auth.authenticate("resetme", "second-pass")?.id).toBe(a.id);
  });

  it("rejects empty usernames and short passwords", () => {
    expect(() => auth.upsertUser("  ", "long-enough")).toThrow();
    expect(() => auth.upsertUser("x", "123")).toThrow();
  });

  it("session token resolves to its user until logout; DB stores only a hash", () => {
    const u = auth.upsertUser("session-user", "pass-word");
    const { token } = auth.createSession(u.id);
    expect(auth.getUserBySessionToken(token)).toEqual(u);
    const stored = sqlite.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>;
    expect(stored.map((r) => r.id)).not.toContain(token);
    auth.deleteSession(token);
    expect(auth.getUserBySessionToken(token)).toBeNull();
  });

  it("expired sessions and junk tokens resolve to nobody", () => {
    const u = auth.upsertUser("expiry-user", "pass-word");
    const past = new Date(Date.now() - auth.SESSION_TTL_MS - 60_000);
    const { token } = auth.createSession(u.id, past);
    expect(auth.getUserBySessionToken(token)).toBeNull();
    expect(auth.getUserBySessionToken("not-a-token")).toBeNull();
    expect(auth.getUserBySessionToken(undefined)).toBeNull();
  });
});

describe("login proxy", () => {
  const u = auth.upsertUser("proxy-user", "pass-word");
  const { token } = auth.createSession(u.id);
  const withCookie = (url: string) =>
    new NextRequest(url, { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } });

  it("redirects signed-out page requests to /login with ?next", () => {
    const res = proxy(new NextRequest("http://localhost/bank?x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/bank?x=1");
  });

  it("answers signed-out API calls with 401 JSON", async () => {
    const res = proxy(new NextRequest("http://localhost/api/bank/questions"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in" });
  });

  it("lets the login page and login endpoint through while signed out", () => {
    expect(proxy(new NextRequest("http://localhost/login")).headers.get("x-middleware-next")).toBe("1");
    expect(
      proxy(new NextRequest("http://localhost/api/auth/login", { method: "POST" })).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });

  it("passes requests that carry a valid session cookie", () => {
    expect(proxy(withCookie("http://localhost/bank")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(withCookie("http://localhost/api/bank/sets")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("per-user settings", () => {
  it("stores JSON values per user and keeps users isolated", () => {
    settings.setSetting("u1", "carmenita-storage", { activeProviderId: "openai", n: 1 });
    settings.setSetting("u2", "carmenita-storage", { activeProviderId: "anthropic" });
    expect(settings.getSetting("u1", "carmenita-storage")).toEqual({ activeProviderId: "openai", n: 1 });
    expect(settings.getSetting("u2", "carmenita-storage")).toEqual({ activeProviderId: "anthropic" });
    expect(settings.getSetting("u3", "carmenita-storage")).toBeNull();
  });

  it("upserts on repeat writes and deletes cleanly", () => {
    settings.setSetting("u1", "k", "a");
    settings.setSetting("u1", "k", "b");
    expect(settings.listSettings("u1").k).toBe("b");
    settings.deleteSetting("u1", "k");
    expect(settings.getSetting("u1", "k")).toBeNull();
  });

  it("resolvePrompt returns the user's override, else the default", () => {
    const id = "carmenita.mcq.topic";
    const def = PROMPTS[id].defaultValue;
    expect(settings.resolvePrompt(null, id)).toBe(def);
    expect(settings.resolvePrompt("u1", id)).toBe(def);
    settings.setSetting("u1", `prompt:${id}`, "MY PROMPT {topic}");
    expect(settings.resolvePrompt("u1", id)).toBe("MY PROMPT {topic}");
    expect(settings.resolvePrompt("u2", id)).toBe(def);
    settings.setSetting("u1", `prompt:${id}`, "   ");
    expect(settings.resolvePrompt("u1", id)).toBe(def); // blank override ignored
    expect(() => settings.resolvePrompt("u1", "no.such.prompt")).toThrow();
  });

  it("settings keys are validated", () => {
    expect(settings.SETTINGS_KEY_PATTERN.test("prompt:carmenita.mcq.topic")).toBe(true);
    expect(settings.SETTINGS_KEY_PATTERN.test("carmenita-storage")).toBe(true);
    expect(settings.SETTINGS_KEY_PATTERN.test("../etc")).toBe(false);
    expect(settings.SETTINGS_KEY_PATTERN.test("")).toBe(false);
  });
});

describe("question sets", () => {
  it("findOrCreateSet is idempotent per (name, folder), case-insensitive", () => {
    const a = sets.findOrCreateSet(OWNER.id, "Chapter 1", "Pathology");
    const b = sets.findOrCreateSet(OWNER.id, "  chapter 1 ", "pathology");
    const c = sets.findOrCreateSet(OWNER.id, "Chapter 1", null);
    const d = sets.findOrCreateSet(OWNER.id, "Chapter 1", "  ");
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect(c.id).not.toBe(a.id); // same name, different folder = different set
    expect(d).toEqual({ id: c.id, created: false }); // blank folder == no folder
    expect(() => sets.findOrCreateSet(OWNER.id, "   ", null)).toThrow();
  });

  it("listSets counts questions and orders folders first, alphabetically", () => {
    const s1 = sets.findOrCreateSet(OWNER.id, "Zeta set", "anatomy");
    insertQuestion(s1.id);
    insertQuestion(s1.id);
    const listed = sets.listSets(OWNER.id);
    expect(listed.find((s) => s.id === s1.id)?.questionCount).toBe(2);
    const folders = listed.map((s) => s.folder);
    const firstNull = folders.indexOf(null);
    expect(folders.slice(firstNull).every((f) => f === null)).toBe(true);
    const named = folders.slice(0, firstNull) as string[];
    expect(named).toEqual([...named].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
  });

  it("updateSet renames (syncing source_label) and moves between folders", () => {
    const s = sets.findOrCreateSet(OWNER.id, "Old name", "tmp");
    const qid = insertQuestion(s.id);
    const renamed = sets.updateSet(OWNER.id, s.id, { name: "New name", folder: "" });
    expect(renamed).toMatchObject({ id: s.id, name: "New name", folder: null, questionCount: 1 });
    const label = sqlite.prepare("SELECT source_label FROM questions WHERE id = ?").get(qid) as {
      source_label: string;
    };
    expect(label.source_label).toBe("New name");
    expect(sets.updateSet(OWNER.id, "missing-id", { name: "x" })).toBeNull();
    expect(() => sets.updateSet(OWNER.id, s.id, { name: " " })).toThrow();
  });

  it("deleteSet removes the set, its questions and their quiz links, nothing else", () => {
    const doomed = sets.findOrCreateSet(OWNER.id, "Doomed", "tmp");
    const keep = sets.findOrCreateSet(OWNER.id, "Keeper", "tmp");
    const q1 = insertQuestion(doomed.id);
    const q2 = insertQuestion(doomed.id);
    const qKeep = insertQuestion(keep.id);
    const quizId = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO quizzes (id, title, settings, provider, model, created_at, user_id) VALUES (?, 'Q', '{}', 'bank', 'bank', ?, ?)`,
      )
      .run(quizId, new Date().toISOString(), OWNER.id);
    const link = sqlite.prepare("INSERT INTO quiz_questions (quiz_id, question_id, idx) VALUES (?, ?, ?)");
    link.run(quizId, q1, 0);
    link.run(quizId, qKeep, 1);

    expect(sets.deleteSet(OWNER.id, doomed.id)).toEqual({ questionsDeleted: 2 });
    const remaining = (sql: string, ...p: string[]) =>
      (sqlite.prepare(sql).get(...p) as { n: number }).n;
    expect(remaining("SELECT COUNT(*) n FROM questions WHERE id IN (?, ?)", q1, q2)).toBe(0);
    expect(remaining("SELECT COUNT(*) n FROM questions WHERE id = ?", qKeep)).toBe(1);
    expect(remaining("SELECT COUNT(*) n FROM quiz_questions WHERE quiz_id = ?", quizId)).toBe(1);
    expect(remaining("SELECT COUNT(*) n FROM question_sets WHERE id = ?", doomed.id)).toBe(0);
    expect(sets.deleteSet(OWNER.id, doomed.id)).toBeNull();
  });

  it("renameFolder moves every set in a folder", () => {
    sets.findOrCreateSet(OWNER.id, "A", "Histo");
    sets.findOrCreateSet(OWNER.id, "B", "histo");
    expect(sets.renameFolder(OWNER.id, "HISTO", "Histology")).toBe(2);
    expect(sets.listSets(OWNER.id).filter((s) => s.folder === "Histology")).toHaveLength(2);
  });
});

describe("POST /api/bank/import (named sets)", () => {
  it("rejects an import without a set name", async () => {
    const res = await importRoute(importReq({ format: "markdown", text: MD_ONE_QUESTION }));
    expect(res.status).toBe(400);
    const res2 = await importRoute(importReq({ format: "markdown", text: MD_ONE_QUESTION, setName: "   " }));
    expect(res2.status).toBe(400);
  });

  it("creates the set, files it in the folder, and tags every question with it", async () => {
    const res = await importRoute(
      importReq({ format: "markdown", text: MD_ONE_QUESTION, setName: "Capitals", folder: "Geography" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ imported: 1, setCreated: true });
    const set = sets.listSets(OWNER.id).find((s) => s.id === data.setId);
    expect(set).toMatchObject({ name: "Capitals", folder: "Geography", questionCount: 1 });
    const q = sqlite.prepare("SELECT set_id, source_label FROM questions WHERE id = ?").get(data.ids[0]);
    expect(q).toEqual({ set_id: data.setId, source_label: "Capitals" });
  });

  it("re-importing under the same name + folder appends to the same set", async () => {
    const res = await importRoute(
      importReq({ format: "markdown", text: MD_ONE_QUESTION, setName: "capitals", folder: "geography" }),
    );
    const data = await res.json();
    expect(data.setCreated).toBe(false);
    expect(sets.listSets(OWNER.id).find((s) => s.id === data.setId)?.questionCount).toBe(2);
  });

  it("leaves no empty set behind when the text has no questions", async () => {
    const before = sets.listSets(OWNER.id).length;
    const res = await importRoute(importReq({ format: "markdown", text: "nothing here", setName: "Ghost" }));
    expect(res.status).toBe(400);
    expect(sets.listSets(OWNER.id).length).toBe(before);
  });
});

describe("schema upgrade of pre-sets databases", () => {
  it("migration 0006 turns earlier imports into named sets", () => {
    const db = makeLegacyDb(path.join(TMP, "legacy-mig.db"));
    applySqlMigrations(db, 6, 5);
    const setRows = db.prepare("SELECT name, folder FROM question_sets ORDER BY name").all();
    expect(setRows).toEqual([
      { name: "Genetics", folder: null },
      { name: "Untitled import", folder: null },
    ]);
    const qs = db
      .prepare("SELECT q.id, s.name FROM questions q LEFT JOIN question_sets s ON s.id = q.set_id ORDER BY q.id")
      .all();
    expect(qs).toEqual([
      { id: "q1", name: "Genetics" },
      { id: "q2", name: "Genetics" },
      { id: "q3", name: "Untitled import" },
      { id: "q4", name: null }, // manual questions are not in a set
    ]);
    // Cascade is present on the added FK column.
    const fk = db.prepare("PRAGMA foreign_key_list(questions)").all() as Array<{ table: string; on_delete: string }>;
    expect(fk.find((f) => f.table === "question_sets")?.on_delete).toBe("CASCADE");
    db.close();
  });

  it("upgradeLocalSchema (static build) produces the same result and is idempotent", () => {
    const db = makeLegacyDb(path.join(TMP, "legacy-static.db"));
    const adapter = {
      exec: (s: string) => db.exec(s),
      all: (s: string) => db.prepare(s).all() as Array<Record<string, unknown>>,
    };
    expect(upgradeLocalSchema(adapter).changed).toBe(true);
    expect(upgradeLocalSchema(adapter).changed).toBe(false);
    const counts = db
      .prepare("SELECT s.name, COUNT(q.id) n FROM question_sets s JOIN questions q ON q.set_id = s.id GROUP BY s.name ORDER BY s.name")
      .all();
    expect(counts).toEqual([
      { name: "Genetics", n: 2 },
      { name: "Untitled import", n: 1 },
    ]);
    expect(db.prepare("SELECT COUNT(*) n FROM app_settings").get()).toEqual({ n: 0 });
    db.close();
  });
});
