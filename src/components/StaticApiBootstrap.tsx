"use client";

import { useEffect, useState } from "react";

/**
 * Installs the sql.js-backed fetch interceptor when the app runs as a
 * fully static build (GitHub Pages). This component is rendered
 * unconditionally in the root layout but returns `null` in normal
 * server builds — the effect is gated on the build-time env var
 * `NEXT_PUBLIC_STATIC_BUILD`, which the static build script sets to
 * "1" and the dev/Node build leaves empty.
 *
 * Mounting strategy:
 *   1. On mount, dynamically import the interceptor (so its sql.js
 *      dependency is NOT bundled into the server build — only into the
 *      static build chunk).
 *   2. Install it on `window.fetch` before any page component has a
 *      chance to call fetch. Because StaticApiBootstrap sits at the
 *      top of the layout tree, its useEffect runs before child pages
 *      get mounted.
 *   3. Eagerly warm the sql.js DB so the first API call doesn't pay
 *      the initial 1.5 MB download latency.
 *
 * If the interceptor fails to load (e.g. IndexedDB blocked, WASM
 * disabled), we surface a loud banner so users understand why the
 * app is broken instead of seeing silent blank screens.
 */
export function StaticApiBootstrap() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1") return;
    let cancelled = false;
    (async () => {
      try {
        const [{ installLocalFetchInterceptor }, { initLocalDb }] =
          await Promise.all([
            import("@/lib/local-api/interceptor"),
            import("@/lib/local-api/db"),
          ]);
        installLocalFetchInterceptor();
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
