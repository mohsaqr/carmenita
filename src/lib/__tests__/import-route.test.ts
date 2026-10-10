import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

/**
 * POST /api/bank/import end to end through the real route handler and a
 * migrated SQLite DB: GIFT with all-correct questions imports in full,
 * and GIFT pasted with the wrong format selected still imports (as GIFT)
 * instead of failing with "No valid questions found".
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "carmenita-import-"));
const sqlite = new Database(path.join(TMP, "test.db"));
sqlite.pragma("foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
globalThis.__carmenitaDb = testDb;
globalThis.__carmenitaSqlite = sqlite;
migrate(testDb, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });

const auth = await import("@/lib/auth");
const importRoute = await import("@/app/api/bank/import/route");

afterAll(() => {
  sqlite.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const user = auth.upsertUser("Importer", "import-pass-1");
const token = auth.createSession(user.id).token;

async function postImport(body: unknown) {
  const res = await importRoute.POST(
    new NextRequest("http://localhost/api/bank/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${auth.SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

function sourceTypes(ids: string[]): string[] {
  const placeholders = ids.map(() => "?").join(",");
  const rows = sqlite
    .prepare(`SELECT DISTINCT source_type AS t FROM questions WHERE id IN (${placeholders})`)
    .all(...ids) as { t: string }[];
  return rows.map((r) => r.t);
}

const GIFT = `// Lecture 6 - Restrictive Lung Diseases

::L6-S02-Q01:: Restrictive lung disease is characterized by: {
=Reduced expansion of the lung parenchyma
~Increased resistance to outflow
=Decreased FVC
}

::L6-S03-Q01:: Restrictive lung diseases can be caused by affections of: {
=Respiratory centers
=Respiratory tracts
=Thoracic cage
=Pleural diseases
=Lung diseases
}`;

describe("POST /api/bank/import", () => {
  it("imports GIFT with an all-correct question and warns about it", async () => {
    const { status, body } = await postImport({ format: "gift", text: GIFT, setName: "L6 gift" });
    expect(status).toBe(200);
    expect(body.imported).toBe(2);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("1 question has every option marked correct");
    expect(sourceTypes(body.ids)).toEqual(["gift-import"]);
  });

  it("imports GIFT pasted with Markdown selected, as GIFT, and says so", async () => {
    const { status, body } = await postImport({ format: "markdown", text: GIFT, setName: "L6 md" });
    expect(status).toBe(200);
    expect(body.imported).toBe(2);
    expect(body.warnings[0]).toBe("This text is in GIFT format, not Markdown — imported it as GIFT.");
    expect(sourceTypes(body.ids)).toEqual(["gift-import"]);
  });

  it("imports GIFT pasted with Aiken selected", async () => {
    const { status, body } = await postImport({ format: "aiken", text: GIFT, setName: "L6 aiken" });
    expect(status).toBe(200);
    expect(body.imported).toBe(2);
  });

  it("still fails with 400 when no format finds any question", async () => {
    const { status, body } = await postImport({
      format: "gift",
      text: "Just notes, no questions.",
      setName: "Nothing",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/No valid questions/);
  });
});
