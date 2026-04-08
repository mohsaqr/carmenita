# Carmenita — Change Log

Human-readable changelog independent of git. Newest entries at top.

### 2026-04-08 — Unified Creation Hub (Phase I)

Unifies document generation, PPTX lecture generation, typed-topic generation, and MCQ import under a single `/create` entry point. Adds bulk Explain + Re-tag enhance actions to the bank. Replaces the legacy `/upload` page.

- `src/lib/prompts.ts`: **major rewrite**. Five first-class prompts (`carmenita.mcq.document`, `carmenita.mcq.topic`, `carmenita.mcq.lecture`, `carmenita.feedback.add`, `carmenita.tag.add`) each embedding a shared TAGGING (MANDATORY) block that requires topic + ≥2 tags. Shared `OUTPUT_RULES` and `QUESTION_SHAPE` constants keep all generation prompts in sync. Legacy `carmenita.mcq` alias retained for backwards-compat with existing localStorage overrides.
- `src/lib/doc-extract.ts`: added `extractPptx()` using jszip. Parses `ppt/slides/slide*.xml` in numeric order, regex-extracts `<a:t>` text runs, decodes XML entities, emits `--- Slide N ---` boundary markers. Added `isLectureFilename()` helper for prompt-id dispatch. Graceful errors for corrupt zips, image-only decks, and empty slide decks.
- `package.json`: promoted `jszip ^3.10.1` from transitive dep to explicit dependency (already in `node_modules`).
- `src/lib/llm-quiz.ts`: `generateQuizQuestions` now accepts `promptId` (defaults to `"carmenita.mcq.document"`) plus `defaultSubject`/`defaultLesson` hints. Passes them through `renderPrompt`.
- `src/lib/llm-topic.ts`: NEW. `generateQuestionsFromTopic()` for topic mode (single LLM call, no chunking). Exports `buildTopicPrompt()` as a pure function for testing.
- `src/lib/llm-enhance.ts`: NEW. `generateExplanation()` and `generateTagging()` — single-question primitives used by the bulk bank actions. Each returns a parsed Zod-validated JSON object. Exports `buildExplanationPrompt()` and `buildTaggingPrompt()` pure functions. Shared `describeCorrectAnswer()` humanizes number|number[] as "Option B (Paris)" or "Options A, C (Red; Blue)".
- `src/lib/tag-fallback.ts`: NEW. Pure `ensureTags(q, defaults)` helper. Normalizes (lowercase, hyphenate, dedupe, strip punctuation, cap at 6), pads from batch defaults → topic → subject → lesson when LLM produced fewer than 2 tags. Guarantees at least 1 tag for any question with a non-empty topic. Zod schema unchanged (backwards-compat).
- `src/lib/db-helpers.ts`: NEW. `insertQuizAndQuestions()` lifts the quiz+questions+junction transaction pattern out of `/api/generate-quiz/route.ts` into a shared helper. Calls `ensureTags()` on every question before insert. Used by both `/api/generate-quiz` and `/api/generate-from-topic`.
- `src/lib/validation.ts`: added `GenerateFromTopicSchema`, `BankExplainSchema`, `BankRetagSchema`.
- `src/app/api/generate-quiz/route.ts`: REFACTORED to use the shared helper; detects `.pptx` filenames via `isLectureFilename()` → sets `promptId: "carmenita.mcq.lecture"`.
- `src/app/api/generate-from-topic/route.ts`: NEW. `POST` route that validates `GenerateFromTopicSchema`, calls `generateQuestionsFromTopic`, inserts via the shared helper. Response shape matches `/api/generate-quiz` so the frontend navigates identically.
- `src/app/api/bank/questions/explain/route.ts`: NEW. Per-question sequential LLM loop. `onlyIfMissing: true` default (idempotent repeat clicks). Aborts on 401/403, continues on other errors. Returns `{updated, skipped, errors}`.
- `src/app/api/bank/questions/retag/route.ts`: NEW. Same error-handling model as explain. REPLACES (not merges) subject/lesson/topic/tags with LLM-derived values.
- `src/app/create/page.tsx`: NEW. Unified creation page with 4 tabs (Document | Lecture | Topic | Import) and a shared settings panel. Document and Lecture tabs share a `DocumentTabCard` sub-component (dropzone + extract UI). Topic tab has structured fields (topic + subject + level + objectives + must-include). Import tab renders `ImportCard`. Successful import shows a toast with an "Explain" action linking to `/bank?ids=...&action=explain`.
- `src/app/upload/page.tsx`: REPLACED with a client-side redirect to `/create`. Preserves existing bookmarks.
- `src/components/ImportCard.tsx`: NEW. Lifted out of `src/app/bank/page.tsx` (where it was previously inlined) so both `/create` and `/bank` can use it. The `onImported` callback now receives `{count, ids, warnings}` enabling deep-link flows.
- `src/app/bank/page.tsx`: 
  - Removed the inlined `ImportCard` (now imported from `@/components/ImportCard`).
  - Added **Explain (N)** and **Re-tag (N)** toolbar buttons with LLM provider gating, spinners, and toast summaries.
  - Added `?ids=&action=` deep-link handling: on mount, preselects the listed ids (filtered to ones that exist), then strips the query string via `router.replace("/bank")` so refresh doesn't re-trigger.
