"use client";

import { useEffect, useState } from "react";

/**
 * Installs the sql.js-backed fetch interceptor when the app runs as a
 * fully static build (GitHub Pages).
 *
 * Two-stage install to dodge a race condition:
 *
 *  1. **Module-level shim** (runs when this file is first evaluated
 *     as part of the layout's client bundle). This synchronously
 *     monkey-patches `window.fetch` with a tiny trampoline that buffers
 *     `/api/*` calls and lazy-imports the real interceptor on the
 *     first one. Crucially, this runs BEFORE any page component's
 *     `useEffect` fires — layouts are evaluated before pages during
 *     React client boot — so no `fetch('/api/...')` can slip through
 *     to the real network.
 *
 *  2. **Component-level effect** (mounts in the React tree). Handles
 *     the error-banner UI if the DB/WASM fails to load. Also eagerly
 *     warms the DB so the first real API call doesn't pay the 1.5 MB
 *     download latency.
 *
 * In normal (non-static) builds both the module shim and the effect
 * are gated on `process.env.NEXT_PUBLIC_STATIC_BUILD === "1"` and
 * become no-ops. Normal `npm run dev` / Node server deploys are
 * unaffected. sql.js and the handlers are dynamically imported, so
 * they never bloat the normal build's bundle.
 */

// ─────────────────────────────────────────────────────────────────────────
// STAGE 1 — synchronous module-level shim
// ─────────────────────────────────────────────────────────────────────────

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_STATIC_BUILD === "1"
) {
  const realFetch = window.fetch.bind(window);
  let interceptorReady: Promise<void> | null = null;

  // Lazy-load the interceptor module on first /api/* call. Once it's
  // ready, we "uninstall" this shim by restoring realFetch and letting
  // the real installer replace it.
  function loadInterceptor(): Promise<void> {
    if (!interceptorReady) {
      interceptorReady = (async () => {
        const { installLocalFetchInterceptor } = await import(
          "@/lib/local-api/interceptor"
        );
        // Restore the original fetch so the real installer can capture
        // it as `originalFetch`. Otherwise it would capture this shim
        // and recurse.
        window.fetch = realFetch;
        installLocalFetchInterceptor();
      })();
    }
    return interceptorReady;
  }

  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let pathname = "";
    try {
      const reqUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      pathname = new URL(reqUrl, window.location.origin).pathname;
    } catch {
      return realFetch(input, init);
    }
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const normalized =
      base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    if (!normalized.startsWith("/api/")) {
      return realFetch(input, init);
    }
    // It's an /api/ call — wait for the real interceptor to install,
    // then re-dispatch via the now-replaced window.fetch.
    await loadInterceptor();
    return window.fetch(input, init);
  }) as typeof window.fetch;
}

// ─────────────────────────────────────────────────────────────────────────
// STAGE 2 — React component: DB warm-up + error banner
// ─────────────────────────────────────────────────────────────────────────

export function StaticApiBootstrap() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1") return;
    let cancelled = false;
    (async () => {
      try {
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
