/**
 * Server-side document text extraction.
 *
 * Accepts a `Uint8Array` buffer plus a filename and returns extracted plain
 * text. Supported types:
 *
 *   .pdf                        → pdfjs-dist (worker disabled for server context)
 *   .docx                       → mammoth
 *   .pptx                       → jszip + regex on slide XML (no native deps)
 *   .xlsx / .xls                → xlsx library (sheet_to_csv)
 *   .txt / .md / .json / .csv / .html / .htm → UTF-8 (with Windows-1252 fallback)
 *
 * Ported from handai's `src/lib/document-browser.ts` (same PDF layout
 * reconstruction, same encoding fallback chain, same 50k char truncation).
 * The File/arrayBuffer-based API was replaced with Uint8Array + filename
 * so the same function works in Next.js route handlers without needing a
 * Web File polyfill.
 */

export interface ExtractResult {
  text: string;
  truncated: boolean;
  charCount: number;
}

const CHAR_LIMIT = 50_000;

/**
 * Extract plain text from a document buffer. Dispatches on file extension.
 * Throws an Error with a human-readable message on failure.
 */
export async function extractText(
  buffer: Uint8Array,
  filename: string,
): Promise<ExtractResult> {
  const name = filename.toLowerCase();

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".csv") ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  ) {
    return extractPlainText(buffer);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractExcel(buffer);
  if (name.endsWith(".docx")) return extractDocx(buffer);
  if (name.endsWith(".pptx")) return extractPptx(buffer);
  if (name.endsWith(".pdf")) return extractPdf(buffer);

  // Fallback: try decoding as plain text
  return extractPlainText(buffer);
}

/**
 * True if the filename looks like a lecture source (PPTX). Used by the
 * generate-quiz route to switch the prompt id to `carmenita.mcq.lecture`.
 */
export function isLectureFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pptx");
}

// ── Plain text with encoding fallback ────────────────────────────────────────

function extractPlainText(bytes: Uint8Array): ExtractResult {
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const src = hasUtf8Bom ? bytes.subarray(3) : bytes;
  const utf8 = new TextDecoder("utf-8").decode(src);
  const text =
    !hasUtf8Bom && utf8.includes("\uFFFD")
      ? new TextDecoder("windows-1252").decode(src)
      : utf8;
  return finalize(text);
}

// ── Excel via xlsx library ───────────────────────────────────────────────────

async function extractExcel(bytes: Uint8Array): Promise<ExtractResult> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array" });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        if (workbook.SheetNames.length > 1) lines.push(`--- Sheet: ${sheetName} ---`);
        lines.push(csv.trim());
      }
    }
    const text = lines.join("\n\n");
    if (!text) throw new Error("This Excel file appears to be empty.");
    return finalize(text);
  } catch (err) {
    if (err instanceof Error && err.message.includes("empty")) throw err;
    throw new Error(
      `Excel file could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── DOCX via mammoth ─────────────────────────────────────────────────────────

async function extractDocx(bytes: Uint8Array): Promise<ExtractResult> {
  let result: { value: string };
  try {
    const mammoth = await import("mammoth");
    // mammoth expects a Buffer in Node; Uint8Array is accepted via the
    // `buffer` field in their input options.
    result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
  } catch (err) {
    throw new Error(
      `DOCX could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!result.value.trim()) {
    throw new Error("This DOCX file appears to be empty or contains only images.");
  }

  return finalize(result.value);
}

// ── PDF via pdfjs-dist ────────────────────────────────────────────────────────

