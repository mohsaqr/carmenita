import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users, type User } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Username/password auth backed by the SQLite `users` + `sessions`
 * tables. The browser holds only an opaque random token in an
 * httpOnly cookie; the DB stores its SHA-256, never the token itself.
 *
 * Enforcement lives in `src/proxy.ts`, which runs on every request.
 * Route handlers that need to know *who* is calling use
 * `getUserFromRequest()`.
 */

export const SESSION_COOKIE = "carmenita_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type PublicUser = Pick<User, "id" | "username">;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function usernameKey(username: string): string {
  return username.trim().toLowerCase();
}

/** Create a user, or reset the password if the username already exists. */
export function upsertUser(username: string, password: string): PublicUser {
  const name = username.trim();
  if (!name) throw new Error("Username must not be empty");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");
  const key = usernameKey(name);
  const passwordHash = hashPassword(password);
  const existing = db.select().from(users).where(eq(users.usernameKey, key)).get();
  if (existing) {
    db.update(users)
      .set({ username: name, passwordHash })
      .where(eq(users.id, existing.id))
      .run();
    return { id: existing.id, username: name };
  }
  const id = randomUUID();
  db.insert(users)
    .values({ id, username: name, usernameKey: key, passwordHash, createdAt: new Date().toISOString() })
    .run();
  return { id, username: name };
}

/** Returns the user when the credentials match, otherwise null. */
export function authenticate(username: string, password: string): PublicUser | null {
  const row = db.select().from(users).where(eq(users.usernameKey, usernameKey(username))).get();
  if (!row || !verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, username: row.username };
}

/** Opens a session and returns the raw token to put in the cookie. */
export function createSession(userId: string, now = new Date()): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  // Opportunistic cleanup so the table doesn't grow forever.
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
  db.insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();
  return { token, expiresAt };
}

export function getUserBySessionToken(
  token: string | undefined | null,
  now = new Date(),
): PublicUser | null {
  if (!token) return null;
  const row = db
    .select({ id: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now.toISOString())))
    .get();
  return row ?? null;
}

export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

type CookieRequest = { cookies: { get(name: string): { value: string } | undefined } };

/** Reads the session cookie off a request and resolves the user. */
export function getUserFromRequest(req: CookieRequest): PublicUser | null {
  return getUserBySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * For route handlers: the signed-in user, or a ready-made 401 response.
 * Every data route scopes its queries to `user.id` — each user has a
 * private bank. The proxy already blocks signed-out requests; this is
 * the second, per-route line of defence and the source of the user id.
 *
 *   const auth = requireUser(req);
 *   if ("response" in auth) return auth.response;
 *   const userId = auth.user.id;
 */
export function requireUser(req: CookieRequest): { user: PublicUser } | { response: NextResponse } {
  const user = getUserFromRequest(req);
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { user };
}

/** Usernames of every other account, for the "send a copy to…" picker. */
export function listOtherUsernames(userId: string): string[] {
  return db
    .select({ username: users.username })
    .from(users)
    .where(ne(users.id, userId))
    .orderBy(users.usernameKey)
    .all()
    .map((r) => r.username);
}

/** Resolve a username (case-insensitive) to a user, or null. */
export function findUserByUsername(username: string): PublicUser | null {
  return (
    db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.usernameKey, usernameKey(username)))
      .get() ?? null
  );
}
