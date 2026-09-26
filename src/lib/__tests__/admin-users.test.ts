import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

/**
 * Admin account management: only admins can list/create accounts and
 * reset passwords (through the real route handlers), duplicates and weak
 * passwords are refused, a reset signs the user out everywhere, and the
 * first account becomes admin (migration 0008 and create-user.mjs).
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "src/db/migrations");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-admin-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: MIGRATIONS });

const auth = await import("@/lib/auth");
const usersRoute = await import("@/app/api/admin/users/route");
const resetRoute = await import("@/app/api/admin/users/[id]/password/route");
const meRoute = await import("@/app/api/auth/me/route");
const passwordRoute = await import("@/app/api/auth/password/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Admin + regular user, as the live install will have them.
const admin = auth.createUser("Chief", "chief-pass-1", { isAdmin: true });
const member = auth.createUser("Member", "member-pass-1");
const adminToken = auth.createSession(admin.id).token;
const memberToken = auth.createSession(member.id).token;

function req(url: string, token: string | null, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `${auth.SESSION_COOKIE}=${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("who may manage users", () => {
  it("/api/auth/me reports the admin flag", async () => {
    expect((await (await meRoute.GET(req("/api/auth/me", adminToken))).json()).user).toMatchObject({ username: "Chief", isAdmin: true });
    expect((await (await meRoute.GET(req("/api/auth/me", memberToken))).json()).user).toMatchObject({ username: "Member", isAdmin: false });
  });

  it("non-admins get 403, signed-out 401, on every admin route", async () => {
    expect((await usersRoute.GET(req("/api/admin/users", memberToken))).status).toBe(403);
    expect((await usersRoute.POST(req("/api/admin/users", memberToken, { username: "x", password: "long-enough" }))).status).toBe(403);
    expect((await resetRoute.POST(req(`/api/admin/users/${admin.id}/password`, memberToken, { password: "long-enough" }), params(admin.id))).status).toBe(403);
    expect((await usersRoute.GET(req("/api/admin/users", null))).status).toBe(401);
    // The member's attempt changed nothing: the admin's password still works.
    expect(auth.authenticate("Chief", "chief-pass-1")?.id).toBe(admin.id);
  });
});

describe("creating accounts", () => {
  it("admin lists every account with bank size", async () => {
    const res = await usersRoute.GET(req("/api/admin/users", adminToken));
    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users.map((u: { username: string }) => u.username)).toEqual(["Chief", "Member"]);
    expect(users[0]).toMatchObject({ isAdmin: true, questionCount: 0 });
  });

  it("bank sizes are counted per account (not always 0)", async () => {
    const insert = sqlite.prepare(
      `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty, bloom_level, topic, tags, source_passage, source_type, created_at, user_id)
       VALUES (?, 'mcq-single', 'Q?', '["a","b"]', '0', '', 'easy', 'remember', 't', '[]', '', 'manual', '2026-01-01', ?)`,
    );
    ["c1", "c2", "c3"].forEach((id) => insert.run(id, admin.id));
    insert.run("m1", member.id);
    const { users } = await (await usersRoute.GET(req("/api/admin/users", adminToken))).json();
    const size = (name: string) => users.find((u: { username: string }) => u.username === name)?.questionCount;
    expect(size("Chief")).toBe(3);
    expect(size("Member")).toBe(1);
  });

  it("admin creates a user who can sign in and starts with an empty bank", async () => {
    const res = await usersRoute.POST(req("/api/admin/users", adminToken, { username: "  Newbie ", password: "newbie-pass" }));
    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user).toMatchObject({ username: "Newbie", isAdmin: false });
    expect(auth.authenticate("newbie", "newbie-pass")?.id).toBe(user.id);
    const n = (sqlite.prepare("SELECT COUNT(*) AS n FROM questions WHERE user_id = ?").get(user.id) as { n: number }).n;
    expect(n).toBe(0);
  });

  it("admin can create another admin", async () => {
    const res = await usersRoute.POST(req("/api/admin/users", adminToken, { username: "Deputy", password: "deputy-pass", isAdmin: true }));
    expect((await res.json()).user).toMatchObject({ username: "Deputy", isAdmin: true });
  });

  it("refuses duplicates (case-insensitive) without touching the existing account", async () => {
    const res = await usersRoute.POST(req("/api/admin/users", adminToken, { username: "MEMBER", password: "other-pass-1" }));
    expect(res.status).toBe(409);
    expect(auth.authenticate("Member", "member-pass-1")?.id).toBe(member.id); // old password still valid
    expect(auth.authenticate("Member", "other-pass-1")).toBeNull();
  });

  it("refuses empty usernames and short passwords", async () => {
    expect((await usersRoute.POST(req("/api/admin/users", adminToken, { username: "   ", password: "long-enough" }))).status).toBe(400);
    expect((await usersRoute.POST(req("/api/admin/users", adminToken, { username: "shorty", password: "12345" }))).status).toBe(400);
    expect((await usersRoute.POST(req("/api/admin/users", adminToken, { username: "nopass" }))).status).toBe(400);
    expect(auth.findUserByUsername("shorty")).toBeNull();
  });
});

describe("resetting passwords", () => {
  it("sets the new password, invalidates the old one, and signs the user out", async () => {
    const target = auth.createUser("Forgetful", "old-pass-1");
    const targetToken = auth.createSession(target.id).token;
    const res = await resetRoute.POST(req(`/api/admin/users/${target.id}/password`, adminToken, { password: "new-pass-1" }), params(target.id));
    expect(res.status).toBe(200);
    expect(auth.authenticate("Forgetful", "old-pass-1")).toBeNull();
    expect(auth.authenticate("Forgetful", "new-pass-1")?.id).toBe(target.id);
    expect(auth.getUserBySessionToken(targetToken)).toBeNull();
    // The admin's own session is untouched.
    expect(auth.getUserBySessionToken(adminToken)?.id).toBe(admin.id);
  });

  it("404 for an unknown user, 400 for a short password", async () => {
    expect((await resetRoute.POST(req("/api/admin/users/nope/password", adminToken, { password: "long-enough" }), params("nope"))).status).toBe(404);
    expect((await resetRoute.POST(req(`/api/admin/users/${member.id}/password`, adminToken, { password: "123" }), params(member.id))).status).toBe(400);
    expect(auth.authenticate("Member", "member-pass-1")?.id).toBe(member.id);
  });
});

describe("changing your own password", () => {
  const change = (token: string | null, body: unknown) =>
    passwordRoute.POST(req("/api/auth/password", token, body));

  it("any user (not just admins) can change it; this device stays signed in, others are signed out", async () => {
    const u = auth.createUser("SelfService", "first-pass-1");
    const here = auth.createSession(u.id).token;
    const elsewhere = auth.createSession(u.id).token;
    const res = await change(here, { currentPassword: "first-pass-1", newPassword: "second-pass-1" });
    expect(res.status).toBe(200);
    expect(auth.authenticate("SelfService", "first-pass-1")).toBeNull();
    expect(auth.authenticate("SelfService", "second-pass-1")?.id).toBe(u.id);
    expect(auth.getUserBySessionToken(here)?.id).toBe(u.id);
    expect(auth.getUserBySessionToken(elsewhere)).toBeNull();
  });

  it("a wrong current password changes nothing", async () => {
    const u = auth.createUser("Careful", "right-pass-1");
    const token = auth.createSession(u.id).token;
    const other = auth.createSession(u.id).token;
    const res = await change(token, { currentPassword: "WRONG-pass", newPassword: "whatever-1" });
    expect(res.status).toBe(400);
    expect(auth.authenticate("Careful", "right-pass-1")?.id).toBe(u.id);
    expect(auth.authenticate("Careful", "whatever-1")).toBeNull();
    expect(auth.getUserBySessionToken(other)?.id).toBe(u.id); // nobody signed out
  });

  it("refuses a short new password and signed-out callers", async () => {
    const u = auth.createUser("ShortPw", "right-pass-1");
    const token = auth.createSession(u.id).token;
    expect((await change(token, { currentPassword: "right-pass-1", newPassword: "123" })).status).toBe(400);
    expect(auth.authenticate("ShortPw", "right-pass-1")?.id).toBe(u.id);
    expect((await change(null, { currentPassword: "x", newPassword: "long-enough" })).status).toBe(401);
  });

  it("only changes the caller's own account", async () => {
    const a = auth.createUser("OwnerA", "a-pass-123");
    const b = auth.createUser("OwnerB", "b-pass-123");
    const aToken = auth.createSession(a.id).token;
    await change(aToken, { currentPassword: "a-pass-123", newPassword: "a-new-pass" });
    expect(auth.authenticate("OwnerB", "b-pass-123")?.id).toBe(b.id);
  });
});

describe("the first account becomes admin", () => {
  it("migration 0008 makes the oldest existing account admin, nobody else", () => {
    const db = new Database(path.join(TMP, "pre0008.db"));
    fs.readdirSync(MIGRATIONS)
      .filter((f) => /^000[0-7]_.*\.sql$/.test(f))
      .sort()
      .forEach((f) =>
        fs.readFileSync(path.join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).forEach((s) => db.exec(s)),
      );
    db.prepare("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ('u2', 'Later', 'later', 'x', '2026-02-01')").run();
    db.prepare("INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ('u1', 'Owner', 'owner', 'x', '2026-01-01')").run();
    const m = fs.readdirSync(MIGRATIONS).find((f) => f.startsWith("0008_"))!;
    fs.readFileSync(path.join(MIGRATIONS, m), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).forEach((s) => db.exec(s));
    expect(db.prepare("SELECT username, is_admin FROM users ORDER BY created_at").all()).toEqual([
      { username: "Owner", is_admin: 1 },
      { username: "Later", is_admin: 0 },
    ]);
    db.close();
  });

  it("create-user.mjs: first account is admin, later ones not, --admin grants it", () => {
    const file = path.join(TMP, "script.db");
    const run = (...a: string[]) => execFileSync("node", ["scripts/create-user.mjs", ...a], { env: { ...process.env, CARMENITA_DB: file }, stdio: "pipe" }).toString();
    expect(run("First", "first-pass-1")).toContain('Created admin "First"');
    expect(run("Second", "second-pass-1")).toContain('Created user "Second"');
    run("--admin", "Third", "third-pass-1");
    const db = new Database(file, { readonly: true });
    expect(db.prepare("SELECT username, is_admin FROM users ORDER BY created_at, username").all()).toEqual([
      { username: "First", is_admin: 1 },
      { username: "Second", is_admin: 0 },
      { username: "Third", is_admin: 1 },
    ]);
    db.close();
  });
});