/**
 * Reconstruct readable text from pdfjs TextContent items using position data.
 * Groups items into lines by Y coordinate, sorts left-to-right within each
 * line, and inserts sensible spacing. Handles multi-column layouts and tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reconstructText(items: any[]): string {
  const textItems = items.filter(
    (item) => "str" in item && typeof item.str === "string" && item.str.length > 0,
  );
  if (textItems.length === 0) return "";

  interface PosItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    hasEOL: boolean;
  }

  const positioned: PosItem[] = textItems.map((item) => ({
    str: item.str as string,
    x: (item.transform?.[4] ?? 0) as number,
    y: (item.transform?.[5] ?? 0) as number,
    width: (item.width ?? 0) as number,
    height: Math.abs((item.transform?.[3] ?? item.height ?? 10) as number),
    hasEOL: !!item.hasEOL,
  }));

  positioned.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.3) return dy;
    return a.x - b.x;
  });

  const lines: PosItem[][] = [];
  let currentLine: PosItem[] = [];
  let currentY = positioned[0]?.y ?? 0;

  for (const item of positioned) {
    const tolerance = Math.max(item.height * 0.3, 2);
    if (currentLine.length === 0 || Math.abs(currentY - item.y) <= tolerance) {
      currentLine.push(item);
      if (currentLine.length === 1) currentY = item.y;
    } else {
      lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  const outputLines: string[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let lineText = "";
    for (let i = 0; i < line.length; i++) {
      const item = line[i];
      if (i > 0) {
        const prev = line[i - 1];
        const gap = item.x - (prev.x + prev.width);
        const avgCharWidth = prev.str.length > 0 ? prev.width / prev.str.length : 5;
        if (gap > avgCharWidth * 3) {
          lineText += "  ";
        } else if (gap > avgCharWidth * 0.3) {
          lineText += " ";
        }
      }
      lineText += item.str;
    }
    outputLines.push(lineText);
  }

  return outputLines.join("\n");
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  // Use the legacy build for Node.js environments. The default `pdfjs-dist`
  // entry is targeted at modern browsers and tries to spawn a Web Worker
  // by dynamically importing "./pdf.worker.mjs", which fails under Webpack
  // bundling because the worker is in a different chunk path.
  // The legacy build runs synchronously on the main thread without a worker.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs needs to load its bundled base-14 standard fonts (Helvetica,
  // Times, Symbol, ZapfDingbats, Liberation*) to extract text. In Node
  // we can't use fetch(file://…) — Node's built-in fetch only supports
  // http(s). Instead we provide a StandardFontDataFactory that reads
  // font files directly from node_modules via fs.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const fontDir = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/standard_fonts",
  );

  class NodeStandardFontDataFactory {
    async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
      const data = await fs.readFile(path.join(fontDir, filename));
      return new Uint8Array(data);
    }
  }

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
  try {
    pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(bytes),
      // Fully disable worker-based fetching so pdfjs runs on the main thread.
      disableAutoFetch: true,
      disableStream: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      // Custom factory for reading standard font data from disk.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      StandardFontDataFactory: NodeStandardFontDataFactory as any,
      // Extra defensive: skip font face setup entirely since we only
      // need the text extraction path, not rendering.
      disableFontFace: true,
    }).promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (lower.includes("password") || (err as any)?.name === "PasswordException") {
      throw new Error(
        "This PDF is password-protected. Please remove the password before uploading.",
      );
    }
    if (lower.includes("invalid pdf") || lower.includes("unexpected")) {
      throw new Error("This PDF appears to be corrupted or is not a valid PDF file.");
    }
    throw new Error(`PDF could not be read: ${msg}`);
  }

  // First pass: default normalization
  let pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = reconstructText(content.items);
      if (text.trim()) pageTexts.push(text);
    } catch {
      /* skip failed page */
    }
  }

  // Retry with disableNormalization if we got very little text (some PDFs
  // with custom fonts produce empty strings under default normalization)
  let fullText = pageTexts.join("\n\n");
  if (fullText.trim().length < pdf.numPages * 50) {
    pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent({ disableNormalization: true });
        const text = reconstructText(content.items);
        if (text.trim()) pageTexts.push(text);
      } catch {
        /* skip */
      }
    }
    const retryText = pageTexts.join("\n\n");
    if (retryText.trim().length > fullText.trim().length) {
      fullText = retryText;
    }
  }

  if (!fullText.trim()) {
    throw new Error(
      "This PDF appears to be image-only or has no extractable text. " +
        "Please use a PDF with a text layer, or run OCR first.",
    );
  }

  return finalize(fullText);
}

