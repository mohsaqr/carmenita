import path from "node:path";

/**
 * Where the live database lives. `CARMENITA_DB` (absolute path) is set in
 * production so the DB sits outside the repo checkout — the deploy cron
 * runs `git reset --hard` there, and Next's standalone server chdirs into
 * `.next/standalone`. Defaults to ./carmenita.db for local dev.
 */
export function resolveDbPath(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(cwd, env.CARMENITA_DB || "carmenita.db");
}
