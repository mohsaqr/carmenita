# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

Three living documents at the repo root carry context that the code alone doesn't:

- `HANDOFF.md` — current project state, what's done, what's intentionally deferred, key decisions, next steps. Overwritten each session.
- `LEARNINGS.md` — pitfalls and non-obvious discoveries. Each entry cost real debugging time the first time. **Skim before touching pdfjs-dist, format parsers, Drizzle migrations, or LLM prompts.**
- `CHANGES.md` — human-readable changelog (newest first).

The parent workspace `~/Documents/Github/CLAUDE.md` describes the broader multi-project monorepo Carmenita lives in, but Carmenita is a self-contained Next.js app with no runtime dependency on its siblings.

## Commands

```bash
npm run dev            # Next.js dev server (Turbopack) at http://localhost:3000
npm run build          # Production build
npm test               # Vitest, all suites (~200 tests)
npm run test:watch     # Vitest in watch mode
npm run typecheck      # tsc --noEmit (must be 0 errors)
npm run lint           # ESLint (must be 0 errors, 0 warnings)
npm run db:generate    # Generate a new Drizzle migration from src/db/schema.ts
npm run db:migrate     # Apply migrations to ./carmenita.db
npm run db:studio      # Drizzle Studio web UI
```

Run a single test file or pattern:

```bash
npx vitest run src/lib/__tests__/markdown.test.ts
npx vitest run -t "GIFT serializer round-trip"
```

Reset the local database:

```bash
rm -f carmenita.db* && npm run db:migrate
```

The full pre-commit gate is `npm run typecheck && npm test && npm run lint`. All three are expected to be clean.

### Dev server caveats

- The first request to each route compiles in ~2–5s under Turbopack; subsequent requests are fast.
- If `next dev` was killed mid-run, `.next/dev/lock` can stick. Recover with `pkill -9 -f "next dev" && rm -rf .next` before restart.
- Claude Code's Bash sandbox blocks TCP listeners by default — `npm run dev` will hang silently. Either pass `dangerouslyDisableSandbox: true` or have the user start the server themselves with `! npm run dev`.

## Architecture

### The creation hub

`/create` is the single entry point for getting questions into the bank. Four tabs, three different generation paths plus import:

1. **Document → quiz** — `POST /api/generate-quiz` reads a stored `documents` row, runs `chunk.ts`, calls the LLM via `llm-quiz.ts` with the `carmenita.mcq.document` prompt, inserts via the shared helper `insertQuizAndQuestions()` in `src/lib/db-helpers.ts`. `source_type="document"`.
2. **Lecture (PPTX) → quiz** — same endpoint and same helper as Document, but the route detects `.pptx` filenames via `isLectureFilename()` and switches `promptId` to `carmenita.mcq.lecture` (slide-boundary aware). Text extraction uses the JSZip-based `extractPptx()` in `doc-extract.ts`, which emits `--- Slide N ---` markers.
3. **Topic → quiz** — `POST /api/generate-from-topic` uses `src/lib/llm-topic.ts` → `generateQuestionsFromTopic()`. Single LLM call (no chunking), no source document, `carmenita.mcq.topic` prompt with `{topic, subject, level, objectives, mustInclude}` placeholders. `source_type="manual"`.
4. **Import** — `POST /api/bank/import` dispatches to the GIFT/Aiken/Markdown parsers in `src/lib/formats/`. No LLM call. Enhance-after-import is a two-step flow: the Create page's Import tab surfaces a toast with an "Explain" action that deep-links to `/bank?ids=...&action=explain`.

Beyond the four creation paths, there's also **Bank → quiz (assembly)** via `POST /api/bank/quiz` — builds a quiz from already-existing question IDs, no LLM or document, `provider`/`model` hardcoded to `"bank"`.

All generation paths share:
- `insertQuizAndQuestions()` in `db-helpers.ts` for the quiz + questions + junction transaction
- `ensureTags()` in `tag-fallback.ts` for the mandatory-2-tags fallback, applied post-parse before insert
- The same `{quizId, questionCount}` response shape, so the frontend navigates the same way regardless

The exit path is unchanged: `useQuizRunner` drives the UI, `POST /api/attempts` opens an attempt, `PATCH /api/attempts/[id]` submits answers — and the **server recomputes correctness against the stored `correctAnswer`**, ignoring any `isCorrect` the client sends. Don't undo this.

