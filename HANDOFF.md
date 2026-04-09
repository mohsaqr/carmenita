# Session Handoff — 2026-04-09

Carmenita — local-first multiple-choice quiz platform. This session's focus was **completing the GitHub Pages deployment** (repo made public, all runtime bugs fixed) and **wiring GIFT/Aiken/Markdown import+export into the static build's fetch interceptor**.

## Repo

- **Path**: `/Users/mohammedsaqr/Documents/Github/carmenita/`
- **Remote**: `https://github.com/mohsaqr/carmenita.git` (**PUBLIC** — changed from private this session to enable GitHub Pages on Free plan)
- **Branch**: `main` — synced with origin as of commit `8f0228f`
- **Live URL**: `https://saqr.me/carmenita/` (GitHub Pages, `PAGES_BASE_PATH=/carmenita`)
- **Stack**: unchanged — Next.js 16 · React 19 · TS strict · Drizzle + better-sqlite3 (Node) / sql.js (browser) · Tailwind v4 · shadcn/ui
- **Tests**: **284 passing** in 14 files. 0 TS errors, 0 lint errors.
- **Dev server**: `npm run dev` — unchanged; normal mode is unaffected.

## Completed this session

### Phase IV — GitHub Pages deployment (live)

1. **Repo made public** via `gh repo edit --visibility public` to satisfy GitHub Free plan's Pages requirement. Pages enabled via API and configured for GitHub Actions deployment.

2. **WASM loading fix** — sql.js's default browser entry requests `sql-wasm-browser.wasm` (not `sql-wasm.wasm`). `build-static.sh` now copies BOTH files into `public/`.

3. **Fetch interceptor race condition resolved** — Page-level `useEffect` calls to `/api/*` fired before `StaticApiBootstrap` could install the interceptor. Three failed approaches (module-level shim, `<Script strategy="beforeInteractive">`, inline `<script dangerouslySetInnerHTML>`) before the final fix:
   - **`scripts/inject-shim.mjs`** — post-build HTML rewriter that hoists a fetch-queueing `<script>` as the FIRST child of `<head>` in every exported HTML file. The shim intercepts `/api/*` calls and queues them as Promises. When `StaticApiBootstrap` mounts, it drains the queue through the real sql.js-backed interceptor.
   - The inline script was removed from `layout.tsx` to prevent Next's `__next_s.push()` serialization from double-injecting it.

4. **`trailingSlash: true`** added to `next.config.ts` for static exports. GitHub Pages expects `take/index.html` for `/take/` URLs, but Next was emitting `take.html`.

5. **Query-param shells for runtime quiz IDs** — `dynamicParams: false` means only the 18 shipped quiz IDs have pre-rendered pages. Runtime-created quizzes (from `/take` or bank assembly) get new UUIDs that can't match any static path. Fixed by creating query-param entry points:
   - `src/app/quiz/page.tsx` + `QueryShell.tsx` — reads `?id=`
   - `src/app/quiz/results/page.tsx` + `ResultsQueryShell.tsx` — reads `?quizId=&attemptId=`
   - `src/app/quiz/analytics/page.tsx` + `AnalyticsQueryShell.tsx` — reads `?id=`
   - All 10+ navigation call sites updated from `/quiz/${id}` to `/quiz?id=${id}` (and similar for results/analytics).

6. **CI workflow finalized** — `.github/workflows/deploy-pages.yml` uses `npm install --no-audit` (not `npm ci`), `PAGES_BASE_PATH=/carmenita`, and the full build-static + inject-shim pipeline. Deploys in ~30s build + ~8s deploy.

### Phase V — Import/export in static build

7. **`src/lib/local-api/handlers.ts`** — added `importBank()` and `exportBank()`:
   - `importBank` validates format, calls the matching parser (`parseGift`/`parseAiken`/`parseMarkdown`), inserts all questions into sql.js with a BEGIN/COMMIT transaction, flushes to IndexedDB. Returns `{imported, warnings, ids}`.
   - `exportBank` applies the same filter params as `listBankQuestions`, maps DB rows to `PortableQuestion[]`, calls the matching serializer. Returns a discriminated union: either `{status, body}` on error or `{__download: true, text, filename, ...}` on success.

8. **`src/lib/local-api/interceptor.ts`** — added `download()` response helper (text/plain with Content-Disposition headers) + two route entries: `POST /api/bank/import` and `GET /api/bank/export`.

### Phase VI — Password gate (disabled, ready to activate)

