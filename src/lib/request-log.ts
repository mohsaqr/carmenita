import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Server logging for investigation: one line per API request that changes
 * something or fails, keyed by a short `ref` that the user also sees.
 *
 *   [api] ref=3fa9c1 POST /api/documents 400 132ms user=carmoona file="x.pdf" error="…"
 *   [llm] ref=3fa9c1 anthropic claude-sonnet-5-5 61234ms ok
 *   [job] ref=3fa9c1 done quiz=… questions=20 ms=64010
 *
 * `withLog()` wraps every route handler. It runs the handler inside an
 * AsyncLocalStorage context, so anything the request starts — LLM calls,
 * a background generation job — logs under the same ref. Every JSON error
 * response gets the ref appended to its `error` text and as `ref`, so a
 * screenshot of the message is enough to find the log lines
 * (`journalctl -u carmenitaapp | grep ref=3fa9c1`).
 *
 * Successful GETs are not logged (the Create page polls a job every 2 s);
 * slow ones are. Never logged: request bodies, API keys, prompts, document
 * text, passwords.
 *
 * This module must not load the database when imported: llm.ts imports it,
 * and tests point `globalThis.__carmenitaDb` at a test DB only after their
 * static imports have run. So `auth` is imported when a line is written.
 */

interface LogContext {
  ref: string;
  /** Extra fields a handler adds with `noteLog()` (file name, size, …). */
  fields: Record<string, string | number | boolean | undefined>;
  /** Raised by `noteLog(…, "warn")` for a request that succeeded but reports a problem. */
  level?: "warn" | "error";
}

const storage = new AsyncLocalStorage<LogContext>();

/** A GET slower than this is logged even when it succeeds. */
export const SLOW_MS = 5000;

export function newRef(): string {
  return randomBytes(3).toString("hex");
}

/** The current request's ref, if any (LLM calls and jobs log it). */
export function currentRef(): string | undefined {
  return storage.getStore()?.ref;
}

/**
 * Add fields to the current request's log line, and optionally raise its
 * level (a browser error report succeeds as a request but is a problem).
 * No-op outside a request.
 */
export function noteLog(fields: LogContext["fields"], level?: "warn" | "error"): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx.fields, fields);
  if (level) ctx.level = level;
}

function formatValue(value: string | number | boolean): string {
  const text = String(value);
  return /^[\w.:/@+-]+$/.test(text) ? text : JSON.stringify(text.length > 1000 ? `${text.slice(0, 1000)}…` : text);
}

/** `key=value` pairs, quoted when needed, undefined skipped. */
export function formatFields(fields: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(fields)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
}

/**
 * One log line: `[tag] ref=… <lead> key=value …`. Warnings and errors go
 * to stderr (both land in the journal).
 */
export function logLine(
  tag: string,
  fields: Record<string, string | number | boolean | undefined>,
  level: "info" | "warn" | "error" = "info",
  lead = "",
): void {
  const ref = currentRef();
  const line = [`[${tag}]`, ref ? `ref=${ref}` : "", lead, formatFields(fields)].filter(Boolean).join(" ");
  if (level === "info") console.info(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

/**
 * A failed request's message: the route's own text plus the first
 * validation problem when there is one ("Validation failed: settings.
 * questionCount — Too big: …"). Logged as is; shown with the ref.
 */
export function describeError(error: unknown, details: unknown): string {
  const base = typeof error === "string" && error ? error : "Request failed";
  const first = Array.isArray(details) ? (details[0] as { path?: unknown[]; message?: string } | undefined) : undefined;
  const detail = first?.message
    ? `: ${Array.isArray(first.path) && first.path.length ? `${first.path.join(".")} — ` : ""}${first.message}`
    : "";
  return `${base}${detail}`;
}

/** The text a user sees for a failed request: the description and the ref. */
export function userErrorText(error: unknown, details: unknown, ref: string): string {
  return `${describeError(error, details)} (ref ${ref})`;
}

type Handler<A extends unknown[]> = (req: NextRequest, ...rest: A) => Promise<Response> | Response;

/** Wrap a route handler: log it, tag its errors with a ref, never leak a raw 500. */
export function withLog<A extends unknown[]>(handler: Handler<A>): (req: NextRequest, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    const ctx: LogContext = { ref: newRef(), fields: {} };
    return storage.run(ctx, async () => {
      const started = performance.now();
      let response: Response;
      let thrown: unknown;
      try {
        response = await handler(req, ...rest);
      } catch (err) {
        thrown = err;
        response = NextResponse.json(
          { error: `Something went wrong on the server. Please report this reference to the admin (ref ${ctx.ref})`, ref: ctx.ref },
          { status: 500 },
        );
      }
      const ms = Math.round(performance.now() - started);
      const failed = response.status >= 400;
      if (!failed && req.method === "GET" && ms < SLOW_MS) return response;

      let errorText: string | undefined;
      if (failed && (response.headers.get("content-type") ?? "").includes("application/json") && thrown === undefined) {
        const body = (await response.clone().json().catch(() => null)) as Record<string, unknown> | null;
        if (body && typeof body === "object") {
          errorText = describeError(body.error, body.details);
          const tagged = { ...body, error: userErrorText(body.error, body.details, ctx.ref), ref: ctx.ref };
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          response = new Response(JSON.stringify(tagged), { status: response.status, headers });
        }
      }

      const { getUserFromRequest } = await import("@/lib/auth");
      const user = getUserFromRequest(req)?.username;
      const url = new URL(req.url);
      const level = response.status >= 500 ? "error" : failed ? "warn" : ctx.level ?? "info";
      logLine("api", {
        ms,
        user,
        ...ctx.fields,
        error: thrown !== undefined ? (thrown instanceof Error ? thrown.stack ?? thrown.message : String(thrown)) : errorText,
      }, level, `${req.method} ${url.pathname} ${response.status}`);
      return response;
    });
  };
}
