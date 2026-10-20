import { expect, it } from "vitest";
// Static imports, exactly like topic-batches.test.ts: these run before any
// test can point globalThis.__carmenitaDb at a test database.
import "@/lib/ai/llm";
import "@/lib/request-log";
import "@/lib/llm-topic";
import "@/lib/llm-quiz";

/**
 * Importing the LLM layer must not open the database. When request-log.ts
 * imported auth.ts at load, these imports opened ./carmenita.db, and route
 * tests wrote their users and quizzes into the developer's real local DB
 * (2026-10-20).
 */
it("importing the LLM and logging modules opens no database", () => {
  expect(globalThis.__carmenitaDb).toBeUndefined();
  expect(globalThis.__carmenitaSqlite).toBeUndefined();
});
