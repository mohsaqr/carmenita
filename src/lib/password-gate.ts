/**
 * Simple client-side password gate for the static GitHub Pages deploy.
 *
 * Threat model: deter casual visitors and keep the site out of search
 * indexes. NOT cryptographically secure — anyone who reads the bundle
 * sees `PASSWORD_HASH`, and `carmenita.db` is still downloadable by
 * anyone who bypasses the UI. For real protection, encrypt the DB or
 * move off Pages.
 *
 * To enable: generate a hash with `node scripts/hash-password.mjs <password>`
 * and paste the 64-char hex string into `PASSWORD_HASH` below. Empty
 * string = gate disabled (dev mode / open access).
 */

export const PASSWORD_HASH = "";

const STORAGE_KEY = "carmenita_unlocked";

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(input: string): Promise<boolean> {
  if (!PASSWORD_HASH) return true;
  const hash = await sha256Hex(input);
  return hash === PASSWORD_HASH;
}

/**
 * Stores the current PASSWORD_HASH as the unlock marker (not the raw
 * password). Rotating the password invalidates all prior unlocks
 * automatically because the stored marker no longer matches.
 */
export function isUnlocked(): boolean {
  if (!PASSWORD_HASH) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === PASSWORD_HASH;
  } catch {
    return false;
  }
}

export function markUnlocked(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, PASSWORD_HASH);
  } catch {
    // localStorage unavailable (private mode, quota) — gate will
    // re-prompt next load, which is the right failure mode.
  }
}

export function clearUnlock(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
