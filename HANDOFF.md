# Session Handoff — 2026-04-09

Carmenita — local-first multiple-choice quiz platform. This session's focus was **standing up a GitHub Pages static deployment** that serves the shipped 1,492-question bank from an in-browser SQLite instance (sql.js), with writes persisted to IndexedDB per-browser.

## Repo

- **Path**: `/Users/mohammedsaqr/Documents/Github/carmenita/`
- **Remote**: `https://github.com/mohsaqr/carmenita.git` (PRIVATE, GitHub Free plan)
- **Branch**: `main` — synced with origin as of commit `376c0a8`
- **Stack**: unchanged — Next.js 16 · React 19 · TS strict · Drizzle + better-sqlite3 (Node) / sql.js (browser) · Tailwind v4 · shadcn/ui
- **Tests**: still **284 passing** in 14 files. 0 TS errors, 0 lint errors.
- **Dev server**: `npm run dev` — unchanged; normal mode is unaffected by this session's changes.

## Completed this session

### Phase I — Static-build infrastructure

1. **`next.config.ts`** — `STATIC_BUILD=1` env toggle flips between `output: "standalone"` (Node server, default) and `output: "export"` (GH Pages). When exporting, also applies `basePath` + `assetPrefix` from `PAGES_BASE_PATH`, disables the image optimizer (`images.unoptimized`), and ignores TS build errors (API routes are stripped so dangling imports are noise).

2. **`scripts/build-static.sh`** — Moves `src/app/api/` and `src/middleware.ts` into `.build-stash/` before `next build`, runs the build with `STATIC_BUILD=1 NEXT_PUBLIC_BASE_PATH=$PAGES_BASE_PATH NEXT_PUBLIC_STATIC_BUILD=1`, and restores them via an EXIT trap (survives crashes mid-build). Also copies `carmenita.db` and `node_modules/sql.js/dist/sql-wasm.wasm` into `public/` so they're served as static assets.

3. **Dynamic route split** — Static export needs `generateStaticParams` in a **Server Component**, but `/quiz/[id]/*` pages are `"use client"`. Fixed by splitting each dynamic page into:
   - `page.tsx` (server wrapper) — exports `generateStaticParams` (reads the shipped DB for all quiz IDs) + `dynamicParams = false` + renders the client component.
   - `Runner.client.tsx` / `Analytics.client.tsx` / `Results.client.tsx` — existing client UI, now receives `id`/`quizId`/`attemptId` as prop rather than via `use(params)`.
   - `src/lib/local-api/static-params.ts` — reads `carmenita.db` with better-sqlite3 at BUILD time to enumerate quiz IDs. Gracefully returns `["_"]` if the DB is missing (first-time checkout / CI without seed).

4. **`useSearchParams` Suspense wrappers** — Static export forces client-side rendering on any page that uses `useSearchParams`; Next throws unless it's wrapped in `<Suspense>`. Fixed in `/create`, `/bank`, `/import` via a 3-line `Outer → Suspense → Inner` split.

### Phase II — Browser-side API layer

5. **`src/lib/local-api/db.ts`** — sql.js bootstrap. On first call, fetches `${basePath}/sql-wasm.wasm`, loads the Database, and prefers a saved copy from IndexedDB (key `carmenita.db.blob`) over the shipped seed DB. 30-line hand-rolled IDB wrapper (no deps). Exports `initLocalDb()`, `flushLocalDb()` (serialize + persist), `queryAll`/`queryOne`/`run` — a small Drizzle-free query API.

6. **`src/lib/local-api/handlers.ts`** — Browser re-implementations of the HTTP routes needed to browse, take, and review quizzes:
   - `listQuizzes` (GET /api/quizzes)
   - `getQuiz`, `softDeleteQuiz` (GET/DELETE /api/quizzes/[id])
   - `listAttempts`, `createAttempt`, `getAttempt`, `submitAttempt` (GET/POST /api/attempts, GET/PATCH /api/attempts/[id])
   - `getTaxonomy`, `listBankQuestions` (GET /api/bank/taxonomy, /api/bank/questions)
   - `updateQuestion` (PATCH /api/bank/questions/[id] — notes only)
   - `quickQuiz` (POST /api/bank/quick-quiz — candidateIds mode only)
   - `listTrash`, `restoreTrash`, `permanentDeleteTrash` (trash CRUD)
   Every mutation calls `flushLocalDb()` so attempts, notes, and new quizzes persist across reloads. Scoring still happens server-side style: the `scoreAnswer` helper recomputes `isCorrect` from the stored `correct_answer` — client's claim is ignored.

