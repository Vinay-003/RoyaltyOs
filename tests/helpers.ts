import { loadConfig } from "../packages/core/config.ts";

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    APP_BASE_URL: "http://localhost:3000",
    APP_VERSION: "1.0.2-test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_CLIENT_ID: "paypal-client",
    PAYPAL_CLIENT_SECRET: "paypal-secret",
    PAYPAL_WEBHOOK_ID: "WH-TEST",
    OPENAI_API_KEY: "openai-test-key",
    OPENAI_MODEL: "gpt-6-astra",
    PAYPAL_AI_ENABLED: "true",
    ...overrides,
  });
}

export function minimalPdf(extra = "") {
  // A genuinely parseable single-page PDF: server-side text extraction
  // (pdf.js) must be able to read test fixtures, not just magic bytes.
  const safe = extra.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Chunk text into small Tj shows like real PDF generators: a single giant
  // Tj string does not extract completely under pdf.js.
  const words = (safe || "RoyaltyOS test document.").split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + word).length > 48 && current) {
      chunks.push(current);
      current = "";
    }
    current += word;
  }
  if (current) chunks.push(current);
  const stream = `BT /F1 12 Tf 72 720 Td\n${chunks.map((chunk) => `(${chunk}) Tj`).join("\n")}\nET\n`;
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];
  let pdf = `%PDF-1.7\n`;
  const offsets = objects.map((obj) => {
    const at = pdf.length;
    pdf += obj;
    return at;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Multi-page variant for tests that need substantial extractable text. */
export function minimalPdfPages(pages: string[]) {
  const safe = (text: string) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`,
  ];
  pages.forEach((text, i) => {
    const pageObj = 3 + i * 3;
    const stream = `BT /F1 12 Tf 72 720 Td (${safe(text) || " "}) Tj ET\n`;
    objects.push(`${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageObj + 1} 0 R /Resources << /Font << /F1 ${pageObj + 2} 0 R >> >> >>\nendobj\n`);
    objects.push(`${pageObj + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
    objects.push(`${pageObj + 2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  });
  let pdf = `%PDF-1.7\n`;
  const offsets = objects.map((obj) => {
    const at = pdf.length;
    pdf += obj;
    return at;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