### Enhancement flows

Two bulk enhancement actions on the bank page (requires an active LLM provider):

- **Explain (N)** — `POST /api/bank/questions/explain`. For each selected question, calls `generateExplanation()` in `llm-enhance.ts` (uses the `carmenita.feedback.add` prompt). `onlyIfMissing: true` by default, so repeat clicks are idempotent and cheap. Aborts on 401/403; continues on other errors.
- **Re-tag (N)** — `POST /api/bank/questions/retag`. Calls `generateTagging()` (uses `carmenita.tag.add`). REPLACES (not merges) `subject`/`lesson`/`topic`/`tags`. Same per-question error handling.

Both routes loop sequentially with per-question error handling; a failure on one question does NOT abort the batch unless it's an auth error. Both skip to the next question on transient failures and return `{updated, skipped, errors}` so the UI can report partial success.

### Question bank as a true many-to-many

The most important schema fact: **questions are not owned by quizzes**. The `quiz_questions` junction table `(quiz_id, question_id, idx)` is what links them. Deleting a quiz does NOT delete its questions; they stay in the bank. This is why every API that fetches quiz questions joins through `quizQuestions` ordered by `idx` — see `src/app/api/quizzes/[id]/route.ts` and `src/app/api/attempts/[id]/route.ts`.

When you write new SQL touching questions, ask "is this counting bank questions or quiz questions?" before choosing the join.

### Portable formats: GIFT, Aiken, Markdown

Three round-trip-tested format parsers under `src/lib/formats/`. They all produce/consume the shared `PortableQuestion` type from `formats/types.ts`:

| Format | File | Lossless? | Notes |
|---|---|---|---|
| Markdown | `markdown.ts` | yes | Canonical: `## Q{n}` headers, `**Field:** value` metadata, `- [x]` GitHub checkboxes. Tolerant of header level / list marker / field-name variations. |
| GIFT (Moodle) | `gift.ts` | yes | Handles `~%50%` weighted multi-answer, `$CATEGORY:` slash-paths (round-trip into subject/lesson/topic), per-answer feedback, escapes. |
| Aiken (Moodle) | `aiken.ts` | **no** | Cannot carry feedback, metadata, or mcq-multi. Rejects on export with a reason. The chatbot prompt explicitly lists this. |

These parsers are wired into `/api/bank/import` and `/api/bank/export`. The bank UI at `/bank` is the single source of truth for question CRUD, tagging, importing, exporting, variation generation, and quiz assembly.

### Prompt registry

`src/lib/prompts.ts` is the single source of truth for every LLM system prompt. Five first-class prompts:

| Id | Used by | What it does |
|---|---|---|
| `carmenita.mcq.document` | `/api/generate-quiz` (non-PPTX) | Source-fidelity document generation. Has `{text}` placeholder. |
| `carmenita.mcq.topic` | `/api/generate-from-topic` | Topic-only generation. No `{text}`; has `{topic, subject, level, objectives, mustInclude}`. |
| `carmenita.mcq.lecture` | `/api/generate-quiz` (when `.pptx`) | Slide-aware. Tells the LLM to reconstruct concepts across adjacent `--- Slide N ---` markers. |
| `carmenita.feedback.add` | `/api/bank/questions/explain` | Per-question 1-2 sentence pedagogical explanation. Returns a JSON object, not an array. |
| `carmenita.tag.add` | `/api/bank/questions/retag` | Per-question `{subject, lesson, topic, tags}` derivation. Requires ≥2 tags. |

Plus `carmenita.mcq` kept as a **backwards-compat alias** pointing to the same default as `carmenita.mcq.document`. Any user's existing localStorage override under `carmenita.mcq` still applies. Hidden from the Settings page dropdown to avoid duplicate entries.

Every generation prompt embeds the shared `TAGGING (MANDATORY)` block (topic + ≥2 tags) and `OUTPUT_RULES` block extracted as module constants at the top of `prompts.ts`. This keeps the three generation prompts in lock-step — edit the constant, all three update. The `prompts.test.ts` suite asserts every generation prompt contains `"TAGGING (MANDATORY"` as a regression safety net.

