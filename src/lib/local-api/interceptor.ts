/**
 * Client-side fetch interceptor for the static build.
 *
 * Monkey-patches `window.fetch` so that any request to `/api/*` is
 * handled by the sql.js-backed handlers in `./handlers.ts` instead of
 * hitting the network. All other requests (CSS, JS chunks, the seed
 * DB, font files, ...) fall through to the real fetch.
 *
 * This module does nothing in the normal server build because it is
 * only imported from the StaticApiBootstrap component, which itself
 * only mounts when `process.env.NEXT_PUBLIC_STATIC_BUILD === "1"`.
 * The real `/api/*` routes remain the single source of truth for the
 * Node-server deploy.
 */
import { initLocalDb } from "./db";
import {
  createAttempt,
  exportBank,
  getAttempt,
  getQuiz,
  getTaxonomy,
  importBank,
  listAttempts,
  listBankQuestions,
  listQuizzes,
  listTrash,
  permanentDeleteTrash,
  quickQuiz,
  restoreTrash,
  softDeleteQuiz,
  submitAttempt,
  updateQuestion,
} from "./handlers";

type HandlerResult = {
  status?: number;
  body: unknown;
};

let installed = false;

function json(result: HandlerResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

function methodNotAllowed(path: string, method: string): Response {
  return new Response(
    JSON.stringify({
      error: `Method ${method} not supported on ${path} in static deploy`,
    }),
    { status: 405, headers: { "Content-Type": "application/json" } },
  );
}

function download(result: {
  text: string;
  filename: string;
  skipped: string;
  exported: number;
}): Response {
  return new Response(result.text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "X-Carmenita-Skipped": result.skipped,
      "X-Carmenita-Exported-Count": String(result.exported),
    },
  });
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.clone().json();
  } catch {
    return {};
  }
}

/**
 * Given an absolute URL's pathname, strip the configured basePath
 * (e.g. `/carmenita`) so the router below sees canonical paths like
 * `/api/quizzes/abc`.
 */
function normalizePath(pathname: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (base && pathname.startsWith(base)) return pathname.slice(base.length);
  return pathname;
}

