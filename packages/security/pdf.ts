import { sha256Hex } from "../core/hash.ts";

export type PdfValidationResult = {
  sha256: string;
  sizeBytes: number;
  pageCount: number;
};

export function validatePdf(bytes: Uint8Array, maxBytes: number, maxPages: number): PdfValidationResult {
  if (!bytes.length) throw new Error("PDF is empty");
  if (bytes.length > maxBytes) throw new Error(`PDF exceeds ${maxBytes} bytes`);
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 8));
  if (!head.startsWith("%PDF-")) throw new Error("File magic bytes are not a PDF");
  const tail = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.length - 4096)));
  if (!tail.includes("%%EOF")) throw new Error("PDF is truncated or missing EOF marker");
  const latin = new TextDecoder("latin1").decode(bytes);
  const pageCount = Math.max(1, (latin.match(/\/Type\s*\/Page\b/g) ?? []).length);
  if (pageCount > maxPages) throw new Error(`PDF exceeds ${maxPages} pages`);
  return { sha256: sha256Hex(bytes), sizeBytes: bytes.length, pageCount };
}
