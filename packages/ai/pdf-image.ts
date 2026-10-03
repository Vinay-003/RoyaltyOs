import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

export interface PdfPageImage {
  page: number;
  png: Uint8Array;
}

/**
 * Renders PDF pages to PNG buffers for vision-model input (pdf.js plus a
 * prebuilt canvas; no system libraries needed on Render).
 *
 * Text extraction stays the default path: it is cheaper, exact, and works
 * with strict structured outputs on every gateway. Page images are the
 * fallback for documents whose meaning lives in layout or scans, on
 * providers whose chat/completions endpoint forwards image parts.
 */
export async function renderPdfPageImages(
  bytes: Uint8Array,
  maxPages: number,
  scale = 2,
): Promise<{ images: PdfPageImage[]; truncated: boolean }> {
  const data = bytes instanceof Uint8Array && !Buffer.isBuffer(bytes) ? bytes : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  try {
    const count = Math.min(doc.numPages, maxPages);
    const images: PdfPageImage[] = [];
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(viewport.width, viewport.height);
      await page.render({ canvas: canvas as never, viewport }).promise;
      images.push({ page: n, png: canvas.toBuffer("image/png") });
    }
    return { images, truncated: doc.numPages > maxPages };
  } finally {
    await doc.cleanup();
  }
}