- `src/app/settings/page.tsx`: `PromptEditorCard` generalized — now iterates over `Object.values(PROMPTS)` via a Select dropdown. Legacy `carmenita.mcq` alias hidden from the dropdown. Per-prompt override status shown as "(modified)" in the picker labels.
- `src/app/page.tsx`: dashboard first card renamed "Upload & Generate" → "Create questions", icon changed to Sparkles, links to `/create`.
- `src/components/HeaderNav.tsx`: "Upload" link → "Create" pointing to `/create`.
- **Tests**: 200 → **284 passing** (14 files total). New files:
  - `src/lib/__tests__/tag-fallback.test.ts` (12 tests) — dedup, normalize, hyphenation, caps, immutability
  - `src/lib/__tests__/prompts.test.ts` (30+ tests) — registry completeness, TAGGING block presence, per-prompt invariants, renderPrompt substitution
  - `src/lib/__tests__/doc-extract-pptx.test.ts` (8+ tests) — synthetic PPTX built in-memory via JSZip, numeric slide sort, entity decoding, error paths, `isLectureFilename`
  - `src/lib/__tests__/llm-topic.test.ts` (14 tests) — structured field embedding, defaults, override, no-placeholder leakage
  - `src/lib/__tests__/llm-enhance.test.ts` (15 tests) — explanation + tagging builders, number|number[] correctAnswer description, `(none)` fallback

### 2026-04-08 — Local model picker for LM Studio / Ollama / Custom

