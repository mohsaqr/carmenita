"use client";

import { useEffect, useState } from "react";

/**
 * React-tree bootstrap for the static build.
 *
 * The fetch interceptor itself is installed by a synchronous inline
 * `<script>` in `src/app/layout.tsx` (see `INTERCEPTOR_SHIM`). That
 * shim starts queueing `/api/*` calls at HTML parse time — before
 * any React code runs — so this component's job is only to:
 *
 *   1. Lazy-load the real sql.js-backed interceptor module, which
 *      replaces the inline shim's queue with actual routing and
 *      drains any calls that were buffered.
 *   2. Eagerly warm the local DB so the first real API call doesn't
 *      pay the 1.5 MB seed-DB download latency.
 *   3. Show a persistent error banner if WASM/IndexedDB is blocked
 *      (otherwise the user sees silent blank screens).
 *
 * Gated on `NEXT_PUBLIC_STATIC_BUILD` — a no-op in normal Node builds.
 */
export function StaticApiBootstrap() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1") return;
    let cancelled = false;
    (async () => {
      try {
        // Install the real interceptor FIRST so any buffered calls
        // from the inline shim get drained before we try to warm the
        // DB (which itself goes through fetch for the seed .db file).
        const { installLocalFetchInterceptor } = await import(
          "@/lib/local-api/interceptor"
        );
        installLocalFetchInterceptor();

        const { initLocalDb } = await import("@/lib/local-api/db");
        await initLocalDb();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load local DB",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1") return null;
  if (!error) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
      <p className="font-medium">Local database failed to load</p>
      <p className="text-xs">{error}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try reloading the page. If the problem persists, your browser
        may be blocking IndexedDB or WebAssembly.
      </p>
    </div>
  );
}
