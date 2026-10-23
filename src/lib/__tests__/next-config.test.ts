import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

/**
 * pdfjs loads its worker by a computed path the file tracer can't follow,
 * so without an explicit include `.next/standalone` ships without it and
 * every PDF upload on the live server fails ("Setting up fake worker
 * failed: Cannot find module …/pdf.worker.mjs"). That happened until
 * 2026-10-20.
 */
describe("next.config standalone tracing", () => {
  const includes = nextConfig.outputFileTracingIncludes?.["/api/documents"] ?? [];

  it("ships the pdfjs worker and standard fonts with the upload route", () => {
    expect(includes).toContain("./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
    expect(includes).toContain("./node_modules/pdfjs-dist/standard_fonts/**");
  });

  it("points at a worker file that exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"))).toBe(true);
  });

  it("keeps databases and local scratch data out of the standalone build", () => {
    const excludes = nextConfig.outputFileTracingExcludes?.["*"] ?? [];
    expect(excludes).toEqual(expect.arrayContaining(["./carmenita.db*", "./seed/**", "./tmp/**"]));
  });
});