- `src/app/api/local-models/route.ts`: NEW — probes `{baseUrl}/models` on local/custom LLM servers, returns the real list of available model ids. Handles OpenAI-compatible response shape AND Ollama's native `/api/tags` shape. 5-second timeout, graceful error handling.
- `src/app/settings/page.tsx`: Load models button added for Ollama/LM Studio/Custom provider rows. Swaps the model text input for a real `<select>` dropdown when probe succeeds. Preserves any existing custom model id as a "(custom)" option. Helpful placeholder text when no models loaded yet.
- `src/lib/store.ts`: cleared the `"local-model"` bogus default for LM Studio (LM Studio rejects any placeholder). Seed is now empty string so the user picks or loads.
- Fixes the bug: `Invalid model identifier "local-model". Please specify a valid downloaded model …`
- Tests: all 200 still passing (no new tests — the route is covered by a live probe that found 5 real models on the user's local LM Studio instance).

### 2026-04-08 — Manual create + bulk delete

- `src/lib/validation.ts`: added `CreateQuestionSchema` with type-specific `.refine()` rules mirroring question-schema.ts; added `BulkDeleteSchema`.
- `src/app/api/bank/questions/route.ts`: added `POST` handler for manual question creation with source_type="manual", normalized lowercase taxonomy, deduped tags.
- `src/app/api/bank/questions/bulk-delete/route.ts`: NEW — `POST` with `{ids: string[]}`, deletes many rows in one transaction. Cascade removes junction + answer rows.
- `src/components/CreateQuestionDialog.tsx`: NEW — full manual question form. Type selector, dynamic 2-8 options editor with type-aware correct-answer picker (radio for single/TF, checkbox for multi), autocomplete datalists on subject/lesson/topic/tag, live inline error list, save disabled until structurally valid. Pre-fills subject/lesson from current filter context.
- `src/app/bank/page.tsx`: added **+ New question** button (always enabled) and **Delete (N)** destructive button to toolbar. Wired CreateQuestionDialog and reload on success.
- Live probe: 3 manual questions (one of each type) created cleanly; invalid type-specific constraints rejected with 400; bulk delete cascades work.

### 2026-04-08 — Taxonomy: subject / lesson / topic / tags

- `src/db/schema.ts`: added `subject` (nullable, indexed), `lesson` (nullable, indexed), `tags` (JSON `string[]`, default `[]`) columns. Plus 2 new indices.
- `src/db/migrations/0002_add_taxonomy.sql`: NEW migration.
- `src/lib/formats/types.ts`: `PortableQuestion` extended with `subject`, `lesson`, `tags`. `DEFAULT_METADATA` updated.
- `src/lib/formats/markdown.ts`: parser recognizes `**Subject:**`, `**Lesson:**`, `**Tags:**` with synonyms (chapter/unit → lesson, tag → tags). Serializer emits all 4 taxonomy lines when non-null. `parseTagList()` splits comma/semicolon-separated tag strings. Bold-markdown field regex FIXED to capture opening `**` as backreference and match it after the colon (old regex left `** ` in the value).
- `src/lib/formats/gift.ts`: `deriveTaxonomy()` splits `$CATEGORY:` slash-paths into subject/lesson/topic. Serializer emits `$CATEGORY: subject/lesson/topic` per question (with a blank line after — critical, else the parser treats it as part of the next question block) and `// tags: ...` comment lines.
- `src/lib/formats/aiken.ts`: updated to populate new taxonomy fields with defaults (lossy as before).
- `src/lib/question-schema.ts`: Zod schema accepts optional `subject`, `lesson`, `tags` fields. `parseQuestionArray` normalizes missing values to null/[].
- `src/lib/formats/chatbot-prompts.ts`: MARKDOWN_PROMPT and GIFT_PROMPT updated with `Subject` and `Lesson` fields in the spec AND in all 3 worked examples. Aiken prompt explicitly lists them as dropped metadata. `buildChatbotPrompt()` accepts `{subject, lesson}` placeholders.
- `src/app/api/bank/taxonomy/route.ts`: NEW — returns distinct subjects/lessons/topics/tags via `SELECT DISTINCT` + `json_each()` for tag expansion.
- `src/app/api/bank/questions/route.ts`: GET filter params added: `subject`, `lesson`, `tag` (tag via LIKE on JSON text).
- `src/app/api/bank/questions/bulk-tag/route.ts`: NEW — PATCH route for bulk-assigning subject/lesson/topic/tags to many questions. Handles add-tags and remove-tags in one transaction.
- `src/app/api/bank/import/route.ts`: pipes new taxonomy fields from parser output into DB inserts. **THE CRITICAL BUG FIX**: was dropping subject/lesson/tags silently before.
- `src/app/api/bank/export/route.ts`: filter params extended; markdown export added as a third format.
- `src/lib/validation.ts`: `BulkTagSchema`, `BankImportSchema` updated (accepts "markdown" format).
- `src/components/BulkTagDialog.tsx`: NEW — bulk subject/lesson/topic/tag assignment dialog with autocomplete datalists.
- `src/components/ChatbotPromptPanel.tsx`: Subject + Lesson inputs added to the prompt-builder form (4 fields total now: N, subject, lesson, topic).
- `src/app/bank/page.tsx`: 7 filters (Subject, Lesson, Topic contains, Tag, Difficulty, Bloom, Source) with dropdowns populated from taxonomy. Question rows show colored badges (blue subject, purple lesson, grey topic, outline `#tag` chips). **+ Tag (N)** button added to toolbar. Variation inheritance uses parent taxonomy.
- `src/app/api/generate-quiz/route.ts`: accepts optional `defaultSubject`, `defaultLesson`, `defaultTags` body params for whole-batch taxonomy overlay.
- `src/app/api/bank/variations/route.ts`: variations inherit parent's subject/lesson/tags when the LLM doesn't include them (`v.subject ?? original.subject`).
- `src/lib/llm-variations.ts`: variation prompts now include original's taxonomy in the context and instruct the LLM to preserve it.
- Tests: test fixtures updated with new fields. All 200 still passing. No test count change because the new taxonomy is covered by existing format round-trip tests (which now verify subject/lesson/tags round-trip too).

### 2026-04-08 — Variation generation

- `src/db/schema.ts`: added `parent_question_id` (nullable self-ref FK with ON DELETE SET NULL), `variation_type` (enum: topic/distractors/paraphrase/harder/easier), new index `idx_questions_parent`. Added "variation" to the source_type enum. Added self-referential relation with `relationName: "variation_lineage"`.
- `src/db/migrations/0001_add_variation_lineage.sql`: NEW migration.
- `src/lib/llm-variations.ts`: NEW — 5 hand-crafted variation prompt templates (topic/distractors/paraphrase/harder/easier), `formatOriginalQuestion()` helper, `buildVariationPrompt()` + `generateVariations()` runtime with withRetry + Zod parsing. `VARIATION_TYPE_LABELS` export for UI.
- `src/lib/validation.ts`: `GenerateVariationsSchema` added.
- `src/app/api/bank/variations/route.ts`: NEW — POST route with full error handling. Inserts new questions with `source_type="variation"`, `parent_question_id=original.id`, `variation_type`, and inherited taxonomy.
- `src/components/VariationDialog.tsx`: NEW — type select (with inline descriptions), count input (1-20), generate button. Warns when no provider active.
- `src/app/bank/page.tsx`: sparkle icon on every question row opens VariationDialog. `variationChildCount` Map builds "N variations" badges on parent rows. `byId` lookup renders "variation of: ..." hint on child rows.
- `src/lib/__tests__/llm-variations.test.ts`: NEW — 53 tests across the 5 variation types (9+ assertions each) verifying prompt content, original embedding, required output rules, and type-specific instructions.
- Total tests: 146 → 199.

### 2026-04-08 — Markdown format + chatbot prompts

- `src/lib/formats/types.ts`: NEW — shared `PortableQuestion` type + `DEFAULT_METADATA` constants used by all format parsers.
- `src/lib/formats/markdown.ts`: NEW — canonical format parser + serializer. `## Q{n}` headers, `**Field:** value` metadata, `- [x]` / `- [ ]` GitHub checkbox options, tolerant of variations (different header levels, `*`/`1.` list markers, case-insensitive `[X]`, field synonyms). Auto-detects type from option shape. `parseMarkdown()` returns `{questions, warnings}`. `serializeMarkdown()` produces canonical output.
- `src/lib/formats/chatbot-prompts.ts`: NEW — three LLM prompt templates (`MARKDOWN_PROMPT`, `GIFT_PROMPT`, `AIKEN_PROMPT`) with strict rules, 3-question worked examples per format, `{N}`/`{TOPIC}`/`{SUBJECT}`/`{LESSON}`/`{SOURCE}` placeholders. Helper functions: `buildChatbotPrompt()`, `CHATBOT_PROMPTS`, `FORMAT_DESCRIPTIONS`.
- `src/components/ChatbotPromptPanel.tsx`: NEW — panel with inputs for N/topic/source, 3 copy-to-clipboard buttons (Markdown/GIFT/Aiken), "how it works" instructions. Uses `navigator.clipboard.writeText`. Added to `/bank` page above the Import card.
- `src/lib/validation.ts`: `BankImportSchema.format` enum extended with `"markdown"`.
- `src/db/schema.ts`: `source_type` enum extended with `"markdown-import"`.
- `src/app/api/bank/import/route.ts`: dispatch to `parseMarkdown()` when format is "markdown". Source_type computed to `"markdown-import"`.
- `src/app/api/bank/export/route.ts`: markdown added as third format. File extension `.md`.
- `src/lib/__tests__/markdown.test.ts`: NEW — 46 tests covering canonical format, variations, edge cases, round-trip.
- `src/lib/__tests__/chatbot-prompts.test.ts`: NEW — 29 tests including **self-consistency checks** where each prompt's worked example is extracted and re-parsed through its target format's parser. If the parser fails, the test fails — prevents "I edited the prompt and the example stopped working" bugs.
- `src/app/bank/page.tsx`: ImportCard default format set to "markdown" (recommended); format dropdown adds Markdown option; ChatbotPromptPanel inserted above Import card.
- Total tests: 71 → 146.

### 2026-04-08 — Question bank refactor (many-to-many)

- `src/db/schema.ts`: massive refactor. Removed `questions.quiz_id` and `questions.idx`. Added `source_type` enum, `source_document_id` (nullable FK), `source_label`, `created_at`, `user_id`. Made `quizzes.document_id` nullable with `ON DELETE SET NULL` so quizzes can be assembled from the bank alone. NEW table `quiz_questions` with composite PK `(quiz_id, question_id)` and `idx` column for order. New relations + inferred types.
- Migration regenerated from scratch because Drizzle flags the column removals as destructive. The carmenita.db was wiped and rebuilt cleanly.
- `src/app/api/quizzes/route.ts`: `questionCount` subquery now counts `quiz_questions` rows. Document filename joined via LEFT JOIN.
- `src/app/api/quizzes/[id]/route.ts`: questions now fetched through `quizQuestions` inner join with `orderBy(quizQuestions.idx)`.
- `src/app/api/attempts/[id]/route.ts`: same join change. Server-side scoring uses the junction for total count.
- `src/app/api/generate-quiz/route.ts`: inserts quiz + questions + quiz_questions junction rows in one transaction. Questions get `source_type="document"`, `source_document_id`.
- `src/app/api/bank/questions/route.ts`: NEW — GET with filters (topic/difficulty/bloomLevel/sourceType/ids/limit).
- `src/app/api/bank/questions/[id]/route.ts`: NEW — DELETE endpoint for individual bank questions.
- `src/app/api/bank/import/route.ts`: NEW — POST accepting {format, text, sourceLabel}. Dispatches to GIFT/Aiken parser, inserts with appropriate source_type.
- `src/app/api/bank/export/route.ts`: NEW — GET with filters + format param. Returns text/plain with Content-Disposition download headers. X-Carmenita-Skipped and X-Carmenita-Exported-Count headers.
- `src/app/api/bank/quiz/route.ts`: NEW — POST to assemble a quiz from selected bank questions. No LLM call, no document — provider/model are hardcoded to "bank".
- `src/lib/validation.ts`: NEW schemas for import, bulk operations.
- `src/app/bank/page.tsx`: NEW — full bank UI with filter card, selection checkboxes, preview, delete, build-quiz, import, export. ImportCard sub-component.
- `src/lib/__tests__/analytics.test.ts`: test fixtures updated to seed questions into the new bank + junction shape. All 38 existing tests still pass.

### 2026-04-08 — GIFT + Aiken format support

- `src/lib/formats/types.ts`: NEW shared types (PortableQuestion, DEFAULT_METADATA).
- `src/lib/formats/gift.ts`: NEW — full Moodle GIFT parser and serializer. Handles mcq-single, mcq-multi (weighted `~%50%`), true-false (`{T}`/`{F}` shorthand), per-answer feedback (`#`), question-level feedback (`####`), `$CATEGORY:`, `::Title::`, comments, GIFT escapes (`\=`, `\~`, `\#`, `\{`, `\}`, `\\`). 19 tests.
- `src/lib/formats/aiken.ts`: NEW — Moodle Aiken parser and serializer. Lossy by design. Rejects mcq-multi on export with a reason in the response. Auto-detects true/false when options are exactly `["True","False"]`. Accepts both `A.` and `A)` option markers. 14 tests.
- Total tests: 38 → 71.

### 2026-04-08 — Carmenita v0 (initial scaffold)

- Brand new Next.js 16 project scaffolded at `/Users/mohammedsaqr/Documents/Github/carmenita/`. ~80 files, ~9000 lines of source.
- Config files: `package.json`, `tsconfig.json` (strict), `next.config.ts` (with `serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "mammoth"]`), `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `components.json`, `.gitignore`, `drizzle.config.ts`.
- **Copied byte-identical from handai**: `src/lib/ai/providers.ts` (10 LLM providers), `src/lib/retry.ts`, `src/hooks/useSessionState.ts`, `src/lib/utils.ts`, 17 shadcn primitives in `src/components/ui/`, `vitest.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`.
- **Ported from handai** (with Node adaptations): `src/lib/doc-extract.ts` (handai's `document-browser.ts` → uses pdfjs-dist legacy build + custom StandardFontDataFactory + disableFontFace for Node).
- `src/db/schema.ts`: initial Drizzle schema with 5 tables (documents, quizzes, questions, attempts, answers), relations, inferred types.
- `src/db/client.ts`: module-level better-sqlite3 singleton via `globalThis` to survive Next.js dev HMR.
- `src/db/migrations/0000_init.sql`: initial schema.
- `src/lib/prompts.ts`: prompt registry with `carmenita.mcq` default + localStorage override layer.
- `src/lib/question-schema.ts`: Zod validator for LLM output with type-specific constraints.
- `src/lib/chunk.ts`: character-based document chunker with boundary preference.
- `src/lib/llm-quiz.ts`: `generateQuizQuestions()` orchestrator with chunking, withRetry, Zod validation, de-dupe.
- `src/lib/analytics.ts`: SQL-backed analytics (overview, topicBreakdown, difficultyBreakdown, bloomBreakdown, improvementCurve with `ROW_NUMBER() OVER`, slowestQuestions).
- `src/lib/store.ts`: Zustand store with `carmenita-storage` localStorage key and zustand persist+merge pattern for forward-compat with new providers.
- `src/lib/validation.ts`: initial Zod schemas for API routes.
- API routes: `/api/documents` (POST/GET), `/api/documents/[id]` (DELETE/GET), `/api/generate-quiz` (POST), `/api/quizzes` (GET), `/api/quizzes/[id]` (GET/DELETE), `/api/attempts` (POST), `/api/attempts/[id]` (GET/PATCH), `/api/analytics/*` (6 routes).
- Pages: dashboard (`/`), upload, settings, analytics, quiz/[id], quiz/[id]/results/[attemptId], quiz/[id]/analytics.
- Components: AppHeader, HeaderNav, DashboardLists, NoProviderWarning, quiz/QuestionCard, quiz/QuizRunner, analytics/StatsCard, analytics/ImprovementChart, analytics/BreakdownBars + 17 shadcn primitives.
- Hooks: `useQuizRunner` (state machine), `useActiveProvider`, `useSessionState` (copied from handai), `useGenerationJob`.
- Tests: 4 Vitest files — analytics (14), chunk (8), question-schema (12), retry (4). 38 tests total, all passing.
- First successful end-to-end live probe: upload a PDF → extract text → generate 5 questions via OpenAI → insert into bank → take quiz → view analytics.
