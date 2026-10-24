import type { Instrumentation } from "next";

/**
 * Runs once when the server starts. Applies pending DB migrations before
 * the first request, because the mac-push deploy ships a built bundle and
 * nothing else migrates the live DB. A failure throws, the server does not
 * come up, and the deploy's health gate rolls the release back.
 * Node runtime only: the DB modules can't load on the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyMigrations, migrationsFolderFor } = await import("@/db/apply-migrations");
  const { resolveDbPath } = await import("@/db/client-path");
  const dbPath = resolveDbPath();
  const { applied } = applyMigrations(dbPath, migrationsFolderFor());
  console.log(`[startup] db=${dbPath} migrations applied=${applied}`);
}

/**
 * Errors Next.js catches outside our API wrapper — a page that fails to
 * render on the server, a crash in the login proxy — logged on one line in
 * the same `[tag] key=value` shape as src/lib/request-log.ts. (API route
 * errors are caught and logged by `withLog` before they get here.)
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = (error as { digest?: string })?.digest;
  console.error(
    `[render] ${request.method} ${request.path} type=${context.routeType} route=${context.routePath}` +
      `${digest ? ` digest=${digest}` : ""} error=${JSON.stringify((err.stack ?? err.message).slice(0, 1000))}`,
  );
};
