import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractText, isLectureFilename } from "@/lib/doc-extract";

/**
 * PPTX extraction tests. We build a minimal .pptx fixture in-memory
 * via JSZip rather than committing a binary file — this keeps the repo
 * clean, avoids large files in git history, and makes the fixture
 * structure explicit. A real PPTX has many more support files (rels,
 * theme, presentation.xml, etc.), but our extractor only cares about
 * `ppt/slides/slide*.xml`, so that's all we need to create.
 *
 * The key assertion is that the extractor:
 *   1. Discovers slide files via the regex
 *   2. Sorts them numerically (slide10 > slide9, not lexically)
 *   3. Extracts <a:t> text runs
 *   4. Preserves slide boundaries as "--- Slide N ---" markers
 *   5. Decodes XML entities
 */

async function buildFakePptx(
  slides: { num: number; text: string }[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const s of slides) {
    // Minimal DrawingML slide: a single paragraph with one text run.
    // Real PPTX files have extra wrapping elements, but our regex
    // doesn't care about them — it only looks for <a:t>…</a:t>.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:t>${s.text}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    zip.file(`ppt/slides/slide${s.num}.xml`, xml);
  }
  return new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
}

describe("extractPptx", () => {
  it("extracts text from a single slide", async () => {
    const bytes = await buildFakePptx([
      { num: 1, text: "Introduction to Mitochondria" },
    ]);
    const result = await extractText(bytes, "lecture.pptx");
    expect(result.text).toContain("Introduction to Mitochondria");
    expect(result.text).toContain("--- Slide 1 ---");
  });

  it("preserves slide boundaries with numbered markers", async () => {
    const bytes = await buildFakePptx([
      { num: 1, text: "Slide one content" },
      { num: 2, text: "Slide two content" },
      { num: 3, text: "Slide three content" },
    ]);
    const result = await extractText(bytes, "deck.pptx");
    expect(result.text).toContain("--- Slide 1 ---");
    expect(result.text).toContain("--- Slide 2 ---");
    expect(result.text).toContain("--- Slide 3 ---");
    expect(result.text).toContain("Slide one content");
    expect(result.text).toContain("Slide two content");
    expect(result.text).toContain("Slide three content");
  });

  it("sorts slides numerically, not lexically (slide10 after slide9)", async () => {
    const bytes = await buildFakePptx([
      { num: 9, text: "NINE" },
      { num: 10, text: "TEN" },
      { num: 2, text: "TWO" },
      { num: 1, text: "ONE" },
    ]);
    const result = await extractText(bytes, "deck.pptx");
    // Find the position of each slide marker and verify ordering
    const pos = (s: string) => result.text.indexOf(s);
    expect(pos("--- Slide 1 ---")).toBeGreaterThanOrEqual(0);
    expect(pos("--- Slide 1 ---")).toBeLessThan(pos("--- Slide 2 ---"));
    expect(pos("--- Slide 2 ---")).toBeLessThan(pos("--- Slide 9 ---"));
    expect(pos("--- Slide 9 ---")).toBeLessThan(pos("--- Slide 10 ---"));
  });

  it("decodes XML entities in slide text", async () => {
    const bytes = await buildFakePptx([
      { num: 1, text: "Acids &amp; bases: pH &lt; 7" },
    ]);
    const result = await extractText(bytes, "chem.pptx");
    expect(result.text).toContain("Acids & bases: pH < 7");
  });

  it("throws on a zip that has no slide files", async () => {
    const zip = new JSZip();
    zip.file("not-a-slide.xml", "<x/>");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
    await expect(extractText(bytes, "empty.pptx")).rejects.toThrow(/no slides/i);
  });

  it("throws on a non-zip file masquerading as .pptx", async () => {
    const bytes = new TextEncoder().encode("not a zip at all");
    await expect(extractText(bytes, "fake.pptx")).rejects.toThrow(/corrupted|valid/i);
  });

  it("throws a friendly error when every slide is empty", async () => {
    // A slide with zero <a:t> runs produces no extractable text.
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<?xml version="1.0"?><p:sld><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>',
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
    await expect(extractText(bytes, "image-only.pptx")).rejects.toThrow(
      /empty slides|text-layer/i,
    );
  });
});

describe("isLectureFilename", () => {
  it("returns true for .pptx", () => {
    expect(isLectureFilename("lecture.pptx")).toBe(true);
    expect(isLectureFilename("LECTURE.PPTX")).toBe(true);
    expect(isLectureFilename("cell-biology-week-4.pptx")).toBe(true);
  });

  it("returns false for .pdf / .docx / .txt", () => {
    expect(isLectureFilename("lecture.pdf")).toBe(false);
    expect(isLectureFilename("notes.docx")).toBe(false);
    expect(isLectureFilename("paper.txt")).toBe(false);
  });

  it("returns false for .ppt (legacy PowerPoint, we don't support it)", () => {
    expect(isLectureFilename("old-slides.ppt")).toBe(false);
  });
});