7. **`src/lib/local-api/interceptor.ts`** — Monkey-patches `window.fetch` so any URL matching `/api/*` (after stripping `basePath`) is routed to the handlers. Everything else (HTML, `_next/static/*`, fonts) falls through to the real fetch. Returns a proper `Response` with the right status + JSON body. Unhandled endpoints get a 404 "not implemented in static build" — so the UI shows a real error, not a silent hang.

8. **`src/components/StaticApiBootstrap.tsx`** — Client component mounted in `src/app/layout.tsx`. When `process.env.NEXT_PUBLIC_STATIC_BUILD === "1"`, dynamically imports the interceptor + initializes the local DB on mount. Returns `null` in normal builds (zero cost). Shows a red error banner if the DB fails to load (IDB blocked, WASM disabled, etc.).

### Phase III — CI / deploy plumbing

9. **`.github/workflows/deploy-pages.yml`** — `actions/checkout → setup-node@22 → npm install --no-audit → scripts/build-static.sh (with PAGES_BASE_PATH=/carmenita) → upload-pages-artifact → deploy-pages`. Uses `npm install` (not `npm ci`) because the macOS-generated lockfile trips EBADPLATFORM on npm ci's strict platform validation. Concurrency group `pages` with `cancel-in-progress: false` mirrors GitHub's official starter.

10. **package-lock.json regenerated from scratch** (`rm -rf node_modules package-lock.json && npm install`) so all cross-platform esbuild binaries are in the tree.

11. **`.gitignore`** — added `public/carmenita.db`, `public/sql-wasm.wasm`, and `.build-stash/` (all derived artifacts written by the build script).

## Current state

- **Normal `npm run dev`**: unchanged. Typecheck clean, all 284 tests passing, lint clean.
- **Static build locally**: `./scripts/build-static.sh` succeeds — 66 static pages generated (including 18 quizzes × 3 dynamic routes = 54 SSG pages). Output is 9.2 MB in `out/`.
- **GitHub Actions**: Last run (`gh run 24159705239`) — **build job succeeds** (51s, artifact uploaded), **deploy job fails** with "Ensure GitHub Pages has been enabled".
- **Blocker**: `gh api -X POST repos/mohsaqr/carmenita/pages` returns **422: "Your current plan does not support GitHub Pages for this repository"**. The repo is PRIVATE on a Free GitHub plan, and Free doesn't allow Pages from private repos.

## Open issues

- **Pages not enabled** — see blocker above. User must choose:
  1. Make `mohsaqr/carmenita` public (simplest; Pages is free for public repos)
  2. Upgrade to GitHub Pro ($4/mo); Pages still serves publicly
  3. Deploy elsewhere — Cloudflare Pages, Netlify, Vercel all support private repos on free tier and can consume the same `scripts/build-static.sh` output

- **Runtime-created quizzes won't deep-link** — `/quiz/[id]` is only pre-rendered for the 18 IDs that existed in the shipped DB at build time (`dynamicParams = false`). A user who clicks "Start exam" on `/take` gets a new UUID, and navigating to `/quiz/<new-uuid>` returns 404 from GH Pages. Either (a) add a SPA 404.html redirect that rewrites to a known quiz ID shell with the real ID in a query param, or (b) refactor to `/quiz?id=...` query routes. Either way this is a follow-up, not a blocker for the demo.

- **LLM-backed endpoints**: `/api/generate-quiz`, `/api/bank/questions/explain`, `/api/bank/questions/retag`, `/api/bank/variations*` are **not** implemented in the interceptor. `/create` and the explain/retag/variation actions will return the `"Endpoint not implemented in static build"` 404. Intentional — static deploys have no server to relay LLM calls.

- **Password protection on the static deploy is not possible** via `src/middleware.ts` because middleware needs a Node runtime. GH Pages has none. For password protection on a static deploy, front it with Cloudflare Access or equivalent.

## Next steps

1. **Resolve the Pages plan blocker** (user decision — see Open issues).
2. Once a deploy target works, do a full runtime smoke test against the live URL: home loads, `/take` filter chips update pool count, click a lecture → full quiz runs → submit → results → retake.
3. (Nice-to-have) SPA 404.html fallback so client-generated quiz IDs deep-link correctly.
4. (Nice-to-have) Tests for the local-api handlers — run the same SQL in a sql.js-in-node instance and assert shape parity with the real Node route handlers.

## Context

- **Repo visibility**: PRIVATE (user wants it private + ideally password-protected; see blocker)
- **GitHub plan**: Free (confirmed — `gh api repos/.../pages` returns 422 plan-not-supported)
- **Deploy target requested**: GitHub Pages, with working DB (user's literal words: "with db")
- **CI runner**: ubuntu-latest, Node 22
- **build-static.sh** must be run from repo root (uses `$(cd "$(dirname "$0")/.." && pwd)`)
