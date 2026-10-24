#!/usr/bin/env bash
# Build a LINUX-RUNNABLE standalone bundle ON THE MAC for the mac-push deploy
# of carmenita.lacarm.com (deploy hub: ./deploy.sh carmenitaapp).
#
#   bash scripts/build-linux-artifact.sh
#
# The server (Ubuntu 24.04, x86_64, Node 22) runs `node server.js` from the
# bundle, so the bundle must carry Linux natives, not the Mac's. Only the
# bundle is changed — the repo's node_modules keep their darwin binaries, so
# `npm run dev` and the tests are unaffected:
#   - better-sqlite3 → the project's prebuilt linux-x64 binary for the
#                      server's Node ABI (NODE_ABI, default 127 = Node 22)
#   - sharp          → @img/sharp-linux-x64 + libvips, from npm
#
# It also ships what the server needs that a plain `next build` leaves out:
# static assets + public/, the DB migrations (applied at server start by
# src/instrumentation.ts) and BUILD_INFO.json (the commit /api/health
# reports — the deploy's health gate requires it).
#
# FAIL-CLOSED: the verify step exits non-zero if any native in the bundle is
# not Linux x86-64, or anything the server needs is missing, or a DB / .env
# would ship. A broken artifact must never reach rsync.
set -euo pipefail

NODE_ABI="${NODE_ABI:-127}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT=".next/standalone"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A build from a tree with uncommitted edits is not the commit it names.
COMMIT="$(git rev-parse --short HEAD)"
DIRTY=false
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  COMMIT="${COMMIT}-dirty"
  DIRTY=true
fi
VERSION="$(node -p "require('./package.json').version")"

echo "▶ [1/5] Building (commit $COMMIT)…"
# Finder can drop a .DS_Store into the tree mid-delete; one retry clears it.
rm -rf "$OUT" 2>/dev/null || rm -rf "$OUT"
npm run build

echo "▶ [2/5] Staging static assets, public/ and migrations…"
mkdir -p "$OUT/.next/static" "$OUT/public" "$OUT/src/db/migrations"
rsync -a --delete --checksum .next/static/ "$OUT/.next/static/"
rsync -a --delete --checksum public/ "$OUT/public/"
rsync -a --delete --checksum src/db/migrations/ "$OUT/src/db/migrations/"
# Never ship local state: the live DB, its backups, an .env, session notes.
# (Next's file tracing copies much of the repo root into the bundle.)
rm -f "$OUT"/.env "$OUT"/.env.* "$OUT"/*.db "$OUT"/*.db-* "$OUT"/*.db.*
rm -f "$OUT"/HANDOFF.md "$OUT"/LEARNINGS.md "$OUT"/CHANGES.md "$OUT"/CLAUDE.md
rm -rf "$OUT/tmp" "$OUT/seed"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: process.argv[2], commit: process.argv[3],
    builtAt: new Date().toISOString(), dirty: process.argv[4] === "true",
  }, null, 2) + "\n");
' "$OUT/BUILD_INFO.json" "$VERSION" "$COMMIT" "$DIRTY"

echo "▶ [3/5] better-sqlite3 → linux-x64 (Node ABI $NODE_ABI)…"
BS_VERSION="$(node -p "require('./node_modules/better-sqlite3/package.json').version")"
BS_URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${BS_VERSION}/better-sqlite3-v${BS_VERSION}-node-v${NODE_ABI}-linux-x64.tar.gz"
curl -fsSL "$BS_URL" -o "$WORK/bs.tgz"
tar xzf "$WORK/bs.tgz" -C "$WORK"
cp "$WORK/build/Release/better_sqlite3.node" "$OUT/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

echo "▶ [4/5] sharp → linux-x64…"
if [ -d "$OUT/node_modules/sharp" ]; then
  SHARP_VERSION="$(node -p "require('./node_modules/sharp/package.json').version")"
  LIBVIPS_VERSION="$(npm view "@img/sharp-linux-x64@$SHARP_VERSION" "optionalDependencies.@img/sharp-libvips-linux-x64" | tr -d '^~')"
  rm -rf "$OUT"/node_modules/@img/sharp-darwin-* "$OUT"/node_modules/@img/sharp-libvips-darwin-*
  for spec in "sharp-linux-x64@$SHARP_VERSION" "sharp-libvips-linux-x64@$LIBVIPS_VERSION"; do
    pkg="${spec%@*}"
    tarball="$(cd "$WORK" && npm pack "@img/$spec" --silent)"
    mkdir -p "$OUT/node_modules/@img/$pkg"
    tar xzf "$WORK/$tarball" -C "$OUT/node_modules/@img/$pkg" --strip-components=1
  done
fi

echo "▶ [5/5] Verifying the bundle is Linux-runnable…"
fail=0
check() { if [ -e "$1" ]; then echo "    ✓ $2"; else echo "    ✗ MISSING: $2 ($1)"; fail=1; fi; }
check "$OUT/server.js" "standalone server.js"
check "$OUT/.next/static" "static assets"
check "$OUT/src/db/migrations/meta/_journal.json" "DB migrations"
check "$OUT/node_modules/better-sqlite3/build/Release/better_sqlite3.node" "better-sqlite3 native"
if grep -q "\"commit\": \"$COMMIT\"" "$OUT/BUILD_INFO.json"; then echo "    ✓ BUILD_INFO.json ($COMMIT)"; else echo "    ✗ BUILD_INFO.json does not name $COMMIT"; fail=1; fi
# Every native module must be a Linux x86-64 ELF — one Mach-O left behind
# crashes the server on the first request that loads it.
while IFS= read -r native; do
  if file -b "$native" | grep -q "ELF 64-bit.*x86-64"; then
    echo "    ✓ linux x86-64: ${native#"$OUT"/}"
  else
    echo "    ✗ NOT linux x86-64: ${native#"$OUT"/} ($(file -b "$native" | cut -c1-60))"; fail=1
  fi
done < <(find "$OUT" -name "*.node" -type f)
if find "$OUT" -maxdepth 1 \( -name "*.db" -o -name "*.db-*" -o -name ".env*" \) | grep -q .; then
  echo "    ✗ a database or .env file is in the bundle"; fail=1
else
  echo "    ✓ no database or .env in the bundle"
fi
if [ "$fail" -ne 0 ]; then
  echo "✗ Artifact is NOT deployable — refusing." >&2
  exit 1
fi
echo "✓ Linux-runnable bundle ready at $OUT (commit $COMMIT)"
