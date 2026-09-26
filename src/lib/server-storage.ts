"use client";

import type { StateStorage } from "zustand/middleware";

/**
 * A zustand `StateStorage` that persists to the database through
 * /api/settings/<name> instead of localStorage.
 *
 * - Reads: GET. If the DB has nothing yet but localStorage still holds
 *   a value from an older version, that value is uploaded once and
 *   removed locally (one-time migration).
 * - Writes: debounced PUT, so typing an API key doesn't fire one request
 *   per keystroke. A pending write is flushed with `keepalive` when the
 *   page is hidden, so closing the tab doesn't lose the last edit.
 *
 * In the static build the fetch interceptor answers /api/settings from
 * the sql.js DB, so the same code path persists there too.
 */

const WRITE_DELAY_MS = 400;

function settingsUrl(name: string): string {
  return `/api/settings/${encodeURIComponent(name)}`;
}

export function createServerStorage(): StateStorage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(keepalive = false): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending.forEach((value, name) => {
      void fetch(settingsUrl(name), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // zustand hands us a JSON string; store it parsed so the DB
        // column holds real JSON, not a string-in-a-string.
        body: JSON.stringify({ value: JSON.parse(value) }),
        keepalive,
      }).then(
        (res) => {
          if (!res.ok) console.warn(`[carmenita] saving setting "${name}" failed: ${res.status}`);
        },
        (err: unknown) => console.warn(`[carmenita] saving setting "${name}" failed`, err),
      );
    });
    pending.clear();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => flush(true));
  }

  return {
    async getItem(name) {
      if (typeof window === "undefined") return null; // SSR: defaults only
      const res = await fetch(settingsUrl(name));
      if (res.status === 401) return null; // signed out — defaults until login
      if (!res.ok) throw new Error(`Loading setting "${name}" failed (${res.status})`);
      const data = (await res.json()) as { value: unknown };
      if (data.value !== null && data.value !== undefined) return JSON.stringify(data.value);

      let legacy: string | null = null;
      try {
        legacy = window.localStorage.getItem(name);
      } catch {
        legacy = null;
      }
      if (legacy === null) return null;
      pending.set(name, legacy);
      flush();
      window.localStorage.removeItem(name);
      return legacy;
    },
    setItem(name, value) {
      pending.set(name, value);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => flush(), WRITE_DELAY_MS);
    },
    async removeItem(name) {
      pending.delete(name);
      await fetch(settingsUrl(name), { method: "DELETE" });
    },
  };
}
