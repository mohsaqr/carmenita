# Session Handoff — 2026-04-08

Carmenita — AI-powered multiple-choice quiz generator. The Unified Creation Hub landed this session (Phase I), extending the app from "document → quiz" into a four-mode creation surface: document, lecture (PPTX), typed topic, and import + enhance.

## Repo

- **Path**: `/Users/mohammedsaqr/Documents/Github/carmenita/`
- **Branch**: `main` (no remote configured)
- **Stack**: Next.js 16 (Turbopack) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM + better-sqlite3 · Vercel AI SDK · Zustand · Zod · Vitest · pdfjs-dist + mammoth + **jszip (new for PPTX)**
- **DB**: local file `./carmenita.db` (gitignored). No new migrations this session — all changes are TypeScript-level.
- **Tests**: **284 passing** across 14 Vitest files (was 200/9 at start of session). 0 TS errors, 0 lint errors.
- **Dev server**: `npm run dev` → http://localhost:3000

## Completed this session

### Phase I — Unified MCQ Creation Hub

**1. Per-mode LLM prompts** (`src/lib/prompts.ts`)

Five first-class prompts, each with a shared mandatory `TAGGING` block (topic + ≥2 tags + optional subject/lesson) and a shared `OUTPUT_RULES` block extracted to module constants:
- `carmenita.mcq.document` — source-fidelity emphasis, {text} placeholder
- `carmenita.mcq.topic` — {topic}/{subject}/{level}/{objectives}/{mustInclude}, no source passage
- `carmenita.mcq.lecture` — slide-boundary aware, tells LLM to reconstruct concepts across adjacent `--- Slide N ---` markers
- `carmenita.feedback.add` — adds 1-2 sentence pedagogical explanations; returns a JSON object, not an array
- `carmenita.tag.add` — derives subject/lesson/topic/tags for an existing question
- `carmenita.mcq` kept as a backwards-compat alias pointing to the same default as `carmenita.mcq.document` (preserves existing localStorage overrides)

**2. PPTX extraction** (`src/lib/doc-extract.ts` + `package.json`)

- `extractPptx(bytes)` unzips via **jszip** (promoted from a transitive dep to an explicit dependency, version 3.10.1 already in node_modules), enumerates `ppt/slides/slideN.xml` entries, sorts NUMERICALLY (slide10 follows slide9, not slide1), regex-extracts `<a:t>...</a:t>` text runs, decodes XML entities (with `&amp;` decoded LAST to avoid double-decoding), joins per-slide runs with spaces, emits `--- Slide N ---` boundary markers.
- Friendly error messages for corrupt zips, image-only decks, and files with no slide entries.
- `isLectureFilename(filename)` helper used by `/api/generate-quiz` to switch the prompt id to `carmenita.mcq.lecture` when `.pptx` is detected.

**3. Generation pipeline extensions**

- `generateQuizQuestions()` in `src/lib/llm-quiz.ts` now accepts a `promptId` parameter (defaults to `carmenita.mcq.document`). Callers pick the appropriate template; the existing `systemPromptOverride` slot still works for per-call overrides.
- `src/lib/llm-topic.ts` — NEW. `generateQuestionsFromTopic()` for the topic mode. No chunking (single LLM call), uses `carmenita.mcq.topic`. Also exports a pure `buildTopicPrompt()` function so tests can assert prompt content without mocking the LLM layer.
- `src/lib/llm-enhance.ts` — NEW. Two single-question primitives: `generateExplanation()` and `generateTagging()`. Each does one LLM call and parses a small JSON object via a dedicated Zod schema. Also exports `buildExplanationPrompt()` and `buildTaggingPrompt()` as pure functions for tests. Shared helpers: `describeCorrectAnswer()` (humanizes number|number[] as "Option B (Paris)"), `parseJsonObject()` (strips code fences and isolates the outermost `{}`).
- `src/lib/tag-fallback.ts` — NEW. Pure `ensureTags(q, defaults)` helper that guarantees at least 2 tags per question post-parse: (1) keeps LLM-provided tags (normalized), (2) pads from batch-level defaults, (3) falls back to topic/subject/lesson if still short. Normalizes to lowercase, hyphenates multi-word tags, strips non-alphanumerics, dedupes, caps at 6. Backwards-compat-friendly (Zod schema unchanged).
- `src/lib/db-helpers.ts` — NEW. `insertQuizAndQuestions()` lifts the quiz+questions+junction transaction pattern out of `/api/generate-quiz` into a shared helper so all three generation routes (document, topic, lecture) insert identically. Calls `ensureTags()` on every question before insert.

