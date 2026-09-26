/**
 * Reads the shipped seed DB (`seed/carmenita.seed.db`, or
 * `$CARMENITA_SEED_DB` as exported by build-static.sh) at BUILD time to enumerate all
 * non-soft-deleted quiz IDs. Used by `generateStaticParams()` in
 * dynamic quiz pages under `output: "export"` so Next can emit one
 * static HTML file per real quiz.
 *
 * This runs only during `next build`, not in the browser — so it can
 * safely use better-sqlite3 (the same Node-native driver the server
 * API routes use). In non-static mode this function is never called,
 * so the `better-sqlite3` import remains server-only.
 */
import path from "node:path";

export async function getStaticQuizIds(): Promise<string[]> {
  // Lazy-load better-sqlite3 so this module can be imported from code
  // paths that never actually need it (tree-shaking safety).
  const Database = (await import("better-sqlite3")).default;
  const dbPath = path.resolve(
    process.cwd(),
    process.env.CARMENITA_SEED_DB ?? path.join("seed", "carmenita.seed.db"),
  );
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare("SELECT id FROM quizzes WHERE deleted_at IS NULL")
      .all() as Array<{ id: string }>;
    db.close();
    const ids = rows.map((r) => r.id);
    // Must return at least one entry or Next.js static export fails
    return ids.length > 0 ? ids : ["_"];
  } catch {
    // No DB yet (first-time checkout, CI without seed, etc.) — return a
    // single sentinel so Next still emits the route shell. User-created
    // quizzes at runtime will still work because we have dynamicParams
    // enabled on the page.
    return ["_"];
  }
}