**Auto-tagging fallback**: The prompts require ≥2 tags but LLMs sometimes forget. `ensureTags()` in `tag-fallback.ts` is a pure function that runs AFTER `parseQuestionArray` and BEFORE DB insert, padding missing tags from the topic, subject, lesson, and batch-level defaults. The Zod schema intentionally stays generous so backwards-compat with imported questions isn't broken — the guarantee lives in the fallback layer, not the schema.

**Pure prompt builders for testability**: Alongside async LLM wrappers like `generateQuestionsFromTopic()`, each module exports a pure builder like `buildTopicPrompt()` that returns the rendered prompt string. Tests assert prompt content via substring checks without mocking the `ai` package's `generateText`. Pattern: see `buildVariationPrompt` / `buildTopicPrompt` / `buildExplanationPrompt` / `buildTaggingPrompt`.

### Chatbot prompts with self-consistency tests

`src/lib/formats/chatbot-prompts.ts` exports three LLM prompt templates (`MARKDOWN_PROMPT`, `GIFT_PROMPT`, `AIKEN_PROMPT`) that users copy into ChatGPT/Claude/etc. to generate questions in those formats. Each prompt embeds a **full worked 3-question example**.

`src/lib/__tests__/chatbot-prompts.test.ts` extracts each example back out of the prompt string and runs it through the matching parser. **If you edit a prompt's example and it stops parsing cleanly, the test fails.** This is intentional — it prevents the "I tweaked the prompt and the chatbot's output stopped importing" class of bug. Don't suppress these tests; fix the example.

### Variation lineage