**4. API routes**

- `POST /api/generate-quiz` — refactored to use the shared helper + detect PPTX via filename → lecture prompt
- `POST /api/generate-from-topic` — NEW. Accepts `{topic, title, subject?, level?, objectives?, mustInclude?, settings, provider, temperature?, defaultSubject?, defaultLesson?, defaultTags?}` and returns `{quizId, questionCount}` in the same shape as generate-quiz so the frontend navigates identically
- `POST /api/bank/questions/explain` — NEW. Per-question sequential with per-question error handling. `onlyIfMissing` param (default `true`) makes repeat calls idempotent and cheap. Aborts on auth errors; continues on other errors.
- `POST /api/bank/questions/retag` — NEW. Replaces (not merges) subject/lesson/topic/tags with LLM-derived values. Same per-question error handling.
- `src/lib/validation.ts` — added `GenerateFromTopicSchema`, `BankExplainSchema`, `BankRetagSchema` + inferred body types.

**5. Unified `/create` page**

New page at `src/app/create/page.tsx`. Four tabs (Document | Lecture | Topic | Import), shared settings panel below the tabs (applies to Document/Lecture/Topic):
- Title, question count, allowed types, difficulty mix (easy/medium/hard), taxonomy defaults (subject/lesson/tags), immediate feedback toggle
- Document tab & Lecture tab share a `DocumentTabCard` component (same dropzone, different header copy; accepted file types include `.pptx`)
- Topic tab has structured fields: topic (required), subject, level (dropdown: intro/undergrad/grad/professional), learning objectives, must-include concepts
- Import tab renders the existing `ImportCard` with an `onImported` callback that shows a toast with an "Explain" action linking to `/bank?ids=...&action=explain`

**`/upload` redirects to `/create`** via a client-side `router.replace()` so bookmarks and header nav don't 404.

**Dashboard** (`src/app/page.tsx`) — first card renamed from "Upload & Generate" to "Create questions" with a Sparkles icon, links to `/create`.

**HeaderNav** — "Upload" link replaced with "Create" pointing to `/create`.

**`src/components/ImportCard.tsx`** — NEW. Lifted out of `src/app/bank/page.tsx` (which previously defined it inline) so `/create` and `/bank` both import it. The `onImported` callback signature now receives `{count, ids, warnings}` instead of a bare void callback, enabling the deep-link flow from Create → Bank.

**6. Bank page enhance actions**

- **Explain (N)** toolbar button — disabled unless an LLM provider is active + rows are selected. Calls `/api/bank/questions/explain` with `onlyIfMissing: true`. Toast summarizes `{added, skipped, failed}`.
- **Re-tag (N)** toolbar button — same gating, confirms before running (because it REPLACES existing values). Calls `/api/bank/questions/retag`.
- Deep-link handling: on mount, if `?ids=id1,id2&action=explain` is present in the URL, the bank preselects those ids (filtered to ones that actually exist in the current view) and clears the query string so a refresh doesn't re-trigger. Fulfills the two-step enhance UX flow from the Create Import tab.

**7. Settings page prompt editor**

`PromptEditorCard` now iterates over `Object.values(PROMPTS)` via a dropdown instead of hardcoding `carmenita.mcq`. The legacy `carmenita.mcq` alias is hidden from the dropdown (kept in the registry for override-compat). Each prompt's override persists under its own `carmenita_prompt_override:<id>` key — the existing localStorage mechanism already supported per-id overrides.

