import { NextResponse } from "next/server";
import { EDITION, runtimeBuildInfo } from "@/lib/build-info";
import { withLog } from "@/lib/request-log";

/**
 * Liveness + build identity. No login, no DB. The mac-push deploy flips
 * a release live only if this reports the commit it shipped (and the
 * edition), and rolls back otherwise; it also answers "which commit is
 * live?" in one curl. A short commit id is not a secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet() {
  const build = runtimeBuildInfo();
  return NextResponse.json({
    ok: true,
    edition: EDITION,
    version: build.version,
    commit: build.commit,
    builtAt: build.builtAt,
    ...(build.dirty ? { dirty: true } : {}),
  });
}

export const GET = withLog(handleGet);
