# Carmenita — Project Learning Log

Pitfalls, data quirks, and non-obvious discoveries from building Carmenita. Read this before starting a new task — each entry cost real debugging time to figure out the first time.

### 2026-04-08 (Unified Creation Hub session)

- **PPTX is a ZIP of XML, not a proprietary format**: `.pptx` files are OOXML — a standard zip archive with `ppt/slides/slide*.xml` as the per-slide text. No dedicated PPTX library needed. A regex on `<a:t>…</a:t>` (DrawingML leaf text nodes) plus JSZip gets you all the slide text. Use `[^<]*` inside the regex (not `.*?`) so it can never span a tag boundary if the format ever nests markup inside text runs.

- **Sort slides numerically, not lexically**: JSZip's `.forEach` enumeration order is not guaranteed, and lexicographic sort puts `slide10.xml` before `slide2.xml`. Parse the numeric suffix via regex and sort by the number.

- **Decode XML entities with `&amp;` LAST**: The 5 XML predefined entities are `&amp; &lt; &gt; &quot; &apos;`. If you decode `&amp;` first, a string like `&amp;lt;` becomes `&lt;` and then `<`, which is wrong (the original was literally `&lt;` in the source text, not `<`). Decoding `&amp;` last preserves intent.

- **`jszip` was already a transitive dependency** (pulled in by mammoth or xlsx). Adding it as an explicit dep in `package.json` is a no-op at install time but ensures version pinning — if mammoth ever drops jszip, our PPTX code won't silently break. Check `package-lock.json` before running `npm install` for a "new" dep; it might already be there.

- **Pure prompt builders are dramatically cheaper to test than LLM wrappers**: Exporting `buildTopicPrompt`, `buildExplanationPrompt`, `buildTaggingPrompt` as pure functions (separate from the async `generate*` wrappers) lets tests use plain substring assertions instead of mocking the `ai` package's `generateText`. The existing `buildVariationPrompt` in `llm-variations.ts` already followed this pattern — follow it for every new LLM call.

- **Render-stage placeholder substitution with `renderPrompt()` leaves unmatched placeholders in place**: This is intentional (`src/lib/prompts.ts:111` uses `\{(\w+)\}` + fallback to original match). It means you can share a template across modes where some modes don't fill every slot. Downside: a typo in a placeholder name silently leaks `{subject}` into the final prompt. Mitigation: test every generation prompt with a test that asserts `expect(p).not.toMatch(/\{subject\}/)` after substitution.

