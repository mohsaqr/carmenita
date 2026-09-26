import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the users table. Pure functions, no DB access,
 * so both the auth layer and tests can use them directly.
 *
 * Format: `scrypt$<N>$<saltHex>$<hashHex>` with r=8, p=1, 64-byte key.
 * `scripts/create-user.mjs` produces the same format independently;
 * `auth.test.ts` asserts the two stay interoperable.
 */

const SCRYPT_N = 16384;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 2) return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}
