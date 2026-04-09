#!/usr/bin/env node
/**
 * Generate a SHA-256 hex digest to paste into
 * `src/lib/password-gate.ts` as the `PASSWORD_HASH` constant.
 *
 * Usage:
 *   node scripts/hash-password.mjs <password>
 */
import { createHash } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const hash = createHash("sha256").update(password, "utf8").digest("hex");
console.log(hash);
