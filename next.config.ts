import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
