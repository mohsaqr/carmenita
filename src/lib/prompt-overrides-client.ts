"use client";

import { legacyPromptOverrideKey } from "@/lib/prompts";

/**
 * Browser-side access to per-user prompt overrides, stored in the
 * database via /api/settings/prompt:<id>. Works in the static build too:
 * the fetch interceptor serves /api/settings from the sql.js DB.
 */

const key = (id: string) => `/api/settings/${encodeURIComponent(`prompt:${id}`)}`;

async function readServer(id: string): Promise<string | null> {
  const res = await fetch(key(id));
  if (!res.ok) throw new Error(`Could not load prompt (${res.status})`);
  const data = (await res.json()) as { value: unknown };
  return typeof data.value === "string" ? data.value : null;
}

/**
 * The saved override for `id`, or null. On first read, an override left
 * in localStorage by an older version is uploaded to the DB and removed
 * locally.
 */
export async function fetchPromptOverride(id: string): Promise<string | null> {
  const stored = await readServer(id);
  if (stored !== null) return stored;
  let legacy: string | null = null;
  try {
    legacy = window.localStorage.getItem(legacyPromptOverrideKey(id));
  } catch {
    legacy = null; // storage blocked — nothing to migrate
  }
  if (legacy === null) return null;
  await savePromptOverride(id, legacy);
  window.localStorage.removeItem(legacyPromptOverrideKey(id));
  return legacy;
}

export async function savePromptOverride(id: string, value: string): Promise<void> {
  const res = await fetch(key(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Could not save prompt (${res.status})`);
}

export async function clearPromptOverride(id: string): Promise<void> {
  const res = await fetch(key(id), { method: "DELETE" });
  if (!res.ok) throw new Error(`Could not reset prompt (${res.status})`);
}
