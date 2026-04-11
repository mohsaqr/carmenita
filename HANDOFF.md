# Session Handoff — 2026-04-11

## Completed

### Import Wizard
- Restructured `/import` as a 3-step wizard: Format → Generate & Import → What next?
- Chatbot prompt templates (Markdown/GIFT/Aiken) now accessible directly in the wizard with copy button
- Metadata fields (topic, subject, lesson, source, N) collapsed inside the prompt card
- Removed ChatbotPromptPanel and ImportCard from `/bank` page — import lives solely in `/import`
- Files: `src/components/import-wizard/` (7 files), `src/app/import/page.tsx`

### Retake Wrong/Skipped + Needs Review
- Results page: "Retake N missed" button creates a quick quiz from wrong + skipped questions
- Skipped questions show amber badge/border (distinct from red "Wrong")
- Header shows breakdown: "X correct · Y wrong · Z skipped"
- Analytics page: "Needs Review" card shows historically-wrong questions with "Practice these" button
- New endpoint: `GET /api/analytics/needs-review`
- Files: `Results.client.tsx`, `src/lib/analytics.ts`, `src/app/analytics/page.tsx`

### Homepage + Sidebar Redesign
- Homepage: 4 focused cards — Take quiz, Repeat quizzes, Revise, Track progress
- Sidebar: split into Primary (Dashboard, Take quiz, Repeat, Analytics) and Secondary/Manage (Create, Import, Bank, Trash, Settings)
- Import now has its own sidebar entry

### Static Build Fixes
- All 7 analytics endpoints wired into `local-api/interceptor.ts`
- Fixed NaN% avg score with `Number.isFinite()` guard
- Fixed `generateStaticParams` returning empty array when DB has no quizzes — now returns `["_"]` sentinel
- Opted GitHub Actions into Node.js 24 for action runners

### Bank Sort Options
- Bank flat view has sort dropdown: Newest first, Import order, By topic, By difficulty
- Import route offsets `createdAt` by 1ms per question to preserve file order
- `scripts/fix-import-order.mjs` retroactively fixes existing imports

### Server Deployment
- `scripts/server-setup.sh` — one-shot SUSE server setup (systemd + webhook auto-deploy)
- Configured for user `saqr` at `192.168.50.221:3000`
- Requires Node.js 22 (not 24 — `better-sqlite3` prebuilds)

### Dr. Omar Genetics MCQs
- Extracted 196 questions from scanned PDF, verified against official answer key
- DB reset and imported 195 questions (Q46 blacked out in scan) + 1 sample quiz
- `scripts/import-md.mjs` — standalone Markdown→DB import tool
- Source file: `~/Downloads/Dr_Omar_Genetics_MCQs.md`

### CLAUDE.md Updates
- Added static export architecture, middleware, env vars, build scripts sections
- Updated route count to 31, expanded key files

### GitHub Actions Cleanup
- Disabled Actions on 5 private repos (Carm, tnadesktop, aistatia, Saqrlab, tna-js)

## Current State
- Local DB: 195 genetics MCQs + 1 sample quiz, fresh (no attempts)
- GitHub Pages: building from `f137613`
- SUSE server: needs `git pull` + rebuild for latest
- Tests: 284 passing, 0 TS errors, 0 lint errors

## Open Issues
- Q46 from Dr. Omar's booklet missing (page blacked out)
- Breadcrumbs not yet implemented (started but interrupted)
- `MetadataForm.tsx` exists but unused as standalone step — could delete or keep

## Next Steps
1. Complete breadcrumb navigation across all pages
2. Deploy latest to SUSE server
3. Find Q46 or remove placeholder
4. Add more question sets from other chapters
