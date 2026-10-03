import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfPageText {
  page: number;
  text: string;
}

/**
 * Server-side PDF text extraction (Mozilla pdf.js, pure JS, no native deps).
 *
 * Contract PDFs are sent to the AI provider as plain `input_text`, never as
 * `input_file` data URLs: several OpenAI-compatible gateways accept the file
 * part, bill its tokens, and then silently drop it, so the model reports that
 * no document was attached while tokens burn. Text travels on every gateway.
 */
export async function extractPdfPageTexts(
  bytes: Uint8Array,
  maxPages: number,
): Promise<{ pages: PdfPageText[]; truncated: boolean }> {
  const data = bytes instanceof Uint8Array && !Buffer.isBuffer(bytes) ? bytes : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  try {
    const count = Math.min(doc.numPages, maxPages);
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        const str = (item as { str?: unknown }).str;
        if (typeof str === "string" && str) {
          parts.push(str);
          if ((item as { hasEOL?: unknown }).hasEOL === true) parts.push("\n");
        }
      }
      pages.push({ page: n, text: parts.join(" ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim() });
    }
    return { pages, truncated: doc.numPages > maxPages };
  } finally {
    await doc.cleanup();
  }
}

/** Renders labeled per-page text for one contract document. */
export function documentTextBlock(kind: string, filename: string, documentVersion: number, pages: PdfPageText[]): string {
  const body = pages.map((p) => `--- page ${p.page} ---\n${p.text}`).join("\n\n");
  return `${kind} contract document (filename: ${filename}, contract version ${documentVersion}):\n${body}`;
}