// ── PPTX via jszip ───────────────────────────────────────────────────────────

/**
 * Extract text from a PowerPoint (.pptx) file. PPTX is a ZIP archive
 * containing a handful of XML files:
 *
 *   ppt/slides/slide1.xml, slide2.xml, ... — one XML file per slide
 *
 * Each slide's text lives inside `<a:t>...</a:t>` elements (DrawingML
 * text runs). We unzip via JSZip (pure JS, already a transitive dep),
 * enumerate the slide files in numeric order, and pull every text run
 * via a simple regex. Each slide's extracted text is prefixed with
 * `--- Slide N ---` so the lecture-mode prompt can reason about slide
 * boundaries.
 *
 * Notes:
 * - We decode XML entities (&amp; &lt; &gt; &quot; &apos;) since PPTX
 *   text runs frequently contain them.
 * - We skip empty slides silently.
 * - This is NOT a full XML parser — PPTX's `<a:t>` elements are always
 *   leaf text nodes with no nested markup, so a regex is sufficient and
 *   much faster than pulling in a full parser.
 */
async function extractPptx(bytes: Uint8Array): Promise<ExtractResult> {
  let JSZipModule;
  try {
    JSZipModule = (await import("jszip")).default;
  } catch (err) {
    throw new Error(
      `PPTX support requires jszip: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let zip;
  try {
    zip = await JSZipModule.loadAsync(bytes);
  } catch (err) {
    throw new Error(
      `PPTX file appears corrupted or is not a valid .pptx archive: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Collect slide XML paths and sort by the numeric suffix so the
  // output order matches the lecture presentation order.
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
  const slideEntries: { path: string; num: number }[] = [];
  zip.forEach((relativePath) => {
    const m = slideRegex.exec(relativePath);
    if (m) slideEntries.push({ path: relativePath, num: parseInt(m[1], 10) });
  });

  if (slideEntries.length === 0) {
    throw new Error(
      "This PPTX file contains no slides (no ppt/slides/slide*.xml entries found).",
    );
  }

  slideEntries.sort((a, b) => a.num - b.num);

  // Pull text from each slide. `<a:t>...</a:t>` is DrawingML's leaf text
  // element. We use `[^<]*` (not `.*?`) so the match can't accidentally
  // span across nested tags. PPTX guarantees no nested markup inside <a:t>.
  const textRunRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  const slideTexts: string[] = [];

  for (const entry of slideEntries) {
    const file = zip.file(entry.path);
    if (!file) continue;
    const xml = await file.async("string");

    const runs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = textRunRegex.exec(xml)) !== null) {
      const decoded = decodeXmlEntities(match[1]);
      if (decoded.length > 0) runs.push(decoded);
    }
    textRunRegex.lastIndex = 0;

    // Join runs within a slide with single spaces — DrawingML breaks
    // even contiguous text into multiple runs for formatting reasons,
    // but we want readable prose. Bullets naturally become separate
    // <a:p> paragraphs → multiple runs → join with newline would be
    // more accurate, but space is safer for short fragments.
    const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
    if (slideText.length > 0) {
      slideTexts.push(`--- Slide ${entry.num} ---\n${slideText}`);
    }
  }

  if (slideTexts.length === 0) {
    throw new Error(
      "This PPTX appears to contain only images or empty slides. " +
        "Carmenita can only generate questions from PPTX files with text-layer slide content.",
    );
  }

  return finalize(slideTexts.join("\n\n"));
}

/** Decode the 5 XML predefined entities. PPTX text runs use these heavily. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // must be last so we don't double-decode
}

// ── helpers ──────────────────────────────────────────────────────────────────

function finalize(text: string): ExtractResult {
  const charCount = text.length;
  const truncated = charCount > CHAR_LIMIT;
  return {
    text: truncated ? text.slice(0, CHAR_LIMIT) : text,
    truncated,
    charCount,
  };
}
