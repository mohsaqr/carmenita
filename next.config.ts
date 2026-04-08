import type { NextConfig } from "next";

/**
 * Two build modes:
 *
 *   1. Normal (default) — `next build` produces a `standalone` Node.js
 *      server with real `/api/*` routes backed by better-sqlite3. This is
 *      the mode used for local dev, Fly.io, Vercel, self-hosting, etc.
 *
 *   2. Static export — `STATIC_BUILD=1 next build` produces a fully
 *      static site in `out/` that can be hosted on GitHub Pages or any
 *      CDN. In this mode there is NO Node runtime, so:
 *        • API routes are moved aside by scripts/build-static.sh before
 *          `next build` runs and restored afterward.
 *        • The client-side code intercepts `fetch('/api/*')` and serves
 *          the response from a sql.js instance loaded with the shipped
 *          carmenita.db (see src/lib/local-api/).
 *
 *   When deployed under a sub-path like github.io/<user>/carmenita, the
 *   build expects PAGES_BASE_PATH=/carmenita so Next rewrites asset URLs.
 */
const isStaticExport = process.env.STATIC_BUILD === "1";
const basePath = process.env.PAGES_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : "standalone",
  ...(isStaticExport && basePath
    ? { basePath, assetPrefix: basePath }
    : {}),
  // Static export cannot generate optimized images on the fly because
  // there is no Node runtime. Disable the image optimizer in that mode.
  ...(isStaticExport ? { images: { unoptimized: true } } : {}),
  // trailingSlash: true makes Next emit `out/take/index.html` instead
  // of `out/take.html`, so GitHub Pages serves BOTH `/take` and
  // `/take/` as the same directory index. Without this, `/take/`
  // (with slash) returns 404 because Pages looks only for
  // `take/index.html`. Next's client router also stops producing URLs
  // without trailing slashes, so internal navigation is consistent
  // with what Pages actually serves.
  ...(isStaticExport ? { trailingSlash: true } : {}),
  // Ignore TS errors in static builds — they only come from the API
  // route handlers we strip out, so failing on them is pointless. Next
  // 16 dropped the top-level `eslint` config key, so we skip lint via
  // the build script's env instead (no lint is run during next build
  // anyway in modern versions).
  ...(isStaticExport ? { typescript: { ignoreBuildErrors: true } } : {}),
  devIndicators: false,
  // Server-external packages: these are NOT bundled by Webpack on the
  // server side. Node's normal `import` resolution is used instead,
  // which is essential for:
  //   • better-sqlite3 — native module, cannot be bundled.
  //   • pdfjs-dist    — the legacy build spawns a "fake worker" by
  //                     dynamically importing ./pdf.worker.mjs; bundling
  //                     breaks that path lookup, so we externalize it.
  //   • mammoth       — uses dynamic requires for its zip backend.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
