/**
 * Browser-side SQLite via sql.js.
 *
 * In static-export mode (GitHub Pages) there is no Node server, so
 * `better-sqlite3` is unreachable. Instead we download the shipped
 * `carmenita.db` file into sql.js (a WebAssembly port of SQLite), hold
 * the resulting Database in module scope, and serve every `/api/*`
 * request from it via the fetch interceptor.
 *
 * Writes: any change (attempts, answers, new quizzes, notes, ...) is
 * flushed to IndexedDB under the single key `carmenita.db.blob`. On the
 * next page load we prefer the IndexedDB copy over the shipped file so
 * user progress persists across sessions, per browser, per device.
 *
 * No OPFS, no cross-device sync, no conflict resolution — this is a
 * deliberately small persistence layer for a single-user demo deploy.
 */
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const IDB_NAME = "carmenita-local";
const IDB_STORE = "blobs";
const IDB_KEY = "carmenita.db.blob";

let sqlJs: SqlJsStatic | null = null;
let db: Database | null = null;
let readyPromise: Promise<Database> | null = null;

/**
 * Resolve the base path prefix injected by next.config.ts /
 * build-static.sh. Empty string for root deploys, `/carmenita` for
 * GitHub Pages sub-paths.
 */
function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH || "";
}

// ── IndexedDB helpers (tiny single-key wrapper, no deps) ────────────────
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetBlob(): Promise<Uint8Array | null> {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutBlob(blob: Uint8Array): Promise<void> {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Idempotently loads the local DB. First call fetches the shipped .db
 * (or restores the IndexedDB copy), subsequent calls return the cached
 * instance.
 */
export function initLocalDb(): Promise<Database> {
  if (db) return Promise.resolve(db);
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    // 1. Load sql.js WASM. The binary is copied to /sql-wasm.wasm by
    //    scripts/build-static.sh and fetched with basePath applied.
    if (!sqlJs) {
      sqlJs = await initSqlJs({
        locateFile: (file) => `${basePath()}/${file}`,
      });
    }

    // 2. Prefer the user's saved IndexedDB copy (persisted writes).
    //    Fall back to the shipped seed DB on first load or IDB miss.
    let buf: Uint8Array | null = null;
    try {
      buf = await idbGetBlob();
    } catch {
      // Private-mode or broken IDB — continue with shipped DB.
    }
    if (!buf) {
      const res = await fetch(`${basePath()}/carmenita.db`);
      if (!res.ok) {
        throw new Error(`Failed to fetch seed DB: ${res.status}`);
      }
      buf = new Uint8Array(await res.arrayBuffer());
    }

    db = new sqlJs.Database(buf);
    return db;
  })();

  return readyPromise;
}

/**
 * Serialize the current in-memory DB and write it to IndexedDB. Call
 * after every mutation so user progress survives page reloads.
 */
export async function flushLocalDb(): Promise<void> {
  if (!db) return;
  const buf = db.export();
  try {
    await idbPutBlob(buf);
  } catch {
    // Storage full or broken IDB — silent: the session still works,
    // only persistence is lost. We can't tell the user here because
    // this runs from the fetch interceptor.
  }
}

/**
 * Convenience: run a prepared SELECT and return all rows as plain
 * objects keyed by column name (matching the output shape of
 * better-sqlite3's `.all()`).
 */
export function queryAll<T extends Record<string, unknown>>(
  sqlText: string,
  params: Array<string | number | null> = [],
): T[] {
  if (!db) throw new Error("local DB not initialized");
  const stmt = db.prepare(sqlText);
  stmt.bind(params as unknown as Record<string, string | number | null> | null);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

/** Like queryAll but returns the first row or null. */
export function queryOne<T extends Record<string, unknown>>(
  sqlText: string,
  params: Array<string | number | null> = [],
): T | null {
  const rows = queryAll<T>(sqlText, params);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and return the affected rowcount. */
export function run(
  sqlText: string,
  params: Array<string | number | null> = [],
): number {
  if (!db) throw new Error("local DB not initialized");
  db.run(sqlText, params);
  const changes = queryOne<{ c: number }>("SELECT changes() AS c");
  return changes?.c ?? 0;
}