- **`react-dropzone` `accept` map wants BOTH MIME type AND extension array**: For PPTX, the MIME is `application/vnd.openxmlformats-officedocument.presentationml.presentation` (yes, it's that long) and the extensions array is `[".pptx"]`. Some browsers send the generic `application/octet-stream` for OOXML files, so relying on MIME alone is fragile — the extension array is the safety net.

- **shared DB helper transaction pattern pays off fast**: Moving the `insertQuizAndQuestions` transaction out of `/api/generate-quiz/route.ts` into `src/lib/db-helpers.ts` saved ~50 lines of duplication when the second route (`/api/generate-from-topic`) landed. It also became the natural place to apply `ensureTags()` — one call site guarantees every generation route gets the same tag fallback.

- **`onlyIfMissing: true` default on bulk enhance makes repeat-clicks idempotent**: The user can hit "Explain (50)" twice and only pay for the LLM calls once — the second call skips anything already explained. Works because imported questions have `explanation = ""` and document-generated questions have explanations. This is the same declarative-reconciliation pattern Kubernetes uses.

- **Auth errors (401/403) should abort bulk LLM loops; other errors should continue**: A bad API key will fail every single question identically, so looping is wasted work. Rate limits or per-question malformed JSON might be transient, so per-question continuation gives partial progress. Both explain and retag routes follow this rule — see `src/app/api/bank/questions/explain/route.ts` error branch.

- **Deep-link query params should be consumed then stripped**: When `/create` Import tab deep-links to `/bank?ids=...&action=explain`, the bank preselects those ids and then calls `router.replace("/bank")` to strip the query string. Without the strip, a page refresh re-triggers the preselect, which is confusing if the user has since clicked elsewhere. This is the general "one-shot query param" pattern.

- **Backwards-compat aliases in a registry-driven UI need to be hidden from the picker**: `carmenita.mcq` is still in the `PROMPTS` registry (so old localStorage overrides apply) but NOT in the Settings page prompt dropdown (so users don't see two entries for the same thing). Filter the UI iteration, keep the registry complete.

- **`ensureTags` stays pure and non-destructive**: Takes a question in, returns a NEW question with normalized tags. Tests assert immutability (`frozenTags === q.tags` after calling `ensureTags`). Purity makes the function trivially testable and safe to call anywhere in the pipeline.

- **Adding `promptId` to a generation API doesn't require versioning the route**: The existing `systemPromptOverride` escape hatch already existed for per-call customization. Adding `promptId` as an alternative selector (pick from registry) is orthogonal — old callers that don't pass it get the default, new callers that do pick a specific template. No migration.

- **The `react-hooks/exhaustive-deps` rule correctly flags preselect effects**: When a useEffect should run AFTER a specific state change (like `all !== null` after the bank loads), the intent is usually "once, gated on a specific transition". The hook rule wants you to list every captured variable, but that leads to re-runs you don't want. The right fix is an inline `// eslint-disable-next-line` with a comment explaining WHY the deps are intentional, not rewriting to chase the lint.

### 2026-04-08

- **pdfjs-dist in Node/Next.js server routes**: the default `pdfjs-dist` entry point is browser-only and tries to spawn a Web Worker by dynamically importing `./pdf.worker.mjs`. Webpack bundling munges that path lookup and you get `Setting up fake worker failed: Cannot find module …`. Fix: import the legacy build — `await import("pdfjs-dist/legacy/build/pdf.mjs")` — which runs synchronously on the main thread. Also set `useWorkerFetch: false`, `isEvalSupported: false`, `disableFontFace: true` in the `getDocument()` options.

- **pdfjs-dist standard fonts in Node**: after the legacy-build fix, you still get `UnknownErrorException: Ensure that the standardFontDataUrl API parameter is provided`. pdfjs tries to fetch standard fonts (Helvetica, Times, Liberation Sans etc.) via `fetch(file://…)` which Node's built-in fetch rejects. Fix: provide a custom `StandardFontDataFactory` class that reads the font files from `node_modules/pdfjs-dist/standard_fonts/` via `fs.readFile`. The legacy build path is `pdfjs-dist/standard_fonts` (no `legacy/build/` prefix — this is a separate directory at the package root).

- **Next.js `serverExternalPackages`**: `pdfjs-dist`, `mammoth`, and `better-sqlite3` all need to be listed in `next.config.ts` under `serverExternalPackages`. Otherwise the bundler (Webpack or Turbopack) tries to bundle them and breaks their relative-path internal resolution (pdfjs) or their native-module loading (better-sqlite3). This is a Next.js framework-level config and applies to both dev bundlers.

- **Drizzle SQLite enum columns are TS-level only**: adding a new value to `text("source_type", { enum: [...] })` does NOT require a migration. The enum is enforced in TypeScript but the DB column is plain TEXT with no CHECK constraint. You can add `"variation"` to the enum and Drizzle says "No schema changes, nothing to migrate".

- **`drizzle-kit generate` is idempotent for enum changes** but NOT for column additions — always run it after any `schema.ts` edit to see whether a migration is needed.

- **SQLite JSON array querying via LIKE**: for a column like `tags text mode json` storing `["a","b","c"]`, query by tag with `LIKE '%"tagname"%'` (match the quoted literal including the quotes). Escape any `"` in the tag value. Works for small-to-medium banks. For bigger datasets, use a junction table or FTS5.

- **`json_each()` for exploding JSON array columns**: to get distinct tag values across a table with a JSON array column, use `SELECT DISTINCT value FROM questions, json_each(questions.tags) ORDER BY value`. Available in SQLite 3.38+.

- **better-sqlite3 is synchronous** — Drizzle's better-sqlite3 driver has `db.all/get/run` return values directly, not Promises. Async functions wrapping them still work but the `await` is a no-op.

- **LM Studio default model is NEVER valid**: the string `"local-model"` I seeded as the default `defaultModel` for LM Studio is rejected by LM Studio's API with `Invalid model identifier "local-model". Please specify a valid downloaded model (e.g. google/gemma-4-26b-a4b@q4_k_m …)`. Fix: seed the default as an empty string and provide a **Load models** button that probes `{baseUrl}/models` (OpenAI-compat endpoint) and lets the user pick from the real list.

- **Ollama's default `"llama3"` IS valid** as a default model id — Ollama accepts the common shortnames (llama3, mistral, qwen2, etc.) that users typically have installed.

- **Local LLM model discovery is free via `{baseUrl}/models`**: LM Studio, Ollama (when run in OpenAI-compat mode at `/v1`), and most custom OpenAI-compatible servers all expose `GET /models` returning an OpenAI-compatible list. One small server-side fetch probe covers all three. Ollama's native `GET /api/tags` has a different shape (`{models: [{name: "..."}]}`) — the probe route handles both.

- **React 19's `react-hooks/set-state-in-effect` rule fires on valid SSR hydration patterns**: `setMounted(true)` or `setValue(sessionStorage.getItem(...))` inside a `useEffect(() => {}, [])` is the correct SSR-safe pattern but the new React Compiler rule flags it. Disable with a per-line `// eslint-disable-next-line react-hooks/set-state-in-effect` comment. Don't try to rewrite with `useSyncExternalStore` — it's more complex and the hydration pattern is legitimate.

- **React 19's `react-hooks/purity` rule fires on `useRef<number>(performance.now())`**: `performance.now()` is "impure" in the render phase. Fix: lazy-init with `useRef<number>(0)` and set `timerStart.current = performance.now()` on first use inside a callback. Don't disable the rule — the fix is trivial and the lint message is correct.

- **React 19's useMemo dependency lint for conditional values**: `const effectiveOptions = cond ? a : b;` outside a useMemo is flagged if it's used inside another useMemo's deps. Wrap in its own `useMemo(() => (cond ? a : b), [cond, a, b])` to give it a stable reference.

- **`next dev` can get stuck on `.next/dev/lock`** (both Webpack and Turbopack): if a previous dev process didn't cleanly release the lock, the new instance falls back to port 3001 and fails to compile properly. Fix: `pkill -9 -f "next dev"` plus `lsof -iTCP:3000 -sTCP:LISTEN -t` to find any detached `next-server` child (pkill may not catch it because `argv[0]` doesn't contain "next dev"), then `rm -rf .next` before restart. Observed multiple times, most recently on 2026-04-08 under Turbopack.

- **Claude Code's Bash tool runs in a sandbox that blocks TCP listeners by default**: `npm run dev` spawns but the `listen()` call blocks forever silently. Even `python3 -m http.server` can't bind. Workaround: use `dangerouslyDisableSandbox: true` on the Bash tool call, OR tell the user to start the server themselves with `! cd /path && npm run dev`.

- **Markdown format `**Field:**` parsing**: the closing `**` comes AFTER the colon, not before. So `**Question:** text` has the structure: opening `**`, then `Question:`, then closing `**`, then the value. A regex like `^\*{1,2}([A-Za-z][\w ]+?)(?:\*{1,2})?\s*:\s*(.*)$` is WRONG because it matches `Question` as the field name and keeps the `** ` in the value. The correct regex captures the opening asterisks as a backreference and matches them again after the colon: `^\s*(\*{1,2})([A-Za-z][\w ]+?)\s*:\s*\1\s*(.*)$`. Discovered when 12 round-trip tests failed with `"question": "** Which of these…"` outputs.

- **GIFT per-question `$CATEGORY:` needs a blank line after it** in the serialized output, otherwise the parser's block splitter treats the directive as the first line of the question block and skips the whole question. Add `out.push("")` after every `$CATEGORY:` line.

- **GIFT multi-answer with weighted `~%50%Red` syntax**: entries with positive weights ARE correct answers. The parser needs to track weights (`%number%` prefix between `~` and the option text) and mark positive-weight `~` entries as correct alongside the `=` ones. Without this, weighted multi-answer questions parse with "No correct answer marked" and get dropped.

- **Aiken format is lossy by design**: cannot carry explanations, feedback, difficulty, Bloom level, topic categories, or multi-answer questions. If the user wants ANY metadata they must use GIFT or Markdown. The Aiken chatbot prompt must explicitly list these limitations so LLMs don't try to emit extensions like `FEEDBACK:` that Aiken parsers reject.

- **Chatbot prompts need embedded worked examples**: without a concrete example, even GPT-4o/Claude 3.5 produce subtly wrong output (missing fields, wrong enum values, code fences around the output). With a full 3-question worked example covering each question type, strict output compliance jumps dramatically. Enforce prompt self-consistency via tests: extract the example from each prompt and run it through the target parser in vitest. If the parser fails, the test fails.

- **LLMs love to wrap output in ` ```markdown ` code fences** even when told not to. The parser must strip markdown code fences (` ``` ` and ` ```json `) as a preprocessing step. Handled in `stripCodeFences()` in `question-schema.ts` and the format parsers.

- **Drizzle `relations()` self-reference needs a relationName**: for `parent: one(questions, {...}), variations: many(questions, {...})` on the same questions table, both relations must share a `relationName: "variation_lineage"` prop so Drizzle knows they refer to the same foreign-key edge. Without the name, it silently fails to link them.

- **Zustand `persist` + `merge` pattern for adding new providers**: if you add a new provider to `DEFAULT_PROVIDERS` after users have already saved their localStorage, the new provider won't show up unless the persist `merge` function deep-merges saved state with current defaults. The carmenita store inherits this pattern from handai; see `src/lib/store.ts:129`.

- **Carmenita runs on `next dev --turbopack`**: first-compile per route is ~2–5s (vs Webpack's 5–25s on the same project); subsequent requests are <100ms. The `serverExternalPackages` config in `next.config.ts` handles `better-sqlite3`/`pdfjs-dist`/`mammoth` identically under both bundlers at the Next.js framework level, so the native-module externalization notes below apply to Turbopack too. `next dev --webpack` is still a valid fallback if a Turbopack-specific bug appears.

- **Tests run in Node environment, not jsdom**: `vitest.config.ts` specifies `environment: "node"`. The tests that seed a real SQLite DB via `migrate()` work because better-sqlite3 is a synchronous native module that works fine in Node-environment tests. No mock/jsdom setup needed.

- **Module-level singletons survive across test files** via `globalThis`: the analytics test overrides `globalThis.__carmenitaDb` with a test-DB instance before importing `@/lib/analytics`, so the analytics functions see the test DB instead of `carmenita.db`. Dynamic import order matters — the override must happen before the `await import()`.

- **Drizzle migration 0000 generated as a single file** even with 6 tables + multiple indices. No need to split into multiple files unless schema evolution requires it.

- **`prefer-const` lint rule catches `let questionExtra: string[] = []`** even though the array is mutated via `.push()`. Array mutation is not reassignment, so `const` is correct. Switched to `const questionExtra: string[] = []`.

- **pdfjs-dist 4.x with custom StandardFontDataFactory class**: passing the class itself (not an instance) as `StandardFontDataFactory: NodeStandardFontDataFactory` works. pdfjs instantiates it internally. Using `as any` cast is required because the TypeScript type for the factory is more constrained than what we provide.

- **`parent_question_id` should use `ON DELETE SET NULL`, not CASCADE**: when you delete a parent question, you want its variations to remain in the bank as standalone questions. Cascade-delete would nuke them. This only matters for the variation lineage feature.

- **GIFT `$CATEGORY:` hierarchical mapping**: slash-separated paths like `biology/plants/photosynthesis` split as: last segment → topic, middle → lesson, first → subject. 1-segment → topic only. 2-segment → lesson+topic. 3+ → full. 4+ → middle parts get rejoined into lesson (e.g. `school/biology/plants/photo` → `subject=school, lesson=biology/plants, topic=photo`).
