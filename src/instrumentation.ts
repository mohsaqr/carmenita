import type { Instrumentation } from "next";

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
