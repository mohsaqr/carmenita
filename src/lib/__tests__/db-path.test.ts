import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

// Importing @/db/client opens a DB as a side effect; pre-install an
// in-memory singleton so the test never touches ./carmenita.db.
const sqlite = new Database(":memory:");
globalThis.__carmenitaDb = drizzle(sqlite, { schema });
globalThis.__carmenitaSqlite = sqlite;
const { resolveDbPath } = await import("@/db/client");

describe("resolveDbPath", () => {
  it("defaults to ./carmenita.db in the working directory", () => {
    expect(resolveDbPath({}, "/srv/app")).toBe("/srv/app/carmenita.db");
  });

  it("uses CARMENITA_DB when set (absolute path wins over cwd)", () => {
    expect(resolveDbPath({ CARMENITA_DB: "/opt/data/carmenita/carmenita.db" }, "/srv/app/.next/standalone")).toBe(
      "/opt/data/carmenita/carmenita.db",
    );
  });

  it("resolves a relative CARMENITA_DB against cwd and ignores an empty value", () => {
    expect(resolveDbPath({ CARMENITA_DB: "data/x.db" }, "/srv/app")).toBe("/srv/app/data/x.db");
    expect(resolveDbPath({ CARMENITA_DB: "" }, "/srv/app")).toBe("/srv/app/carmenita.db");
  });
});