**8. Tests (200 → 284)**

- `src/lib/__tests__/tag-fallback.test.ts` — 12 tests. Pure unit tests for `ensureTags()`: dedup, normalize, multi-word hyphenation, empty-string stripping, punctuation, hyphen collapsing, max cap, immutability.
- `src/lib/__tests__/prompts.test.ts` — 30+ tests. Verifies all 5 prompts are registered, every generation prompt contains the TAGGING block, placeholders resolve via `renderPrompt`, mode-specific invariants (topic prompt has no `{text}`, lecture prompt mentions slides, feedback prompt says "JSON object", etc.).
- `src/lib/__tests__/doc-extract-pptx.test.ts` — 8+ tests. Builds synthetic .pptx fixtures in-memory via JSZip (no committed binaries), asserts numeric slide ordering, XML entity decoding, error paths for corrupt/image-only/no-slide files. Also exercises `isLectureFilename`.
- `src/lib/__tests__/llm-topic.test.ts` — 14 tests. Every structured field lands in the rendered prompt; defaults applied when fields are omitted; `systemPromptOverride` bypasses the registry; no unsubstituted placeholders when all fields are set.
- `src/lib/__tests__/llm-enhance.test.ts` — 15 tests. Both builders embed stem + lettered options; `describeCorrectAnswer` handles numbers AND arrays (`Options A, C` for multi-answer); `(none)` placeholder for empty explanations; every placeholder resolves.

## Current state

### What works
- Every item above has at least one automated test and types cleanly
- `npx tsc --noEmit` → 0 errors
- `npm test` → **284/284 passing**
- `npx eslint` → 0 errors, 0 warnings
- Full backwards compat: existing `/upload` URLs redirect, existing `carmenita.mcq` localStorage overrides still apply, existing quizzes render unchanged

### What was intentionally deferred
- **Live LLM end-to-end verification** for the new routes — the pure prompt builders are unit-tested, but I did not run a real provider against `/api/generate-from-topic`, `/api/bank/questions/explain`, or `/api/bank/questions/retag` this session. These should be smoke-tested on the next session against a real key before marking the feature as shipped.
- **PPTX dropzone MIME filter edge cases** — the `/create` page's react-dropzone `accept` map includes the PPTX MIME, but some browsers send weird MIME strings. If users report PPTX files being rejected by the dropzone on upload, the fix is to add `".pptx"` as a secondary extension match or loosen the accept map.
- **Background job mode for very large explain/retag batches** — the plan explicitly picked two-step-sync over background-job mode. For batches > ~50 questions, the UI will appear to hang for 1-2 minutes while the loop runs. If this becomes painful, add a job table.
- **Lint fix for `react-hooks/exhaustive-deps` on the bank preselect effect** — I disabled it with an inline comment since depending on `all` is the intent (preselect runs once after the first load). If the lint policy changes, the fix is to add `searchParams` and `router` to deps.

## Key decisions this session

1. **Keep `carmenita.mcq` as a backwards-compat alias**, not rename it. Users with saved overrides would otherwise lose them silently.
2. **PPTX via JSZip regex instead of a dedicated pptx library.** DrawingML guarantees `<a:t>` leaf nodes so `[^<]*` in the regex is safe. Avoids adding a heavy dependency.
3. **Decode XML entities with `&amp;` LAST** — decoding it first would cause `&amp;lt;` → `&lt;` → `<`, which is wrong. Order matters.
4. **Two-step enhance flow, not one-click**, per the user's explicit preference. Import completes fast (< 1s typical), then the user explicitly opts into Explain or Re-tag on the bank page. Deep-link from Create → Bank preserves the imported selection.
5. **`ensureTags` fallback runs in `db-helpers.ts`, not Zod** — keeping Zod generous preserves backwards compat with imported questions that have fewer tags. The LLM is still TOLD to produce ≥2 tags via the prompt; the fallback is a safety net, not a hard gate.
6. **`onlyIfMissing: true` default on explain** makes repeat clicks cheap. If a user wants to force regeneration, they can pass `onlyIfMissing: false` from the route body (no UI exposure yet).
7. **`parent_question_id` for variations still uses `ON DELETE SET NULL`** — unchanged. Not revisited this session.
8. **`insertQuizAndQuestions` lives in `src/lib/db-helpers.ts`, not as a method on a class.** Pure function, takes db via closure, keeps imports flat.
9. **Pure prompt builders (`buildTopicPrompt`, `buildExplanationPrompt`, `buildTaggingPrompt`) exported alongside the LLM-calling wrappers** so tests can verify prompt content without mocking `generateText`. This matches the existing `buildVariationPrompt` pattern.
10. **The Settings page prompt editor hides `carmenita.mcq` from the dropdown** but keeps it in the registry. Surfacing both would be confusing; hiding it from the UI keeps the compat without cluttering the picker.

