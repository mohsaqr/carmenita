/**
 * Google Drive operations for syncing carmenita.db.
 *
 * Uses the `appDataFolder` space — a hidden, app-only folder in the
 * user's Drive that they never see in the Drive UI. Only this app's
 * OAuth client can read/write files there.
 *
 * Ported from tnashiny's R/mod_drive.R patterns:
 *   - initialize_drive_folders  → ensureDbFile (simpler: 1 file, not folders)
 *   - save_analysis_to_drive   → uploadDb
 *   - load_analysis_from_drive → downloadDb
 *   - list_analyses_from_drive → findDbFile
 */

import { getValidToken } from "./google-auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DB_FILENAME = "carmenita.db";

// ── Types ─────────────────────────────────────────────────────────────
export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

export type SyncStatus = "idle" | "uploading" | "downloading" | "error";

// ── Subscription for sync status ──────────────────────────────────────
let currentStatus: SyncStatus = "idle";
const statusListeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function subscribeSyncStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function setStatus(s: SyncStatus): void {
  currentStatus = s;
  statusListeners.forEach((fn) => fn());
}

// ── Core Drive operations ─────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

/** Find existing carmenita.db in appDataFolder. Returns file info or null. */
export async function findDbFile(): Promise<DriveFileInfo | null> {
  const headers = await authHeaders();
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${DB_FILENAME}' and trashed = false`,
    fields: "files(id,name,modifiedTime,size)",
    pageSize: "1",
  });

  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers });
  if (!res.ok) throw new Error(`Drive list failed: ${res.statusText}`);

  const data = await res.json();
  return data.files?.[0] ?? null;
}

/** Download the DB blob from Drive. */
export async function downloadDb(): Promise<Uint8Array> {
  setStatus("downloading");
  try {
    const file = await findDbFile();
    if (!file) throw new Error("No database found in Google Drive");

    const headers = await authHeaders();
    const res = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, { headers });
    if (!res.ok) throw new Error(`Drive download failed: ${res.statusText}`);

    const buf = await res.arrayBuffer();
    setStatus("idle");
    return new Uint8Array(buf);
  } catch (err) {
    setStatus("error");
    throw err;
  }
}

/**
 * Upload or update the DB blob in Drive's appDataFolder.
 * If the file already exists, updates it. Otherwise creates a new one.
 */
export async function uploadDb(dbBytes: Uint8Array): Promise<DriveFileInfo> {
  setStatus("uploading");
  try {
    const existing = await findDbFile();
    const headers = await authHeaders();

    const metadata = existing
      ? {} // update: no metadata changes needed
      : { name: DB_FILENAME, parents: ["appDataFolder"] };

    // Multipart upload: metadata JSON + binary blob
    const boundary = "carmenita_boundary_" + Date.now();
    const body = buildMultipartBody(boundary, metadata, dbBytes);

    const url = existing
      ? `${UPLOAD_API}/files/${existing.id}?uploadType=multipart`
      : `${UPLOAD_API}/files?uploadType=multipart`;

    const method = existing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body as unknown as BodyInit,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Drive upload failed: ${err.error?.message ?? res.statusText}`);
    }

    const data = await res.json();
    setStatus("idle");
    return {
      id: data.id,
      name: data.name,
      modifiedTime: data.modifiedTime ?? new Date().toISOString(),
      size: String(dbBytes.byteLength),
    };
  } catch (err) {
    setStatus("error");
    throw err;
  }
}

/** Delete the DB file from Drive (moves to trash). */
export async function trashDbFile(): Promise<void> {
  const file = await findDbFile();
  if (!file) return;
  const headers = await authHeaders();
  await fetch(`${DRIVE_API}/files/${file.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

// ── Multipart body builder ────────────────────────────────────────────

function buildMultipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  data: Uint8Array,
): Uint8Array {
  const encoder = new TextEncoder();

  const metaPart = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n`,
  );

  const dataPreamble = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/x-sqlite3\r\n` +
    `Content-Transfer-Encoding: binary\r\n\r\n`,
  );

  const closing = encoder.encode(`\r\n--${boundary}--`);

  const combined = new Uint8Array(
    metaPart.byteLength + dataPreamble.byteLength + data.byteLength + closing.byteLength,
  );
  let offset = 0;
  combined.set(metaPart, offset); offset += metaPart.byteLength;
  combined.set(dataPreamble, offset); offset += dataPreamble.byteLength;
  combined.set(data, offset); offset += data.byteLength;
  combined.set(closing, offset);

  return combined;
}

// ── Debounced auto-sync ───────────────────────────────────────────────
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let uploadInFlight = false;
const SYNC_DELAY_MS = 5_000;

/**
 * Schedule a debounced upload. Call this after every DB mutation.
 * Requires a getter that returns the current DB bytes.
 * Guards against concurrent uploads — if one is in progress, re-schedules.
 */
export function scheduleDriveSync(getDbBytes: () => Uint8Array | null): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (uploadInFlight) {
      // An upload is already running — re-schedule so the latest state gets uploaded
      scheduleDriveSync(getDbBytes);
      return;
    }
    const bytes = getDbBytes();
    if (!bytes) return;
    uploadInFlight = true;
    try {
      await uploadDb(bytes);
    } catch {
      // Silently fail — the status subscription shows "error".
    } finally {
      uploadInFlight = false;
    }
  }, SYNC_DELAY_MS);
}