9. **`src/lib/password-gate.ts`** — `PASSWORD_HASH = ""` (disabled). SHA-256 via WebCrypto, localStorage unlock marker keyed to the current hash (rotating the password auto-invalidates prior unlocks).

10. **`src/components/PasswordGate.tsx`** — lock-screen UI using `useSyncExternalStore` (no hydration warnings, no `setState-in-effect` lint). Wraps entire app in `layout.tsx`. When `PASSWORD_HASH` is empty, it's a zero-cost pass-through.

11. **`scripts/hash-password.mjs`** — `node scripts/hash-password.mjs <password>` prints the SHA-256 hex to paste into `password-gate.ts`.

## Current state

- **Live at `https://saqr.me/carmenita/`** — last verified working at commit `8f0228f`. User was still smoke-testing; full confirmation pending.
- Normal `npm run dev`: unchanged, all checks clean.
- Static build: `./scripts/build-static.sh` succeeds locally. CI deploys automatically on push to main.

## Open issues

- **User smoke test pending** — the `trailingSlash` + query-param shell deploy (`8f0228f`) was pushed and CI-deployed, but the user hasn't fully confirmed end-to-end (quiz take → submit → results). The last report showed the inline shim working (`drained 0 queued call(s)`) but a runtime UUID 404 — which the query-param shells should now fix.

- **LLM-backed endpoints still not in interceptor** — `/api/generate-quiz`, `/api/generate-from-topic`, `/api/bank/questions/explain`, `/api/bank/questions/retag`, `/api/bank/variations` return 404 in static mode. `/create` page dead-ends. These could theoretically work client-side (API keys are in browser localStorage) but would need the LLM SDKs bundled for browser use.

- **Analytics endpoints not in interceptor** — `/api/analytics/overview`, `/api/analytics/improvement/:id`, `/api/analytics/topics`, `/api/analytics/difficulty`, `/api/analytics/bloom` are not implemented. The analytics page and dashboard stats tiles don't work in static mode.

- **Repo is now public** — all source code and the shipped `carmenita.db` (1,492 genetics questions) are publicly accessible. The disabled password gate deters casual visitors but doesn't protect anything. For real protection, the user expressed interest in a Google Drive login approach (see Next steps).

- **Direct URL entry to `/quiz/<unknown-uuid>/`** would still 404 — only the 18 shipped IDs are pre-rendered. The query-param route (`/quiz?id=...`) handles runtime IDs. A `404.html` SPA fallback could redirect path-based URLs to query-param equivalents.

- **Uncommitted changes** — the import/export handlers + password gate files are implemented and passing all checks but NOT yet committed or pushed.

## Key decisions

1. **Query-param routing for runtime IDs** over SPA 404.html redirect — cleaner, no flash, and works with GitHub Pages' strict static file serving. All internal navigation uses `?id=` now.

2. **Post-build HTML injection** (`inject-shim.mjs`) over React-rendered `<script>` — Next App Router's serialization (`__next_s.push`) defeats every in-tree approach. The hoist is the only way to guarantee the shim runs before any async chunk.

3. **`useSyncExternalStore` for password gate** over `useState + useEffect` — avoids the `react-hooks/set-state-in-effect` lint rule while correctly handling SSR→client localStorage reads.

4. **Import/export handlers reuse the same parsers/serializers** as the server routes — `parseGift`, `serializeMarkdown`, etc. are pure functions that work identically in Node and browser. No duplication.

## Next steps

1. **Commit + push** the current changes (import/export handlers, password gate) — user needs to approve.
2. **Google Drive login integration** (user expressed interest, deferred to next session):
   - OAuth2 PKCE flow (static-site compatible, no server)
   - `drive.appdata` scope for hidden app-only storage
   - Upload/download `carmenita.db` to user's Drive
   - Debounced sync after mutations
   - ~150 lines, needs a Google Cloud project + OAuth client ID
3. **Analytics endpoints** in the interceptor — the SQL is already in `src/lib/analytics.ts`, just needs to be ported to sql.js queries.
4. **SPA 404.html** fallback for deep-linked quiz URLs.

## Context

- **Repo visibility**: PUBLIC (changed this session)
- **Deploy target**: GitHub Pages at `https://saqr.me/carmenita/`
- **CI runner**: ubuntu-latest, Node 22
- **Shipped DB**: `carmenita.db` — 14 lecture quizzes, 1,492 genetics questions
- **Browser storage**: ~2-3 MB DB, well within IndexedDB limits (see session discussion on capacity)
