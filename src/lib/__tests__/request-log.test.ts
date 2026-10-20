import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest, NextResponse } from "next/server";
import * as schema from "@/db/schema";

/**
 * Request logging and error references (src/lib/request-log.ts), the
 * upload route's messages, and browser error reports — through the real
 * routes on a test DB. Log output is captured from console.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-log-"));
const sqlite = new Database(path.join(TMP, "test.db"));
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });

const auth = await import("@/lib/auth");
const log = await import("@/lib/request-log");
const jobs = await import("@/lib/generation-jobs");
const documentsRoute = await import("@/app/api/documents/route");
const clientErrorsRoute = await import("@/app/api/client-errors/route");
const jobRoute = await import("@/app/api/generate-quiz/jobs/[id]/route");
const { isServerFault } = await import("@/lib/doc-extract");
const clientErrors = await import("@/lib/client-errors");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

const carmen = auth.upsertUser("Carmen", "carmen-pass-1");
const token = auth.createSession(carmen.id).token;

function req(url: string, init: { method?: string; body?: unknown; signedIn?: boolean } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.signedIn === false ? {} : { cookie: `${auth.SESSION_COOKIE}=${token}` }),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Capture every console line written while `fn` runs. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  vi.spyOn(console, "info").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
  const result = await fn();
  return { result, lines };
}

describe("formatFields", () => {
  it("quotes values with spaces or quotes, skips empty ones", () => {
    expect(log.formatFields({ a: "plain", b: "two words", c: undefined, d: "", e: 3, f: 'say "hi"' }))
      .toBe('a=plain b="two words" e=3 f="say \\"hi\\""');
  });

  it("keeps a multi-line stack on one line", () => {
    expect(log.formatFields({ error: "Error: x\n    at y" })).toBe('error="Error: x\\n    at y"');
  });
});

describe("withLog", () => {
  it("does not log a successful GET, logs a POST with user, status and fields", async () => {
    const get = log.withLog(async () => NextResponse.json({ ok: true }));
    const quiet = await captureLogs(() => get(req("/api/x")));
    expect(quiet.lines).toEqual([]);

    const post = log.withLog(async () => {
      log.noteLog({ file: "lecture 10.pdf", bytes: 1312444 });
      return NextResponse.json({ ok: true });
    });
    const { lines } = await captureLogs(() => post(req("/api/x", { method: "POST", body: {} })));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[api\] ref=[0-9a-f]{6} POST \/api\/x 200 ms=\d+ user=Carmen file="lecture 10.pdf" bytes=1312444$/);
  });

  it("adds the ref and the first validation problem to an error the user sees", async () => {
    const handler = log.withLog(async () =>
      NextResponse.json(
        { error: "Validation failed", details: [{ path: ["settings", "questionCount"], message: "Too big: expected <=50" }] },
        { status: 400 },
      ),
    );
    const { result, lines } = await captureLogs(() => handler(req("/api/x", { method: "POST", body: {} })));
    const body = await result.json();
    expect(body.ref).toMatch(/^[0-9a-f]{6}$/);
    expect(body.error).toBe(`Validation failed: settings.questionCount — Too big: expected <=50 (ref ${body.ref})`);
    expect(body.details).toHaveLength(1);
    expect(lines[0]).toContain(`[api] ref=${body.ref} POST /api/x 400`);
    expect(lines[0]).toContain('error="Validation failed: settings.questionCount — Too big: expected <=50"');
  });

  it("turns a crash into a 500 with a ref, and logs the stack", async () => {
    const handler = log.withLog(async () => {
      throw new Error("boom in handler");
    });
    const { result, lines } = await captureLogs(() => handler(req("/api/x", { method: "POST", body: {} })));
    expect(result.status).toBe(500);
    const body = await result.json();
    expect(body.error).toContain(`(ref ${body.ref})`);
    expect(body.error).not.toContain("boom");
    expect(lines[0]).toMatch(new RegExp(`^\\[api\\] ref=${body.ref} POST /api/x 500 .*error="Error: boom in handler`));
  });

  it("logs a slow GET", async () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(0).mockReturnValueOnce(log.SLOW_MS + 1);
    const handler = log.withLog(async () => NextResponse.json({ ok: true }));
    const { lines } = await captureLogs(() => handler(req("/api/slow")));
    expect(lines[0]).toMatch(/GET \/api\/slow 200 ms=5001/);
  });

  it("gives a background job, and its error, the ref of the request that started it", async () => {
    const start = log.withLog(async () => {
      const job = jobs.startJob(carmen.id, 1, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("model said no");
      });
      return NextResponse.json({ jobId: job.id }, { status: 202 });
    });
    const { result, lines } = await captureLogs(async () => {
      const res = await start(req("/api/generate-quiz", { method: "POST", body: {} }));
      const { jobId } = await res.json();
      await vi.waitFor(() => expect(jobs.getJob(carmen.id, jobId)?.status).toBe("error"));
      return jobId as string;
    });
    const ref = /\[api\] ref=([0-9a-f]{6})/.exec(lines.join("\n"))?.[1];
    expect(ref).toBeDefined();
    expect(lines.some((l) => l.startsWith(`[job] ref=${ref} started`))).toBe(true);
    expect(lines.some((l) => l.startsWith(`[job] ref=${ref} failed`) && l.includes('error="model said no"'))).toBe(true);

    const poll = await jobRoute.GET(req(`/api/generate-quiz/jobs/${result}`), { params: Promise.resolve({ id: result }) });
    expect((await poll.json()).error).toBe(`model said no (ref ${ref})`);
  });
});

describe("POST /api/documents messages", () => {
  const upload = (filename: string, content: Buffer) =>
    documentsRoute.POST(req("/api/documents", { method: "POST", body: { filename, contentBase64: content.toString("base64") } }));

  it("names the file problem, with a ref, and logs file, size and cause", async () => {
    const { result, lines } = await captureLogs(() => upload("broken.pdf", Buffer.from("not a pdf at all")));
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toMatch(/PDF/);
    expect(body.error).toContain(`(ref ${body.ref})`);
    expect(lines[0]).toMatch(/POST \/api\/documents 400 .*user=Carmen file=broken.pdf bytes=16 error=".*PDF/);
    expect(lines[0]).not.toContain("cause=");
  });

  it("says how little text was found", async () => {
    const { result } = await captureLogs(() => upload("short.txt", Buffer.from("Just a few words.")));
    expect(result.status).toBe(400);
    expect((await result.json()).error).toMatch(/^Only 17 characters of text could be read from "short.txt"/);
  });

  it("logs chars on success", async () => {
    const text = "Benzodiazepines enhance GABA-A receptor function. ".repeat(10);
    const { result, lines } = await captureLogs(() => upload("notes.txt", Buffer.from(text)));
    expect(result.status).toBe(200);
    expect(lines[0]).toMatch(new RegExp(`POST /api/documents 200 .*file=notes.txt bytes=${text.length} chars=${text.length}`));
  });
});

describe("isServerFault", () => {
  it("separates our setup failures from file problems", () => {
    expect(isServerFault('Setting up fake worker failed: "Cannot find module \'/x/pdf.worker.mjs\'"')).toBe(true);
    expect(isServerFault("PPTX support requires jszip: nope")).toBe(true);
    expect(isServerFault("Invalid PDF structure.")).toBe(false);
    expect(isServerFault("This PDF is password-protected.")).toBe(false);
  });
});

describe("browser error reports", () => {
  it("the route logs where, page and message as a warning", async () => {
    const { result, lines } = await captureLogs(() =>
      clientErrorsRoute.POST(req("/api/client-errors", {
        method: "POST",
        body: { where: "create.generate", page: "/create", message: "The server took too long to answer (HTTP 524)." },
      })),
    );
    expect(result.status).toBe(200);
    expect(lines[0]).toMatch(/^\[api\] ref=[0-9a-f]{6} POST \/api\/client-errors 200 ms=\d+ user=Carmen where=create.generate page=\/create message="The server took too long to answer \(HTTP 524\)."$/);
  });

  it("signed-out reports are refused", async () => {
    const { result } = await captureLogs(() =>
      clientErrorsRoute.POST(req("/api/client-errors", { method: "POST", body: { where: "x", message: "y" }, signedIn: false })),
    );
    expect(result.status).toBe(401);
  });

  it("the reporter skips server errors (already logged), caps per page, never throws", () => {
    clientErrors.resetClientErrorCount();
    const sent: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response("{}");
    }) as unknown as typeof fetch;

    expect(clientErrors.reportClientError("create.upload", new Error("PDF could not be read (ref a1b2c3)"), fakeFetch)).toBe(false);
    expect(clientErrors.reportClientError("create.generate", new Error("Failed to fetch"), fakeFetch)).toBe(true);
    expect(JSON.parse(sent[0])).toMatchObject({ where: "create.generate", message: "Failed to fetch" });

    const results = Array.from({ length: clientErrors.MAX_REPORTS_PER_PAGE + 5 }, () =>
      clientErrors.reportClientError("x", "again", fakeFetch),
    );
    expect(results.filter(Boolean)).toHaveLength(clientErrors.MAX_REPORTS_PER_PAGE - 1);

    clientErrors.resetClientErrorCount();
    const failing = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(() => clientErrors.reportClientError("x", "y", failing)).not.toThrow();
  });
});
