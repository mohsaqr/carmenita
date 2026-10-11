import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { serializeMarkdown } from "@/lib/formats/markdown";

/**
 * Archiving question sets, through the real route handlers.
 *
 * An archived set keeps every question but drops out of the general bank
 * list, the taxonomy filters and quick-quiz filter mode; it is still
 * reachable by setId / ids so it can be opened and restored. Other users
 * can neither see nor change someone else's archive flag.
 */

const ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-archive-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(ROOT, "src/db/migrations") });

const auth = await import("@/lib/auth");
const setsRoute = await import("@/app/api/bank/sets/route");
const setRoute = await import("@/app/api/bank/sets/[id]/route");
const importRoute = await import("@/app/api/bank/import/route");
const questionsRoute = await import("@/app/api/bank/questions/route");
const taxonomyRoute = await import("@/app/api/bank/taxonomy/route");
const quickQuizRoute = await import("@/app/api/bank/quick-quiz/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const alice = auth.upsertUser("Alice", "alice-pass-1");
const bob = auth.upsertUser("Bob", "bob-pass-12");
const aliceToken = auth.createSession(alice.id).token;
const bobToken = auth.createSession(bob.id).token;

function req(url: string, token: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", cookie: `${auth.SESSION_COOKIE}=${token}` },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
async function json(resPromise: Promise<Response> | Response) {
  const res = await resPromise;
  return { status: res.status, body: await res.json() };
}
const mdFor = (prefix: string) =>
  serializeMarkdown(
    ["one", "two", "three"].map((n, i) => ({
      type: "mcq-single" as const,
      question: `${prefix} question ${n}?`,
      options: ["A", "B", "C"],
      correctAnswer: i % 3,
      explanation: "",
      difficulty: "easy" as const,
      bloomLevel: "remember" as const,
      subject: null,
      lesson: null,
      topic: `${prefix}-topic`,
      tags: [`${prefix}-tag`],
      sourcePassage: "",
    })),
  );

async function importSet(name: string, folder: string) {
  const r = await json(
    importRoute.POST(req("/api/bank/import", aliceToken, { method: "POST", body: { format: "markdown", text: mdFor(name), setName: name, folder } })),
  );
  return { setId: r.body.setId as string, ids: r.body.ids as string[] };
}
const setA = await importSet("alpha", "Shelf");
const setB = await importSet("beta", "Shelf");

const setArchived = (id: string, archived: boolean, token = aliceToken) =>
  setRoute.PATCH(req(`/api/bank/sets/${id}`, token, { method: "PATCH", body: { archived } }), params({ id }));
const listIds = async (query = "") =>
  ((await json(questionsRoute.GET(req(`/api/bank/questions${query}`, aliceToken)))).body.questions as Array<{ id: string }>).map((q) => q.id);

describe("archiving a set", () => {
  it("new sets start unarchived and the list reports the flag", async () => {
    const sets = (await json(setsRoute.GET(req("/api/bank/sets", aliceToken)))).body.sets as Array<{ name: string; archived: boolean }>;
    expect(sets.map((s) => [s.name, s.archived])).toEqual([["alpha", false], ["beta", false]]);
    expect(await listIds()).toHaveLength(6);
  });

  it("PATCH archived=true hides the set's questions from the general bank list", async () => {
    const r = await json(setArchived(setA.setId, true));
    expect(r.status).toBe(200);
    expect(r.body.set).toMatchObject({ id: setA.setId, archived: true, questionCount: 3 });
    const ids = await listIds();
    expect(ids.sort()).toEqual([...setB.ids].sort());
  });

  it("an archived set stays reachable by setId, ids and includeArchived", async () => {
    expect((await listIds(`?setId=${setA.setId}`)).sort()).toEqual([...setA.ids].sort());
    expect((await listIds(`?ids=${setA.ids.join(",")}`)).sort()).toEqual([...setA.ids].sort());
    expect(await listIds("?includeArchived=1")).toHaveLength(6);
    // folder listing is part of the general view, so it drops archived sets too
    expect((await listIds("?folder=Shelf")).sort()).toEqual([...setB.ids].sort());
  });

  it("taxonomy filters only offer live material", async () => {
    const tax = (await json(taxonomyRoute.GET(req("/api/bank/taxonomy", aliceToken)))).body;
    expect(tax.topics).toEqual(["beta-topic"]);
    expect(tax.tags).toEqual(["beta-tag"]);
  });

  it("quick-quiz filter mode draws only from live sets", async () => {
    const r = await json(quickQuizRoute.POST(req("/api/bank/quick-quiz", aliceToken, { method: "POST", body: { count: 10 } })));
    expect(r.status).toBe(200);
    expect(r.body.questionCount).toBe(3);
  });

  it("restoring brings everything back and nothing was deleted", async () => {
    const r = await json(setArchived(setA.setId, false));
    expect(r.body.set).toMatchObject({ archived: false, questionCount: 3 });
    expect(await listIds()).toHaveLength(6);
    const tax = (await json(taxonomyRoute.GET(req("/api/bank/taxonomy", aliceToken)))).body;
    expect(tax.topics).toEqual(["alpha-topic", "beta-topic"]);
    const q = await json(quickQuizRoute.POST(req("/api/bank/quick-quiz", aliceToken, { method: "POST", body: { count: 10 } })));
    expect(q.body.questionCount).toBe(6);
  });

  it("archiving is idempotent and independent of rename", async () => {
    await setArchived(setB.setId, true);
    const again = await json(setArchived(setB.setId, true));
    expect(again.body.set.archived).toBe(true);
    const renamed = await json(
      setRoute.PATCH(req(`/api/bank/sets/${setB.setId}`, aliceToken, { method: "PATCH", body: { name: "beta renamed" } }), params({ id: setB.setId })),
    );
    expect(renamed.body.set).toMatchObject({ name: "beta renamed", archived: true });
    await setArchived(setB.setId, false);
  });
});

describe("validation and privacy", () => {
  it("rejects an empty patch and a non-boolean archived flag by class of request", async () => {
    const empty = await setRoute.PATCH(req(`/api/bank/sets/${setA.setId}`, aliceToken, { method: "PATCH", body: {} }), params({ id: setA.setId }));
    expect(empty.status).toBe(400);
    const bad = await setRoute.PATCH(req(`/api/bank/sets/${setA.setId}`, aliceToken, { method: "PATCH", body: { archived: "yes" } }), params({ id: setA.setId }));
    expect(bad.status).toBe(400);
  });

  it("another user cannot archive someone else's set (404) and sees nothing", async () => {
    expect((await setArchived(setA.setId, true, bobToken)).status).toBe(404);
    const sets = (await json(setsRoute.GET(req("/api/bank/sets", aliceToken)))).body.sets as Array<{ id: string; archived: boolean }>;
    expect(sets.find((s) => s.id === setA.setId)?.archived).toBe(false);
    expect((await json(setsRoute.GET(req("/api/bank/sets", bobToken)))).body.sets).toEqual([]);
  });

  it("archived sets never leak into another user's listing", async () => {
    await setArchived(setA.setId, true);
    const bobIds = ((await json(questionsRoute.GET(req("/api/bank/questions?includeArchived=1", bobToken)))).body.questions as unknown[]);
    expect(bobIds).toHaveLength(0);
    await setArchived(setA.setId, false);
  });
});

describe("static build schema", () => {
  it("migration 0010 gives every existing set archived = 0", () => {
    const cols = sqlite.prepare("PRAGMA table_info(question_sets)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
    const col = cols.find((c) => c.name === "archived");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(1);
    expect(String(col?.dflt_value)).toMatch(/^(0|false)$/);
  });
});
