# Carmenita

A local-first multiple-choice quiz platform. Upload a PDF/DOCX/PPTX, a typed topic, or an existing GIFT/Aiken/Markdown MCQ file and Carmenita turns it into a bank of quizzes with difficulty levels, Bloom's taxonomy tags, topic labels and verbatim source citations. Take quizzes with faceted filtering, keep per-question study notes, track attempts, soft-delete quizzes to a trash you can restore from, and analyse your performance.

Carmenita runs entirely on your own machine — the SQLite database lives in a single file (`carmenita.db`), and LLM API keys stay in your browser's `localStorage` and never touch Carmenita's server code.

## Features

- **Creation hub (`/create`)** — four ways to build a bank: from a document (PDF/DOCX/PPTX/XLSX/TXT), from a typed topic with learning objectives, from a PPTX lecture (with slide-boundary-aware prompting), or by importing existing MCQ files.
- **Take-quiz page (`/take`)** — faceted filter with clickable chips for lessons, topics, difficulty, Bloom level and question type. Sticky action bar with live pool count, active filter chips, Range/Count/Shuffle/All controls and a Start exam button that always stays in view.
- **Question bank (`/bank`)** — import (GIFT, Aiken, Markdown), export, bulk tag/retag/explain/delete, variation generation, quiz assembly from selected questions.
- **Quiz runner (`/quiz/[id]`)** — Previous / Skip / Next / Finish navigation, immediate feedback with colour-coded explanation + source passage, a Notes textarea on every question that saves on blur (notes persist on the question row, shared across any quiz the question appears in).
- **Attempts browser (`/attempts`)** — chronological list of every attempt, split into "In progress" and "Completed", each clickable to its result page or back to the quiz.
- **Trash (`/trash`)** — quizzes are soft-deleted on delete, preserving all attempts and question links. Restore with one click, or permanently delete (cascades to attempts + answers but never to the bank questions).
- **Analytics (`/analytics`)** — per-topic, per-difficulty, per-Bloom-level breakdowns across all attempts.
- **Three portable formats** — GIFT (Moodle), Aiken (Moodle, lossy), and a GitHub-flavoured Markdown format. All three round-trip-tested.

## Quick start

```bash
git clone https://github.com/mohsaqr/carmenita.git
cd carmenita
npm install
npm run dev             # http://localhost:3000
```

That's it — open `http://localhost:3000/`. The repo ships with a pre-populated `carmenita.db` (~1.5 MB) containing **14 lecture quizzes and 1,492 genetics questions** ready to take. No migration step is needed on first clone — the shipped DB already has the full schema applied.

If you want to start from an empty bank instead:

```bash
rm -f carmenita.db
npm run db:migrate
npm run dev
```

### Adding an LLM provider

LLM-backed features (document → quiz, topic → quiz, add explanations, auto-tag) need a provider. Open `/settings`, pick one of the 10 supported providers, paste your API key, save. Keys are stored in browser `localStorage` under `carmenita-storage` and never leave your browser.

Supported providers: OpenAI, Anthropic, Google, Groq, Together AI, Azure, OpenRouter, Ollama (local), LM Studio (local), and a custom OpenAI-compatible endpoint.

You don't need a provider just to *take* quizzes against an existing bank — only to generate or enhance questions.

### Importing a seed bank

Carmenita ships with an empty bank on first run. To load content:

- **Import an MCQ file** — go to `/create` → Import tab, drop a GIFT/Aiken/Markdown file. The import tab also surfaces a chatbot prompt you can paste into any LLM to generate well-formed questions in the supported formats.
- **Generate from a document** — `/create` → Document or Lecture tab, upload a PDF/DOCX/PPTX, pick how many questions, hit generate.
- **Generate from a topic** — `/create` → Topic tab, type a topic and learning objectives, hit generate.

## Requirements

