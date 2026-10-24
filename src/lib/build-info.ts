import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which build is running — read from BUILD_INFO.json at runtime.
 *
 * `scripts/build-linux-artifact.sh` writes it beside the standalone
 * `server.js`, and the standalone server chdirs there, so it sits at the
 * cwd. `next dev` or a plain `next build` has no file and reports
 * "unknown". The mac-push deploy (deploy hub `activate-release.sh`) keeps
 * a release only if /api/health reports the commit it shipped.
 */
/** The edition /api/health reports; the deploy gate (EDITION_carmenitaapp) matches it. */
export const EDITION = "server";

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
  dirty: boolean;
}

export function readBuildInfo(cwd = process.cwd()): BuildInfo {
  const file = path.join(cwd, "BUILD_INFO.json");
  let raw: Partial<BuildInfo> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildInfo>;
  } catch (err) {
    // No file is the normal dev case; a present but unreadable file is not.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[build-info] could not read ${file}: ${(err as Error).message}`);
    }
  }
  return {
    version: typeof raw.version === "string" && raw.version ? raw.version : "unknown",
    commit: typeof raw.commit === "string" && raw.commit ? raw.commit : "unknown",
    builtAt: typeof raw.builtAt === "string" && raw.builtAt ? raw.builtAt : "unknown",
    dirty: raw.dirty === true,
  };
}

let cached: BuildInfo | null = null;

/** The running process's build, read once. */
export function runtimeBuildInfo(): BuildInfo {
  cached ??= readBuildInfo();
  return cached;
}
