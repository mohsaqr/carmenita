#!/usr/bin/env node
/**
 * Split a fetch.py questions.json into a directory (index.json + one file
 * per set) that add.mjs / build.mjs read one set at a time, so a small
 * server never holds all 189k questions in memory. Run it on a machine
 * with RAM to spare, then copy the directory over.
 *
 * Usage: node scripts/medical-bank/split.mjs <questions.json> <out-dir>
 */
import { existsSync } from "node:fs";
import { isMain, splitSetSource } from "./bank-lib.mjs";

if (isMain(import.meta.url)) {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) {
    console.error("Usage: node scripts/medical-bank/split.mjs <questions.json> <out-dir>");
    process.exit(1);
  }
  if (existsSync(outDir)) {
    console.error(`${outDir} already exists — not overwriting`);
    process.exit(1);
  }
  const index = splitSetSource(input, outDir);
  console.log(`Wrote ${index.length} sets (${index.reduce((n, s) => n + s.count, 0)} questions) to ${outDir}`);
}
