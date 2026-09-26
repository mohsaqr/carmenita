#!/usr/bin/env node
/**
 * Create a Carmenita login, or reset the password of an existing one.
 *
 * Usage:
 *   node scripts/create-user.mjs <username> [password] [--admin]
 *
 * The first account ever created becomes an admin automatically; admins
 * can create accounts and reset passwords from the app's Users page.
 * `--admin` makes (or keeps) any account an admin.
 *
 * If the password is omitted it is read from stdin (so it stays out of
 * shell history):  node scripts/create-user.mjs alice
 *
 * Applies any pending Drizzle migrations first, so this also works on a
 * fresh or older carmenita.db. Target DB: $CARMENITA_DB or ./carmenita.db.
 *
 * Password hash format must match src/lib/password.ts
 * (`scrypt$N$saltHex$hashHex`, r=8, p=1, 64-byte key) — auth.test.ts
 * verifies a hash from this script with the app's verifier.
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const SCRYPT_N = 16384;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function readPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question("Password: ");
  rl.close();
  return answer;
}

const args = process.argv.slice(2);
const makeAdmin = args.includes("--admin");
const [username, passwordArg] = args.filter((a) => a !== "--admin");
if (!username || !username.trim()) {
  console.error("Usage: node scripts/create-user.mjs <username> [password]");
  process.exit(1);
}
const password = passwordArg ?? (await readPassword());
if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dbPath = path.resolve(process.env.CARMENITA_DB ?? path.join(root, "carmenita.db"));
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrate(drizzle(sqlite), { migrationsFolder: path.join(root, "src/db/migrations") });

const name = username.trim();
const key = name.toLowerCase();
const passwordHash = hashPassword(password);
const existing = sqlite.prepare("SELECT id FROM users WHERE username_key = ?").get(key);
if (existing) {
  sqlite
    .prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?")
    .run(name, passwordHash, existing.id);
  if (makeAdmin) sqlite.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(existing.id);
  // A password reset signs the user out everywhere.
  sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  console.log(`Password reset for "${name}" in ${dbPath}`);
} else {
  const id = randomUUID();
  const isFirstUser = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0;
  sqlite.transaction(() => {
    sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, name, key, passwordHash, isFirstUser || makeAdmin ? 1 : 0, new Date().toISOString());
    // Every user has a private bank. On a fresh install (from the public
    // seed) the content has no owner yet: the first account takes it.
    if (isFirstUser) {
      const claimed = ["question_sets", "questions", "quizzes", "attempts", "documents"]
        .map((t) => sqlite.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(id).changes)
        .reduce((a, b) => a + b, 0);
      if (claimed > 0) console.log(`First account: took ownership of ${claimed} existing rows`);
    }
  })();
  console.log(`Created ${isFirstUser || makeAdmin ? "admin" : "user"} "${name}" in ${dbPath}`);
}
sqlite.close();