- **Node.js 20 or 22** (tested on v25)
- **npm** (comes with Node)
- On Windows: Visual Studio Build Tools are needed by `better-sqlite3` (native module). On macOS/Linux `npm install` Just Works.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server at `http://localhost:3000` (Turbopack) |
| `npm run build` | Production build (Next.js standalone output) |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite (~280 tests, node environment) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a new Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to `./carmenita.db` |
| `npm run db:studio` | Drizzle Studio (web UI for inspecting the DB) |

Run the full pre-commit gate with `npm run typecheck && npm test && npm run lint`. All three are expected to be clean.

## Project layout

```
src/
├── app/
│   ├── api/              # Next.js route handlers (CRUD + LLM orchestration)
│   │   ├── quizzes/
│   │   ├── attempts/
│   │   ├── bank/         # questions, import, export, retag, variations, quiz assembly
│   │   ├── trash/        # soft-delete + restore + permanent delete
│   │   ├── generate-quiz/
│   │   ├── generate-from-topic/
│   │   └── analytics/
│   ├── bank/             # bank control panel (import/export/retag/variations/...)
│   ├── create/           # unified creation hub
│   ├── take/             # faceted filter + start exam
│   ├── attempts/         # chronological attempts browser
│   ├── trash/            # soft-delete recovery
│   ├── quiz/[id]/        # quiz runner with nav + notes
│   └── analytics/        # per-topic/difficulty/Bloom stats
├── components/
│   ├── quiz/             # QuestionCard with notes section
│   ├── ui/               # shadcn primitives
│   └── ...
├── db/
│   ├── schema.ts         # Drizzle schema (6 tables)
│   ├── client.ts         # DB singleton (better-sqlite3 + Drizzle)
│   └── migrations/       # drizzle-kit generated migrations
├── lib/
│   ├── ai/providers.ts   # 10 LLM provider registry
│   ├── formats/          # GIFT, Aiken, Markdown parsers + serializers
│   ├── doc-extract.ts    # PDF/DOCX/PPTX/XLSX/TXT text extraction
│   ├── chunk.ts          # Text chunking for long documents
│   ├── llm-quiz.ts       # Document-to-quiz pipeline
│   ├── llm-topic.ts      # Topic-to-quiz pipeline
│   ├── llm-enhance.ts    # Add explanations / auto-tag
│   ├── llm-variations.ts # Generate question variations
│   ├── prompts.ts        # Single source of truth for LLM prompts
│   ├── tag-fallback.ts   # Post-parse tagging safety net
│   └── db-helpers.ts     # Shared quiz-insert transaction helper
├── hooks/
│   ├── useQuizRunner.ts  # State machine for taking a quiz
│   └── ...
└── types/                # TypeScript types (re-exports from schema + LLM shapes)
```

## Data model

Six SQLite tables (see `src/db/schema.ts` for full column definitions):

- **`documents`** — uploaded source material (filename, extracted text, char count)
- **`quizzes`** — one row per quiz (title, settings JSON, provider/model, nullable `document_id`, nullable `deleted_at` for soft delete)
- **`questions`** — the bank. Many-to-many with quizzes via the junction below. Fields: type, question text, options, correct answer, explanation, difficulty, Bloom level, subject/lesson/topic taxonomy, free-form tags JSON, source passage, source type (document/gift-import/aiken-import/markdown-import/manual/variation), source label, optional `parent_question_id` for variation lineage, and a `notes` column for the user's study notes.
- **`quiz_questions`** — junction `(quiz_id, question_id, idx)` — a question can belong to any number of quizzes at any index. Deleting a quiz cascades this table but never touches the bank questions.
- **`attempts`** — one row per retake (`quiz_id`, `started_at`, `completed_at`, `score`)
- **`answers`** — per-question answers in an attempt (`user_answer`, `is_correct`, `time_ms`)

All user-owned rows have a nullable `user_id` column for forward-compatibility with multi-user mode. Currently always `NULL` because there's no auth yet.

## Architecture notes

