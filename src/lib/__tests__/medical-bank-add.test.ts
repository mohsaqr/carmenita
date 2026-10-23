import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { serializeMarkdown } from "@/lib/formats/markdown";
import { groupSetsByFolder } from "@/lib/set-groups";
import type { PortableQuestion } from "@/lib/formats/types";

/**
 * scripts/medical-bank/add.mjs: the benchmark bank goes into ONE
 * account, archived, and must not change anything that account sees in
 * its bank (list, filters, quick quizzes) until a set is restored.
 */

const ROOT = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-medadd-"));
const DB_FILE = path.join(TMP, "app.db");
const sqlite = new Database(DB_FILE);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(ROOT, "src/db/migrations") });

const auth = await import("@/lib/auth");
const importRoute = await import("@/app/api/bank/import/route");
const questionsRoute = await import("@/app/api/bank/questions/route");
const taxonomyRoute = await import("@/app/api/bank/taxonomy/route");
const setsRoute = await import("@/app/api/bank/sets/route");
const setRoute = await import("@/app/api/bank/sets/[id]/route");
const quickQuizRoute = await import("@/app/api/bank/quick-quiz/route");
const sendRoute = await import("@/app/api/bank/sets/[id]/send/route");
const questionRoute = await import("@/app/api/bank/questions/[id]/route");
const bulkDeleteRoute = await import("@/app/api/bank/questions/bulk-delete/route");
const exportRoute = await import("@/app/api/bank/export/route");
const { parseArgs } = await import("../../../scripts/medical-bank/add.mjs");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const carmen = auth.upsertUser("Carmen", "carmen-pass-1");
const other = auth.upsertUser("Other", "other-pass-12");
const token = auth.createSession(carmen.id).token;
const otherToken = auth.createSession(other.id).token;

