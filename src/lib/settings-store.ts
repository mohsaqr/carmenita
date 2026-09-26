import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { PROMPTS } from "@/lib/prompts";

/**
 * Server-side per-user key/value settings (the `app_settings` table).
 * Replaces what used to live in browser localStorage, so provider
 * config, API keys and prompt overrides follow the account across
 * browsers and machines.
 */

export const SETTINGS_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
export const PROMPT_KEY_PREFIX = "prompt:";

export function getSetting(userId: string, key: string): unknown | null {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, key)))
    .get();
  return row ? row.value : null;
}

export function listSettings(userId: string): Record<string, unknown> {
  const rows = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.userId, userId))
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(userId: string, key: string, value: unknown): void {
  const updatedAt = new Date().toISOString();
  db.insert(appSettings)
    .values({ userId, key, value, updatedAt })
    .onConflictDoUpdate({
      target: [appSettings.userId, appSettings.key],
      set: { value, updatedAt },
    })
    .run();
}

export function deleteSetting(userId: string, key: string): void {
  db.delete(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, key)))
    .run();
}

/**
 * The user's saved override for a prompt id, or the registry default.
 * Server-side counterpart of `getPrompt()`, which can only see the
 * defaults when it runs inside a route handler.
 */
export function resolvePrompt(userId: string | null | undefined, promptId: string): string {
  const fallback = PROMPTS[promptId]?.defaultValue;
  if (fallback === undefined) throw new Error(`Unknown prompt id: ${promptId}`);
  if (!userId) return fallback;
  const override = getSetting(userId, PROMPT_KEY_PREFIX + promptId);
  return typeof override === "string" && override.trim() ? override : fallback;
}
