#!/usr/bin/env bash
#
# Build Carmenita as a fully static site for GitHub Pages.
#
# Next.js refuses to statically export a project that has dynamic server
# routes, so we physically move `src/app/api/` and `src/proxy.ts`
# out of the source tree for the duration of the build and restore them
# afterward. The client-side code then uses `src/lib/local-api/` to
# intercept `fetch('/api/*')` calls and serve them from sql.js loaded
# with the shipped carmenita.db.
#
# Usage:
#   scripts/build-static.sh                    # build to ./out (no basePath)
#   PAGES_BASE_PATH=/carmenita scripts/build-static.sh  # for github.io sub-path
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_SRC="src/app/api"
API_STASH=".build-stash/api"
MW_SRC="src/proxy.ts"
MW_STASH=".build-stash/proxy.ts"

# Restore stashed files no matter what — even if the build fails.
restore() {
  set +e
  if [ -d "$API_STASH" ]; then
    rm -rf "$API_SRC"
    mkdir -p "$(dirname "$API_SRC")"
    mv "$API_STASH" "$API_SRC"
    echo "[build-static] restored $API_SRC"
  fi
  if [ -f "$MW_STASH" ]; then
    mv "$MW_STASH" "$MW_SRC"
    echo "[build-static] restored $MW_SRC"
  fi
  # Prune empty stash dir
  [ -d ".build-stash" ] && rmdir .build-stash 2>/dev/null || true
}
trap restore EXIT INT TERM

rm -rf .build-stash
mkdir -p .build-stash

# Stash API routes
if [ -d "$API_SRC" ]; then
  mv "$API_SRC" "$API_STASH"
  echo "[build-static] stashed $API_SRC"
fi

# Stash the login proxy (it wouldn't run on static Pages anyway, and Next
# complains if it references server-only request objects).
if [ -f "$MW_SRC" ]; then
  mv "$MW_SRC" "$MW_STASH"
  echo "[build-static] stashed $MW_SRC"
fi

# Copy the seed DB into public/ so it's served at /carmenita.db (or
# /carmenita/carmenita.db under a sub-path). sql.js fetches it at runtime.
# Source is the COMMITTED seed (seed/carmenita.seed.db, regenerate with
# `node scripts/make-seed.mjs`), never the live, gitignored carmenita.db.
# Override with SEED_DB=path for a one-off build.
SEED_DB="${SEED_DB:-seed/carmenita.seed.db}"
export CARMENITA_SEED_DB="$ROOT/$SEED_DB"   # read by static-params.ts
if [ -f "$SEED_DB" ]; then
  mkdir -p public
  cp "$SEED_DB" public/carmenita.db
  echo "[build-static] copied $SEED_DB -> public/carmenita.db"
  # Defense in depth: make-seed.mjs already strips these, but an
  # overridden SEED_DB might not be. app_settings holds LLM API keys.
  node -e '
    const Database = require("better-sqlite3");
    const db = new Database("public/carmenita.db");
    for (const t of ["sessions", "users", "app_settings"]) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("table", t);
      if (exists) db.prepare(`DELETE FROM ${t}`).run();
    }
    db.pragma("journal_mode = DELETE");
    db.exec("VACUUM");
    db.close();
  '
  echo "[build-static] stripped users/sessions/app_settings from the public seed"
else
  echo "[build-static] WARNING: $SEED_DB not found — the site will have no seed data" >&2
fi

# Copy sql.js WASM blobs into public/ so the sql.js loader can fetch
# them at runtime. The `sql.js` package's default browser entry point
# resolves to `sql-wasm-browser.js`, which requests
# `sql-wasm-browser.wasm` via its `locateFile` callback. We also copy
# the non-browser variant in case a consumer imports from `sql.js/dist`
# directly. Both files live under node_modules/sql.js/dist/.
mkdir -p public
for f in sql-wasm-browser.wasm sql-wasm.wasm; do
  src="node_modules/sql.js/dist/$f"
  if [ -f "$src" ]; then
    cp "$src" "public/$f"
    echo "[build-static] copied $f -> public/"
  fi
done

echo "[build-static] running next build (STATIC_BUILD=1)..."
# NEXT_PUBLIC_* env vars are inlined into the client JS bundle:
#   NEXT_PUBLIC_BASE_PATH    — sub-path prefix for /carmenita.db fetch
#   NEXT_PUBLIC_STATIC_BUILD — runtime flag that activates the fetch
#                              interceptor in StaticApiBootstrap
STATIC_BUILD=1 \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_STATIC_BUILD=1 \
  NEXT_PUBLIC_BASE_PATH="${PAGES_BASE_PATH:-}" \
  npx next build

# Post-build: hoist the inline fetch-interceptor shim to be the FIRST
# tag inside every HTML file's <head>. Next App Router won't let us
# place it ahead of its own async chunk <script> tags from the React
# tree, so we rewrite the HTML directly. This closes the last possible
# race window between async chunk execution and the shim's installation.
echo "[build-static] hoisting fetch shim into HTML files..."
node scripts/inject-shim.mjs out "${PAGES_BASE_PATH:-}"

echo "[build-static] build complete — output in ./out"