- **The bank is the source of truth**, not the quizzes. Deleting a quiz never deletes its questions. Importing the same GIFT file twice gives you two copies in the bank — use `/bank` to dedupe or re-tag.
- **Scoring is server-side only.** The quiz runner never decides whether an answer is correct. When an attempt is submitted, the server recomputes correctness from the stored `correctAnswer`, ignoring whatever the client sent.
- **`carmenita.db` is gitignored.** Back it up separately, or export your bank to a GIFT file via `/bank` → Export.
- **Notes live on the question row**, so the same question in multiple quizzes shares its note. Fine for single-user; would need splitting into a per-user `user_notes` table if you add auth.
- **`serverExternalPackages`** in `next.config.ts` lists `better-sqlite3`, `pdfjs-dist`, and `mammoth` — don't remove any of them. `better-sqlite3` is a native module, and `pdfjs-dist` uses a dynamically-imported legacy build with a custom font loader that reads from `node_modules` at runtime.

## LLM provider support

All providers are configured entirely in the browser; your keys are never sent to Carmenita's server code. The registry is `src/lib/ai/providers.ts`:

| Provider | Type |
|---|---|
| OpenAI | Remote |
| Anthropic (Claude) | Remote |
| Google (Gemini) | Remote |
| Groq | Remote |
| Together AI | Remote |
| Azure OpenAI | Remote (configurable endpoint) |
| OpenRouter | Remote |
| Ollama | Local (`http://localhost:11434` by default) |
| LM Studio | Local (OpenAI-compatible endpoint) |
| Custom | Any OpenAI-compatible endpoint |

For local models, Carmenita probes `{baseUrl}/models` to let you pick from actually-installed models rather than typing an ID blindly.

## Password-protecting a deployed instance

Carmenita ships an opt-in HTTP Basic Auth middleware (`src/middleware.ts`) that protects **every page and every `/api/*` route** when two environment variables are set on the host:

```bash
CARMENITA_USER=someone
CARMENITA_PASS=some-long-random-string
```

Set both vars, restart the Node process, and every request triggers the browser's native basic-auth dialog. Correct credentials let the user through; wrong or missing credentials return `401 WWW-Authenticate: Basic`.

Leave the vars unset (the default for local dev) and auth is off — no prompt, no interference.

**Important caveats:**

- **Use HTTPS.** HTTP Basic Auth sends credentials on every request in reversible base64. On plain HTTP anyone on the same network can sniff them. Vercel, Fly.io, Railway, Render and most PaaSes give you HTTPS by default. If you self-host, terminate TLS at a reverse proxy (Caddy, nginx, Traefik).
- **Does not work on GitHub Pages.** Pages is a static file host — no Node runtime, no middleware. For a static deploy, put the whole site behind Cloudflare Access or a similar edge auth layer.
- The credentials live in the host's env vars. Don't commit a `.env` file with them set.
- The LLM-facing `/api/*` routes are protected too, not just pages. A scraper can't hit `/api/bank/questions?limit=2000` without the password.

For a quick local test:

```bash
CARMENITA_USER=test CARMENITA_PASS=secret npm run dev
# open http://localhost:3000/ → browser prompts for credentials
```

## Resetting the database

If you ever want to start over:

```bash
rm -f carmenita.db carmenita.db-wal carmenita.db-shm carmenita.db-journal
npm run db:migrate
```

This wipes the shipped bank of 1,492 questions and 14 lecture quizzes, then recreates the schema from scratch with an empty DB. The shipped `carmenita.db` is committed to the repo, so this only affects your local working copy — `git checkout carmenita.db` brings back the seeded version.

## Tests

```bash
npm test              # runs everything (~280 tests)
npm run test:watch    # interactive watch mode
npx vitest run tests/path.test.ts            # single file
npx vitest run -t "pattern"                  # tests matching name pattern
```

Tests run in the Node.js vitest environment, not jsdom. DB-backed tests spin up a real `better-sqlite3` connection against an in-memory or temp-file DB.

## License

MIT (or whatever the author chooses — this README is generated as a starting point).