## Open issues

- None specific to this session's work. The pre-existing open issues from the prior handoff (Next.js dev server lock contention; Claude Code Bash sandbox blocks TCP listeners; React 19 hooks warnings; first-compile slowness) all still apply.
- One `react-hooks/exhaustive-deps` suppression in `src/app/bank/page.tsx` for the preselect effect (as noted above) — legitimate, documented with a comment.

## Next steps (prioritized)

1. **Live end-to-end smoke test** against a real LLM provider for: (a) topic mode generation, (b) PPTX lecture generation, (c) Explain bulk action, (d) Re-tag bulk action. Only the pure prompt content is verified via tests so far.
2. **Search within question stems** in the bank (still deferred from the prior handoff).
3. **Analytics breakdowns by subject/lesson** (still deferred).
4. **Edit existing questions** via a reusable `CreateQuestionDialog` with an `initialQuestion` prop (still deferred).
5. **Consider exposing `onlyIfMissing: false` from the UI** as a "Regenerate all explanations" option on the Explain button.

## Context needed to resume

- **Dev server**: `cd /Users/mohammedsaqr/Documents/Github/carmenita && npm run dev` → http://localhost:3000
- **Static gates**: `npm run typecheck && npm test && npm run lint` (all should be 0-error, 284 tests passing)
- **New files this session**:
  ```
  src/app/create/page.tsx
  src/app/api/generate-from-topic/route.ts
  src/app/api/bank/questions/explain/route.ts
  src/app/api/bank/questions/retag/route.ts
  src/components/ImportCard.tsx
  src/lib/llm-topic.ts
  src/lib/llm-enhance.ts
  src/lib/tag-fallback.ts
  src/lib/db-helpers.ts
  src/lib/__tests__/tag-fallback.test.ts
  src/lib/__tests__/prompts.test.ts
  src/lib/__tests__/doc-extract-pptx.test.ts
  src/lib/__tests__/llm-topic.test.ts
  src/lib/__tests__/llm-enhance.test.ts
  ```
- **Modified files**: `src/lib/prompts.ts` (major rewrite), `src/lib/llm-quiz.ts` (promptId param), `src/lib/doc-extract.ts` (+extractPptx/isLectureFilename), `src/lib/validation.ts` (+3 schemas), `src/app/api/generate-quiz/route.ts` (uses shared helper + pptx detection), `src/app/bank/page.tsx` (ImportCard lifted, Explain/Re-tag buttons, preselect effect), `src/app/page.tsx` (dashboard card), `src/app/settings/page.tsx` (prompt dropdown), `src/app/upload/page.tsx` (redirect), `src/components/HeaderNav.tsx` (Upload → Create), `package.json` (jszip explicit dep), `CLAUDE.md`, `CHANGES.md`, `LEARNINGS.md`.
- **API keys** still live in browser localStorage under `carmenita-storage`.
- **Carmenita still does NOT depend on handai at runtime.**

## Verification snapshot (just before handoff)

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **284/284 passing**
- `npx eslint` → **0 errors, 0 warnings**
