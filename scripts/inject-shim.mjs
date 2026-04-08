#!/usr/bin/env node
/**
 * Post-build step: hoist the carmenita inline fetch-interceptor shim
 * to be the FIRST script tag in every exported HTML file's <head>.
 *
 * Why a post-build step:
 *   Next.js App Router (under `output: "export"`) renders layout JSX
 *   children AFTER it's already injected its own async chunk <script>
 *   tags into the <head>. That means even when the layout places a
 *   plain `<script dangerouslySetInnerHTML>` at the top of its JSX,
 *   the generated HTML has it at position ~15, after every chunk tag.
 *
 *   Inline scripts are supposed to run synchronously at parse time,
 *   but if the HTML parser yields mid-head (which is implementation-
 *   defined), an async chunk that has already finished downloading
 *   can execute before the inline script is reached. That's the race
 *   condition that caused "Bank load failed (404)" on the live site.
 *
 *   Putting the shim at the very top of <head>, before any <script>
 *   tag, eliminates the race because the parser can't have downloaded
 *   any async chunk yet — the <script src> tags are parsed strictly
 *   later.
 *
 * Usage:
 *   node scripts/inject-shim.mjs <out-dir> [basePath]
 *
 *   out-dir:   the Next export output directory (typically ./out)
 *   basePath:  optional, defaults to $PAGES_BASE_PATH or ""
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] || "./out";
const basePath = process.argv[3] || process.env.PAGES_BASE_PATH || "";

const SHIM = `<script id="carmenita-fetch-shim">(function(){
  if (typeof window === 'undefined') return;
  var base = ${JSON.stringify(basePath)};
  var realFetch = window.fetch.bind(window);
  var queue = [];
  window.__carmenitaRealFetch = realFetch;
  window.__carmenitaFetchQueue = queue;
  window.__carmenitaShimActive = true;
  window.fetch = function(input, init){
    try {
      var rawUrl = typeof input === 'string'
        ? input
        : (input && input.url) ? input.url : String(input);
      var path = new URL(rawUrl, window.location.origin).pathname;
      var stripped = base && path.indexOf(base) === 0
        ? path.slice(base.length)
        : path;
      if (stripped.indexOf('/api/') !== 0) {
        return realFetch(input, init);
      }
    } catch (e) {
      return realFetch(input, init);
    }
    return new Promise(function(resolve, reject){
      queue.push({ input: input, init: init, resolve: resolve, reject: reject });
    });
  };
  console.log('[carmenita] inline fetch shim installed (base=' + base + ')');
})();</script>`;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const files = walk(outDir);
let touched = 0;
let skipped = 0;
for (const file of files) {
  const html = readFileSync(file, "utf8");
  // Remove the old in-body instance emitted by layout.tsx so we don't
  // have two copies. The React-rendered one sits further down the
  // head and would otherwise still fire (harmless but noisy in logs).
  const cleaned = html.replace(
    /<script id="carmenita-fetch-shim">[\s\S]*?<\/script>/g,
    "",
  );
  if (!cleaned.includes("<head>")) {
    skipped++;
    continue;
  }
  // Inject the shim as the FIRST child of <head>. Position it before
  // every async chunk <script> tag so the HTML parser executes it
  // synchronously before any chunk can begin its own execution.
  const patched = cleaned.replace("<head>", `<head>${SHIM}`);
  writeFileSync(file, patched);
  touched++;
}

console.log(
  `[inject-shim] hoisted shim into ${touched} HTML file(s), basePath=${
    JSON.stringify(basePath)
  }${skipped ? `, skipped ${skipped}` : ""}`,
);
