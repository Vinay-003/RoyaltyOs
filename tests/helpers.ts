import { loadConfig } from "../packages/core/config.ts";

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3000",
    APP_BASE_URL: "http://localhost:3000",
    APP_VERSION: "1.0.1-test",
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
  const content = `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n${extra}\n%%EOF\n`;
  return new TextEncoder().encode(content);
}