async function route(req: Request): Promise<Response | null> {
  const url = new URL(req.url, window.location.origin);
  const pathname = normalizePath(url.pathname);
  if (!pathname.startsWith("/api/")) return null;

  // Ensure the DB is ready before dispatching anything.
  await initLocalDb();

  const method = req.method.toUpperCase();

  // ── Static match table ────────────────────────────────────────────────
  // We parse path segments manually (no Next's route tree here).
  const segs = pathname.replace(/\/+$/, "").split("/").slice(2); // drop "", "api"

  // /api/quizzes
  if (segs[0] === "quizzes" && segs.length === 1) {
    if (method === "GET") return json({ body: listQuizzes() });
    return methodNotAllowed(pathname, method);
  }

  // /api/quizzes/:id
  if (segs[0] === "quizzes" && segs.length === 2) {
    const id = segs[1];
    if (method === "GET") return json(getQuiz(id));
    if (method === "DELETE") return json(await softDeleteQuiz(id));
    return methodNotAllowed(pathname, method);
  }

  // /api/attempts
  if (segs[0] === "attempts" && segs.length === 1) {
    if (method === "GET") return json({ body: listAttempts() });
    if (method === "POST") {
      const body = (await parseJson(req)) as { quizId: string };
      return json(await createAttempt(body));
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/attempts/:id
  if (segs[0] === "attempts" && segs.length === 2) {
    const id = segs[1];
    if (method === "GET") return json(getAttempt(id));
    if (method === "PATCH") {
      const body = (await parseJson(req)) as {
        answers: Array<{
          questionId: string;
          userAnswer: number | number[] | null;
          timeMs: number;
        }>;
      };
      return json(await submitAttempt(id, body));
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/taxonomy
  if (segs[0] === "bank" && segs[1] === "taxonomy" && segs.length === 2) {
    if (method === "GET") return json({ body: getTaxonomy() });
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/questions
  if (segs[0] === "bank" && segs[1] === "questions" && segs.length === 2) {
    if (method === "GET") return json({ body: listBankQuestions(url) });
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/questions/:id
  if (segs[0] === "bank" && segs[1] === "questions" && segs.length === 3) {
    const id = segs[2];
    if (method === "PATCH") {
      const body = (await parseJson(req)) as { notes?: string | null };
      return json(await updateQuestion(id, body));
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/quick-quiz
  if (segs[0] === "bank" && segs[1] === "quick-quiz" && segs.length === 2) {
    if (method === "POST") {
      const body = (await parseJson(req)) as {
        title?: string;
        count: number;
        candidateIds?: string[];
        shuffle?: boolean;
      };
      return json(await quickQuiz(body));
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/import
  if (segs[0] === "bank" && segs[1] === "import" && segs.length === 2) {
    if (method === "POST") {
      const body = (await parseJson(req)) as {
        format: string;
        text: string;
        sourceLabel?: string;
      };
      return json(await importBank(body));
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/bank/export
  if (segs[0] === "bank" && segs[1] === "export" && segs.length === 2) {
    if (method === "GET") {
      const result = exportBank(url);
      if ("__download" in result && result.__download) {
        return download(result as { text: string; filename: string; skipped: string; exported: number });
      }
      return json(result as HandlerResult);
    }
    return methodNotAllowed(pathname, method);
  }

  // /api/trash
  if (segs[0] === "trash" && segs.length === 1) {
    if (method === "GET") return json({ body: listTrash() });
    return methodNotAllowed(pathname, method);
  }

  // /api/trash/:id  (POST = restore, DELETE = permanent)
  if (segs[0] === "trash" && segs.length === 2) {
    const id = segs[1];
    if (method === "POST") return json(await restoreTrash(id));
    if (method === "DELETE") return json(await permanentDeleteTrash(id));
    return methodNotAllowed(pathname, method);
  }

  // Unhandled /api/* endpoint — explicit 404 so the UI can surface a
  // useful "this action isn't available in the static demo" error.
  return notFound(`Endpoint not implemented in static build: ${pathname}`);
}

/**
 * Install the interceptor exactly once on the window.fetch global.
 * Idempotent so React strict-mode double-invocation in dev doesn't
 * chain it twice.
 *
 * At install time we also drain any queue built up by the inline
 * `<script>` shim in `src/app/layout.tsx`. That shim starts buffering
 * `/api/*` calls at HTML parse time — before React has even hydrated
 * — so page components that call fetch inside a first-render effect
 * don't lose their requests to the real network.
 */
type QueuedCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
};

type CarmenitaWindow = Window & {
  __carmenitaRealFetch?: typeof fetch;
  __carmenitaFetchQueue?: QueuedCall[];
  __carmenitaShimActive?: boolean;
};

export function installLocalFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;

  const w = window as CarmenitaWindow;

  // Capture the ORIGINAL fetch. If the inline shim ran first it
  // stashed the real fetch on window.__carmenitaRealFetch; otherwise
  // the current window.fetch is still the browser's built-in.
  const originalFetch = (w.__carmenitaRealFetch ?? window.fetch).bind(window);

  w.__carmenitaRealFetch = originalFetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Fast path: only intercept /api/* URLs. Everything else (HTML
    // pages, _next chunks, fonts, images) goes straight to the real
    // fetch with no overhead.
    const reqUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Resolve relative URLs against the current location so we can
    // inspect the pathname without new URL() blowing up.
    let pathname: string;
    try {
      pathname = new URL(reqUrl, window.location.origin).pathname;
    } catch {
      return originalFetch(input, init);
    }
    const normalized = normalizePath(pathname);
    if (!normalized.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const request =
      input instanceof Request ? input : new Request(reqUrl, init);
    try {
      const res = await route(request);
      if (res) return res;
      return originalFetch(input, init);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Local API error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };

  // Drain any calls that were queued by the inline shim before this
  // real interceptor had a chance to install. Each queued entry is a
  // pending Promise returned to the caller; we dispatch through the
  // now-installed window.fetch and resolve/reject accordingly.
  const queue = w.__carmenitaFetchQueue;
  if (queue && queue.length > 0) {
    // Reset the global BEFORE draining so any new /api calls made
    // during drain go through window.fetch directly (now the real
    // interceptor), not back into the queue.
    w.__carmenitaFetchQueue = [];
    w.__carmenitaShimActive = false;
    for (const call of queue) {
      window
        .fetch(call.input, call.init)
        .then(call.resolve, call.reject);
    }
  } else {
    w.__carmenitaShimActive = false;
  }
  if (typeof console !== "undefined") {
    console.log(
      `[carmenita] real fetch interceptor installed, drained ${
        queue ? queue.length : 0
      } queued call(s)`,
    );
  }
}