function req(url: string, tok: string, body?: unknown, method?: string) {
  return new NextRequest(`http://localhost${url}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", cookie: `${auth.SESSION_COOKIE}=${tok}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function q(text: string, subject: string, tags: string[]): PortableQuestion {
  return {
    type: "mcq-single",
    question: text,
    options: ["one", "two", "three", "four"],
    correctAnswer: 1,
    explanation: "",
    difficulty: "medium",
    bloomLevel: "understand",
    subject,
    lesson: null,
    topic: subject,
    tags,
    sourcePassage: "",
  };
}

const SETS = [
  {
    name: "MMLU Anatomy",
    folder: "MedMCQA",
    source: "openlifescienceai/mmlu_anatomy (test)",
    questions: [q("Anatomy one?", "anatomy", ["mmlu", "anatomy"]), q("Anatomy two?", "anatomy", ["mmlu", "anatomy"])],
  },
  {
    name: "MedMCQA Pharmacology",
    folder: "MedMCQA India",
    source: "openlifescienceai/medmcqa (train)",
    questions: [q("Drug one?", "pharmacology", ["medmcqa", "pharmacology"])],
  },
];
const INPUT = path.join(TMP, "questions.json");
fs.writeFileSync(INPUT, JSON.stringify({ sets: SETS }));

// process.execPath, not "node": the child must load the same better-sqlite3 build.
function runAdd(username: string, backup: string, input = INPUT, script = "scripts/medical-bank/add.mjs") {
  return execFileSync(process.execPath, [script, input, username, "--backup", backup], {
    env: { ...process.env, CARMENITA_DB: DB_FILE },
    stdio: "pipe",
  }).toString();
}

/** Everything Carmen sees of her bank outside the archive. */
async function bankView(tok: string) {
  const list = await (await questionsRoute.GET(req("/api/bank/questions?limit=2000", tok))).json();
  const taxonomy = await (await taxonomyRoute.GET(req("/api/bank/taxonomy", tok))).json();
  const quick = await (await quickQuizRoute.POST(req("/api/bank/quick-quiz", tok, { count: 2000 }))).json();
  return {
    ids: list.questions.map((x: { id: string }) => x.id).sort(),
    taxonomy,
    poolSize: quick.poolSize,
  };
}

describe("adding the medical bank to an account, archived", { timeout: 30_000 }, () => {
  it("leaves the account's live bank exactly as it was", async () => {
    const own = serializeMarkdown([q("Her own question?", "neuroscience", ["gaba", "lecture"])]);
    const res = await importRoute.POST(req("/api/bank/import", token, { format: "markdown", text: own, setName: "Lecture 10" }));
    expect(res.status).toBe(200);

    const before = await bankView(token);
    const otherBefore = await bankView(otherToken);
    const out = runAdd("carmen", path.join(TMP, "backup-1.db"));
    expect(out).toContain("Added 3 questions in 2 archived sets to Carmen");

    expect(await bankView(token)).toEqual(before);
    expect(await bankView(otherToken)).toEqual(otherBefore);
    expect(before.ids).toHaveLength(1);
    expect(before.taxonomy.tags).toEqual(["gaba", "lecture"]);
  });

  it("lists the new sets as archived, in their folders, with all questions", async () => {
    const { sets } = await (await setsRoute.GET(req("/api/bank/sets", token))).json();
    const medical = sets
      .filter((s: { folder: string | null }) => s.folder !== null)
      .map((s: { name: string; folder: string; archived: boolean; questionCount: number }) => ({
        name: s.name,
        folder: s.folder,
        archived: s.archived,
        questionCount: s.questionCount,
      }));
    expect(medical).toEqual([
      { name: "MMLU Anatomy", folder: "MedMCQA", archived: true, questionCount: 2 },
      { name: "MedMCQA Pharmacology", folder: "MedMCQA India", archived: true, questionCount: 1 },
    ]);
    const { sets: otherSets } = await (await setsRoute.GET(req("/api/bank/sets", otherToken))).json();
    expect(otherSets).toEqual([]);
  });

  it("restoring a set brings exactly its questions into the bank", async () => {
    const { sets } = await (await setsRoute.GET(req("/api/bank/sets", token))).json();
    const pharm = sets.find((s: { name: string }) => s.name === "MedMCQA Pharmacology");
    const res = await setRoute.PATCH(req(`/api/bank/sets/${pharm.id}`, token, { archived: false }, "PATCH"), {
      params: Promise.resolve({ id: pharm.id }),
    });
    expect(res.status).toBe(200);
    const view = await bankView(token);
    expect(view.ids).toHaveLength(2);
    expect(view.taxonomy.subjects).toEqual(["neuroscience", "pharmacology"]);
  });

  it("refuses to add the bank twice, and to a missing account", () => {
    expect(() => runAdd("Carmen", path.join(TMP, "backup-2.db"))).toThrow(/already has 2 of these sets/);
    expect(fs.existsSync(path.join(TMP, "backup-2.db"))).toBe(false);
    expect(() => runAdd("nobody", path.join(TMP, "backup-3.db"))).toThrow(/No account "nobody"/);
  });

  it("wrote a full backup of the database as it was before the add", () => {
    const backup = new Database(path.join(TMP, "backup-1.db"), { readonly: true });
    const counts = backup
      .prepare("SELECT (SELECT COUNT(*) FROM questions) AS questions, (SELECT COUNT(*) FROM question_sets) AS sets, (SELECT COUNT(*) FROM users) AS users")
      .get();
    backup.close();
    expect(counts).toEqual({ questions: 1, sets: 1, users: 2 });
  });

  it("rolls the whole insert back when any part fails, leaving nothing behind", () => {
    const totals = () =>
      sqlite.prepare("SELECT (SELECT COUNT(*) FROM questions) AS q, (SELECT COUNT(*) FROM question_sets) AS s").get();
    const before = totals();
    const bad = path.join(TMP, "bad.json");
    const good = { name: "Good set", folder: "Rollback test", source: "test", questions: [q("Fine?", "anatomy", ["a", "b"])] };
    // Second set has a row that violates NOT NULL (type) — after the first set is in.
    const broken = { ...good, name: "Broken set", questions: [{ ...q("Broken?", "anatomy", ["a", "b"]), type: null }] };
    fs.writeFileSync(bad, JSON.stringify({ sets: [good, broken] }));
    expect(() => runAdd("Carmen", path.join(TMP, "backup-bad.db"), bad)).toThrow(/Nothing was added/);
    expect(totals()).toEqual(before);
  });

  it("runs from a path with a space, through a symlink", () => {
    const dir = path.join(TMP, "my scripts");
    fs.mkdirSync(dir);
    fs.symlinkSync(path.join(ROOT, "scripts/medical-bank/add.mjs"), path.join(dir, "add.mjs"));
    const once = path.join(TMP, "once.json");
    const set = { name: "Linked set", folder: "Link test", source: "test", questions: [q("Linked?", "anatomy", ["a", "b"])] };
    fs.writeFileSync(once, JSON.stringify({ sets: [set] }));
    expect(runAdd("Carmen", path.join(TMP, "backup-link.db"), once, path.join(dir, "add.mjs"))).toContain(
      "Added 1 questions in 1 archived sets to Carmen",
    );
  });

  it("parses --backup in either form and position", () => {
    expect(parseArgs(["q.json", "Carmen", "--backup=/b.db"])).toEqual({ input: "q.json", username: "Carmen", backupPath: "/b.db" });
    expect(parseArgs(["--backup", "/b.db", "q.json", "Carmen"])).toEqual({ input: "q.json", username: "Carmen", backupPath: "/b.db" });
    expect(parseArgs(["q.json", "Carmen"]).backupPath).toBeUndefined();
  });
});

/** Questions whose per-question archive flag disagrees with their set. */
function flagMismatches(db: Database.Database = sqlite): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM questions q JOIN question_sets s ON s.id = q.set_id
         WHERE q.set_archived != s.archived`,
      )
      .get() as { n: number }
  ).n;
}

describe("questions.set_archived stays in step with its set", () => {
  const setId = (name: string, tok = token) =>
    setsRoute
      .GET(req("/api/bank/sets", tok))
      .then((r) => r.json())
      .then((d: { sets: { id: string; name: string; archived: boolean }[] }) => d.sets.find((x) => x.name === name)!);
  const patch = (id: string, archived: boolean) =>
    setRoute.PATCH(req(`/api/bank/sets/${id}`, token, { archived }, "PATCH"), { params: Promise.resolve({ id }) });

  it("after add.mjs, archive and restore", async () => {
    expect(flagMismatches()).toBe(0);
    const own = await setId("Lecture 10");
    expect((await patch(own.id, true)).status).toBe(200);
    expect(flagMismatches()).toBe(0);
    expect((await bankView(token)).ids).toHaveLength(1); // only the restored pharmacology question is live
    expect((await patch(own.id, false)).status).toBe(200);
    expect(flagMismatches()).toBe(0);
    expect((await bankView(token)).ids).toHaveLength(2);
  });

  it("importing into an archived set keeps the new questions archived", async () => {
    const before = (await bankView(token)).ids;
    const md = serializeMarkdown([q("Appended anatomy?", "anatomy", ["mmlu", "anatomy"])]);
    const res = await importRoute.POST(
      req("/api/bank/import", token, { format: "markdown", text: md, setName: "MMLU Anatomy", folder: "MedMCQA" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).setCreated).toBe(false);
    expect(flagMismatches()).toBe(0);
    expect((await bankView(token)).ids).toEqual(before);
  });

  it("a copy of an archived set arrives live for the receiver", async () => {
    const anatomy = await setId("MMLU Anatomy");
    expect(anatomy.archived).toBe(true);
    const res = await sendRoute.POST(
      req(`/api/bank/sets/${anatomy.id}/send`, token, { toUsername: "Other" }),
      { params: Promise.resolve({ id: anatomy.id }) },
    );
    expect(res.status).toBe(200);
    expect(flagMismatches()).toBe(0);
    expect((await bankView(otherToken)).ids).toHaveLength(3);
  });

  it("the database keeps the flag itself, whatever writes the rows", () => {
    const anatomy = sqlite.prepare("SELECT id FROM question_sets WHERE name = 'MMLU Anatomy'").get() as { id: string };
    const lecture = sqlite.prepare("SELECT id FROM question_sets WHERE name = 'Lecture 10'").get() as { id: string };
    const insert = sqlite.prepare(
      `INSERT INTO questions (id, type, question, options, correct_answer, explanation, difficulty, bloom_level,
        topic, tags, source_passage, created_at, user_id, set_id, set_archived)
       VALUES (?, 'mcq-single', 'Raw?', '["a","b"]', '0', '', 'medium', 'understand', 't', '[]', '', ?, ?, ?, ?)`,
    );
    const flag = (id: string) => (sqlite.prepare("SELECT set_archived AS f FROM questions WHERE id = ?").get(id) as { f: number }).f;
    const now = new Date().toISOString();
    // Raw insert into an archived set claiming "live" (old code / import-md.mjs).
    insert.run("raw-1", now, carmen.id, anatomy.id, 0);
    expect(flag("raw-1")).toBe(1);
    // No set, claiming archived.
    insert.run("raw-2", now, carmen.id, null, 1);
    expect(flag("raw-2")).toBe(0);
    // Moving to a live set, and a direct wrong write.
    sqlite.prepare("UPDATE questions SET set_id = ? WHERE id = 'raw-1'").run(lecture.id);
    expect(flag("raw-1")).toBe(0);
    sqlite.prepare("UPDATE questions SET set_archived = 1 WHERE id = 'raw-1'").run();
    expect(flag("raw-1")).toBe(0);
    // Archiving the set by raw SQL (old updateSet) carries its questions.
    sqlite.prepare("UPDATE question_sets SET archived = 1 WHERE id = ?").run(lecture.id);
    expect(flag("raw-1")).toBe(1);
    sqlite.prepare("UPDATE question_sets SET archived = 0 WHERE id = ?").run(lecture.id);
    expect(flag("raw-1")).toBe(0);
    expect(flagMismatches()).toBe(0);
    sqlite.prepare("DELETE FROM questions WHERE id IN ('raw-1', 'raw-2')").run();
  });

  it("migration 0012 repairs drift left by code that ran without the triggers", () => {
    const statements = fs
      .readFileSync(path.join(ROOT, "src/db/migrations/0012_archive_robustness.sql"), "utf8")
      .split("--> statement-breakpoint");
    const triggers = statements.filter((st) => st.includes("CREATE TRIGGER"));
    const repairs = statements.filter((st) => /^\s*(--[^\n]*\n\s*)*UPDATE/.test(st));
    expect(triggers).toHaveLength(3);
    expect(repairs).toHaveLength(2);
    ["trg_questions_set_archived_insert", "trg_questions_set_archived_update", "trg_question_sets_archived"].forEach((t) =>
      sqlite.exec(`DROP TRIGGER ${t}`),
    );
    sqlite.exec("UPDATE questions SET set_archived = 1 - set_archived");
    sqlite.exec("UPDATE question_sets SET question_count = question_count + 7");
    expect(flagMismatches()).toBeGreaterThan(0);
    repairs.forEach((st) => sqlite.exec(st));
    triggers.forEach((st) => sqlite.exec(st));
    expect(flagMismatches()).toBe(0);
    const badCounts = sqlite
      .prepare("SELECT COUNT(*) AS n FROM question_sets s WHERE question_count != (SELECT COUNT(*) FROM questions WHERE set_id = s.id)")
      .get() as { n: number };
    expect(badCounts.n).toBe(0);
  });

  it("question_count follows import, delete, bulk delete, copy and set deletion", async () => {
    const counts = () => {
      const stored = sqlite.prepare("SELECT id, question_count AS n FROM question_sets ORDER BY id").all();
      const actual = sqlite
        .prepare("SELECT s.id, COUNT(q.id) AS n FROM question_sets s LEFT JOIN questions q ON q.set_id = s.id GROUP BY s.id ORDER BY s.id")
        .all();
      return { stored, actual };
    };
    const check = () => {
      const { stored, actual } = counts();
      expect(stored).toEqual(actual);
    };
    check();
    const md = serializeMarkdown([q("Count me?", "anatomy", ["a", "b"]), q("And me?", "anatomy", ["a", "b"])]);
    const imported = await (await importRoute.POST(req("/api/bank/import", token, { format: "markdown", text: md, setName: "Counted" }))).json();
    check();
    const one = await questionRoute.DELETE(req(`/api/bank/questions/${imported.ids[0]}`, token, undefined, "DELETE"), {
      params: Promise.resolve({ id: imported.ids[0] }),
    });
    expect(one.status).toBe(200);
    check();
    const bulk = await bulkDeleteRoute.POST(req("/api/bank/questions/bulk-delete", token, { ids: [imported.ids[1]] }));
    expect(bulk.status).toBe(200);
    check();
    const anatomy = await setId("MMLU Anatomy");
    await setRoute.DELETE(req(`/api/bank/sets/${anatomy.id}`, token, undefined, "DELETE"), { params: Promise.resolve({ id: anatomy.id }) });
    check();
    const { sets } = await (await setsRoute.GET(req("/api/bank/sets", token))).json();
    expect(sets.find((x: { name: string }) => x.name === "Counted").questionCount).toBe(0);
  });

  it("bank listings use the per-user live index", () => {
    const plan = sqlite
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM questions WHERE user_id = ? AND set_archived = 0 ORDER BY created_at DESC")
      .all(carmen.id) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toContain("idx_questions_user_live");
  });
});

describe("query plans at scale", () => {
  const plan = (sqlText: string, ...args: unknown[]) =>
    (sqlite.prepare(`EXPLAIN QUERY PLAN ${sqlText}`).all(...args) as { detail: string }[]).map((p) => p.detail).join(" | ");

  it("one set is read through the set index, not the whole bank", () => {
    expect(plan("SELECT id FROM questions WHERE +user_id = ? AND set_id = ? ORDER BY created_at DESC, id", carmen.id, "x")).toContain(
      "idx_questions_set_id",
    );
  });

  it("deleting a question looks up its quiz links and answers by index", () => {
    expect(plan("SELECT 1 FROM quiz_questions WHERE question_id = ?", "x")).toContain("idx_quiz_questions_question");
    expect(plan("SELECT 1 FROM answers WHERE question_id = ?", "x")).toContain("idx_answers_question");
  });
});

describe("large sets", { timeout: 60_000 }, () => {
  const many = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => q(`${prefix} question ${i}?`, "bulk", ["bulk", "test"]));

  it("imports 3,000 questions in one request (over SQLite's bound-variable limit for one statement)", async () => {
    const res = await importRoute.POST(
      req("/api/bank/import", token, { format: "markdown", text: serializeMarkdown(many(3000, "Imported")), setName: "Big import" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(3000);
  });

  it("sends a copy of a 3,000-question set", async () => {
    const { sets } = await (await setsRoute.GET(req("/api/bank/sets", token))).json();
    const big = sets.find((x: { name: string }) => x.name === "Big import");
    expect(big.questionCount).toBe(3000);
    const res = await sendRoute.POST(req(`/api/bank/sets/${big.id}/send`, token, { toUsername: "Other" }), {
      params: Promise.resolve({ id: big.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).questionsCopied).toBe(3000);
    expect(flagMismatches()).toBe(0);
  });
});

describe("export follows the bank's archive rules", () => {
  const exportText = async (query: string) => {
    const res = await exportRoute.GET(req(`/api/bank/export?format=markdown${query}`, token));
    return { status: res.status, text: await res.text() };
  };

  it("leaves archived sets out of a whole-bank export", async () => {
    const { text } = await exportText("");
    expect(text).toContain("Her own question?");
    expect(text).not.toContain("Anatomy one?");
    expect(text).not.toContain("Linked?");
  });

  it("exports an archived set when it is asked for by set, and a folder by folder", async () => {
    const { sets } = await (await setsRoute.GET(req("/api/bank/sets", token))).json();
    const linked = sets.find((x: { name: string }) => x.name === "Linked set");
    expect(linked.archived).toBe(true);
    const bySet = await exportText(`&setId=${linked.id}`);
    expect(bySet.text).toContain("Linked?");
    expect(bySet.text).not.toContain("Her own question?");
    const byFolder = await exportText(`&folder=${encodeURIComponent("Link test")}&includeArchived=1`);
    expect(byFolder.text).toContain("Linked?");
  });
});

describe("groupSetsByFolder", () => {
  it("groups in first-seen folder order and totals the questions", () => {
    const sets = [
      { id: "a", folder: "MedMCQA", questionCount: 2 },
      { id: "b", folder: null, questionCount: 5 },
      { id: "c", folder: "MedMCQA", questionCount: 3 },
      { id: "d", folder: "MedMCQA India", questionCount: 7 },
    ];
    expect(groupSetsByFolder(sets)).toEqual([
      { folder: "MedMCQA", sets: [sets[0], sets[2]], questionCount: 5 },
      { folder: null, sets: [sets[1]], questionCount: 5 },
      { folder: "MedMCQA India", sets: [sets[3]], questionCount: 7 },
    ]);
  });

  it("keeps every set exactly once", () => {
    const sets = Array.from({ length: 50 }, (_, i) => ({ id: String(i), folder: i % 3 ? `f${i % 4}` : null, questionCount: i }));
    const flat = groupSetsByFolder(sets).flatMap((g) => g.sets);
    expect(flat.map((s) => s.id).sort()).toEqual(sets.map((s) => s.id).sort());
    expect(groupSetsByFolder([])).toEqual([]);
  });
});
