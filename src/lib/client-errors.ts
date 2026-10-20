/**
 * Browser side of error logging: report a failure the user saw to
 * `POST /api/client-errors`, so it lands in the server journal next to
 * the request lines. Covers what the server never sees — a proxy error
 * page (Cloudflare 524), a lost network, a crash in the page itself.
 *
 * An error whose message already carries "(ref …)" came from the server
 * and is logged there, so it is not reported twice. Reports are capped
 * per page load, never throw, and are off in the static build (no server).
 */

export const MAX_REPORTS_PER_PAGE = 20;

let sent = 0;

/** For tests: reset the per-page cap. */
export function resetClientErrorCount(): void {
  sent = 0;
}

/** True when the message came from a server response that was logged already. */
export function hasServerRef(message: string): boolean {
  return /\(ref [0-9a-f]{6}\)/.test(message);
}

export function reportClientError(
  where: string,
  error: unknown,
  fetchImpl: typeof fetch | undefined = typeof fetch === "undefined" ? undefined : fetch,
): boolean {
  if (process.env.NEXT_PUBLIC_STATIC_BUILD === "1" || !fetchImpl) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (hasServerRef(message) || sent >= MAX_REPORTS_PER_PAGE) return false;
  sent += 1;
  const page = typeof location === "undefined" ? undefined : location.pathname;
  fetchImpl("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ where, message: message.slice(0, 1000), page }),
    keepalive: true,
  }).catch(() => {
    // Reporting is best effort: the user already sees the error itself.
  });
  return true;
}