`questions.parent_question_id` is a self-referential FK with `ON DELETE SET NULL` (deliberately, not CASCADE — see HANDOFF.md decision #6). `variation_type` is the enum `topic | distractors | paraphrase | harder | easier`. The Drizzle `relations()` for parent/children must share `relationName: "variation_lineage"` so Drizzle can resolve the self-reference; without that name it silently fails to link them.

Variations always inherit their parent's `subject`/`lesson`/`tags` if the LLM omits them (`v.subject ?? original.subject` in `/api/bank/variations`). Don't remove this fallback — LLMs forget metadata.

### Taxonomy

Three first-class hierarchical columns plus a free-form JSON tag array:

- `subject` (nullable, indexed) → `lesson` (nullable, indexed) → `topic` (required, indexed)
- `tags` is `text("tags", { mode: "json" }).$type<string[]>().default([])`

GIFT `$CATEGORY: biology/plants/photosynthesis` round-trips into 3-segment taxonomy via slash splits. The `/api/bank/taxonomy` endpoint uses SQLite's `json_each()` to explode the tags column for distinct-value queries. Tag filters use `LIKE '%"tagname"%'` (matching the JSON-quoted literal); fine for current scale, would need FTS5 or a junction table at much larger sizes.

### LLM provider layer

`src/lib/ai/providers.ts` is a registry of 10 providers (OpenAI, Anthropic, Google, Groq, Together, Azure, OpenRouter, Ollama, LM Studio, custom). The Zustand store at `src/lib/store.ts` persists user-supplied API keys in `localStorage` under the key `carmenita-storage`, with a deep `merge` function so newly-added providers show up for users who already have saved state.

For local-model providers (LM Studio / Ollama / custom), `POST /api/local-models` probes `{baseUrl}/models` and handles both the OpenAI-compat shape and Ollama's native `/api/tags` shape. The LM Studio default model is the empty string — never seed `"local-model"` as a placeholder, LM Studio rejects it.

### PPTX extraction: zip + regex, not a dedicated library

`.pptx` files are OOXML — standard ZIP archives where text lives inside `ppt/slides/slideN.xml`, wrapped in `<a:t>...</a:t>` DrawingML leaf nodes. `extractPptx()` in `doc-extract.ts` uses **jszip** (pure JS, promoted from transitive to explicit dep) to unzip, a regex `/<a:t[^>]*>([^<]*)<\/a:t>/g` to pull text runs (the `[^<]*` cannot span a tag boundary so it's safe even if future PPTX formats add nesting), and decodes the 5 XML predefined entities with `&amp;` LAST (decoding it first would cause `&amp;lt;` → `&lt;` → `<` incorrectly).

Slide files are sorted **numerically** (not lexically) by extracting the suffix — otherwise `slide10` appears before `slide2`. Text is emitted with `--- Slide N ---` boundary markers so the lecture-mode prompt can reason about slide boundaries.

The synthetic PPTX tests in `doc-extract-pptx.test.ts` build fixtures in-memory via JSZip rather than committing binaries. The fixtures only need `ppt/slides/slideN.xml` files; all the other PPTX support files (rels, theme, presentation.xml) are irrelevant to extraction.

### Why `next.config.ts` lists `serverExternalPackages`

`better-sqlite3`, `pdfjs-dist`, and `mammoth` are all in `serverExternalPackages`. **Do not remove any of them**:

- `better-sqlite3` is a native Node module and cannot be bundled.
- `pdfjs-dist` spawns a "fake worker" by dynamically importing `./pdf.worker.mjs`; bundling breaks that path. We further import the **legacy build** (`pdfjs-dist/legacy/build/pdf.mjs`) and pass a custom `StandardFontDataFactory` that reads fonts from `node_modules/pdfjs-dist/standard_fonts/` via `fs.readFile`. See `src/lib/doc-extract.ts` and the long entries in LEARNINGS.md if either breaks.
- `mammoth` uses dynamic requires for its zip backend.

### Database client singleton

`src/db/client.ts` parks the Drizzle instance on `globalThis.__carmenitaDb`. Two reasons: (1) Next.js dev HMR re-evaluates route modules per request, which would otherwise open a new SQLite handle each time; (2) tests can override `globalThis.__carmenitaDb` with a test-DB instance **before dynamically importing** `@/lib/analytics`, so the analytics functions see the test DB. Import order matters in those tests.

`better-sqlite3` is **synchronous** — Drizzle's better-sqlite3 driver returns values directly, not Promises. The `await`s in code that wraps it are no-ops, but harmless and consistent with other Drizzle drivers.

## Conventions

- **TypeScript strict mode.** `npm run typecheck` must be 0 errors before any commit.
- **Vitest tests run in `node` environment**, not jsdom (`vitest.config.ts:6`). Tests that need a DB seed a real `better-sqlite3` instance via `migrate()`. No mocks.
- **shadcn/ui (style: new-york, base: neutral)**, Tailwind v4, Lucide icons. Aliases live in `components.json`. Don't hand-write primitives if shadcn has one.
- **Server-side scoring** in attempt-submission routes — never trust client-supplied `isCorrect`.
- **API keys live in browser localStorage**, never in env vars or the DB. Each browser/machine sets its own.
- **When adding a new question source**, extend the `QuestionSource` union in `src/db/schema.ts` AND the Zod schema in `src/lib/validation.ts`. SQLite stores it as plain text — no migration needed for enum-only changes.
- **When changing format parsers**, update the corresponding chatbot prompt's worked example AND the round-trip test fixture. The self-consistency tests will catch the second one but not always the first.
- **`carmenita.db` is gitignored.** To start fresh, delete it and re-run `npm run db:migrate`.

## Key files

When you need to find something fast:

- Schema: `src/db/schema.ts`
- DB singleton: `src/db/client.ts`
- Shared quiz-insert helper: `src/lib/db-helpers.ts`
- LLM pipeline (document + lecture): `src/lib/llm-quiz.ts`
- LLM pipeline (topic): `src/lib/llm-topic.ts`
- LLM pipeline (explain + retag): `src/lib/llm-enhance.ts`
- Auto-tag fallback: `src/lib/tag-fallback.ts`
- Prompt registry: `src/lib/prompts.ts`
- Zod schema + parser: `src/lib/question-schema.ts`
- Chunking: `src/lib/chunk.ts`
- Document extraction (PDF/DOCX/PPTX/XLSX/TXT): `src/lib/doc-extract.ts`
- Format parsers: `src/lib/formats/{markdown,gift,aiken,types,chatbot-prompts}.ts`
- Variations: `src/lib/llm-variations.ts`
- Analytics SQL: `src/lib/analytics.ts`
- Provider registry: `src/lib/ai/providers.ts`
- Zustand store: `src/lib/store.ts`
- API routes: `src/app/api/**/route.ts` (26 routes)
- Unified creation page: `src/app/create/page.tsx`
- Bank UI (the main control panel): `src/app/bank/page.tsx`
- Reusable ImportCard: `src/components/ImportCard.tsx`
- Quiz runner state machine: `src/hooks/useQuizRunner.ts`
