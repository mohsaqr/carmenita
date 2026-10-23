import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { PortableQuestion } from "@/lib/formats/types";

// scripts/medical-bank/build.mjs: ownerless bank DB from fetch.py output.

const TMP = mkdtempSync(path.join(tmpdir(), "carmenita-medbank-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function q(text: string, correct: number, extra: Partial<PortableQuestion> = {}): PortableQuestion {
  return {
    type: "mcq-single",
    question: text,
    options: ["A one", "B two", "C three", "D four"],
    correctAnswer: correct,
    explanation: "",
    difficulty: "medium",
    bloomLevel: "understand",
    subject: "anatomy",
    lesson: null,
    topic: "anatomy",
    tags: ["mmlu", "anatomy"],
    sourcePassage: "",
    ...extra,
  };
}

const SETS = [
  {
    name: "MMLU Anatomy",
    folder: "Medical LLM Leaderboard",
    source: "openlifescienceai/mmlu_anatomy (test)",
    questions: [q("First?", 0), q("Labs:\nHb 14 g/dL\nWBC 16,400", 2), q("Third?", 3)],
  },
  {
    name: "MedMCQA Pathology",
    folder: "MedMCQA (train)",
    source: "openlifescienceai/medmcqa (train)",
    questions: [
      q("Fibroblasts make?", 2, {
        subject: "pathology",
        lesson: "inflammation",
        topic: "inflammation",
        tags: ["medmcqa", "pathology"],
        explanation: "Collagen is made by fibroblasts.",
      }),
    ],
  },
];

function build(name: string) {
  const input = path.join(TMP, `${name}.json`);
  const out = path.join(TMP, `${name}.db`);
  writeFileSync(input, JSON.stringify({ sets: SETS }));
  execFileSync(process.execPath, ["scripts/medical-bank/build.mjs", input, out], { stdio: "pipe" });
  return { input, out };
}

describe("medical bank builder", () => {
  let out: string;
  beforeAll(() => {
    out = build("bank").out;
  });

  it("creates one set per entry with exactly its questions, no accounts", () => {
    const db = new Database(out, { readonly: true });
    const sets = db
      .prepare(
        `SELECT s.name, s.folder, s.user_id, COUNT(q.id) AS n FROM question_sets s
         JOIN questions q ON q.set_id = s.id GROUP BY s.id ORDER BY s.name`,
      )
      .all();
    const users = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    const owned = db.prepare("SELECT COUNT(*) AS n FROM questions WHERE user_id IS NOT NULL").get() as { n: number };
    db.close();
    expect(sets).toEqual([
      { name: "MMLU Anatomy", folder: "Medical LLM Leaderboard", user_id: null, n: 3 },
      { name: "MedMCQA Pathology", folder: "MedMCQA (train)", user_id: null, n: 1 },
    ]);
    expect(users.n).toBe(0);
    expect(owned.n).toBe(0);
  });

  it("stores rows the app's schema reads back losslessly, in dataset order", () => {
    const sqlite = new Database(out, { readonly: true });
    const db = drizzle(sqlite, { schema });
    const set = db.select().from(schema.questionSets).where(eq(schema.questionSets.name, "MMLU Anatomy")).get();
    const rows = db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.setId, set!.id))
      .orderBy(desc(schema.questions.createdAt), asc(schema.questions.id))
      .all();
    sqlite.close();
    const back = rows.map((r) => ({
      type: r.type,
      question: r.question,
      options: r.options,
      correctAnswer: r.correctAnswer,
      explanation: r.explanation,
      difficulty: r.difficulty,
      bloomLevel: r.bloomLevel,
      subject: r.subject,
      lesson: r.lesson,
      topic: r.topic,
      tags: r.tags,
      sourcePassage: r.sourcePassage,
    }));
    expect(back).toEqual(SETS[0].questions);
    expect(rows.map((r) => r.sourceLabel)).toEqual(Array(3).fill("openlifescienceai/mmlu_anatomy (test)"));
  });

  it("gives everything to the first account created on it", () => {
    const stdout = execFileSync(process.execPath, ["scripts/create-user.mjs", "medic", "s3cret-pass"], {
      env: { ...process.env, CARMENITA_DB: out },
      stdio: "pipe",
    }).toString();
    expect(stdout).toContain("took ownership of 6 existing rows");
    const db = new Database(out, { readonly: true });
    const unowned = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM questions WHERE user_id IS NULL) + (SELECT COUNT(*) FROM question_sets WHERE user_id IS NULL) AS n",
      )
      .get() as { n: number };
    db.close();
    expect(unowned.n).toBe(0);
  });

  it("builds the same bank from a split directory (one set in memory at a time)", () => {
    const { input } = build("from-file");
    const dir = path.join(TMP, "split");
    execFileSync(process.execPath, ["scripts/medical-bank/split.mjs", input, dir], { stdio: "pipe" });
    const fromDir = path.join(TMP, "from-dir.db");
    execFileSync(process.execPath, ["scripts/medical-bank/build.mjs", dir, fromDir], { stdio: "pipe" });
    const rows = (file: string) => {
      const db = new Database(file, { readonly: true });
      const out = db
        .prepare(
          `SELECT s.name, s.folder, s.question_count, q.question, q.options, q.correct_answer, q.explanation, q.subject, q.lesson, q.topic, q.tags
           FROM questions q JOIN question_sets s ON s.id = q.set_id ORDER BY s.name, q.created_at DESC`,
        )
        .all();
      db.close();
      return out;
    };
    expect(rows(fromDir)).toEqual(rows(path.join(TMP, "from-file.db")));
    expect(rows(fromDir)).toHaveLength(4);
  });

  it("rolls back when a split file does not match its index", () => {
    const dir = path.join(TMP, "split");
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    index.sets[1].count += 1;
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
    const out = path.join(TMP, "tampered.db");
    expect(() => execFileSync(process.execPath, ["scripts/medical-bank/build.mjs", dir, out], { stdio: "pipe" })).toThrow(
      /index says 2 questions, file has 1/,
    );
    const db = new Database(out, { readonly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("refuses to overwrite an existing database", () => {
    const { input, out: existing } = build("twice");
    expect(() =>
      execFileSync(process.execPath, ["scripts/medical-bank/build.mjs", input, existing], { stdio: "pipe" }),
    ).toThrow(/already exists/);
  });
});
