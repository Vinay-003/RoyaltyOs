import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../../packages/core/config.ts";
import { testConfig } from "../helpers.ts";

const release = readFileSync("supabase/migrations/202610030005_royaltyos_v100_release.sql", "utf8");
const render = readFileSync("render.yaml", "utf8");
const renderPaid = readFileSync("render.paid.yaml", "utf8");
const envExample = readFileSync(".env.example", "utf8");

test("v1.0 release migration tracks reconciliation issues and financial integrity", () => {
  assert.match(release, /insert into app_versions[\s\S]*'1\.0\.0'/i);
  assert.match(release, /create table if not exists reconciliation_issues/i);
  assert.match(release, /royaltyos_financial_integrity/i);
  assert.match(release, /ledgerMismatchCount/i);
  assert.match(release, /settlementMismatchCount/i);
  assert.match(release, /dedupe_key/i);
});

test("Render free blueprint keeps secrets external and stays fail-open-safe without ClamAV", () => {
  assert.match(render, /plan:\s*free/i);
  assert.match(render, /startCommand:\s*npm run start:free/i);
  assert.match(render, /NODE_ENV[\s\S]*staging/i);
  assert.match(render, /MALWARE_SCAN_MODE[\s\S]*disabled/i);
  assert.match(render, /PAYPAL_CLIENT_SECRET[\s\S]*sync:\s*false/i);
  assert.equal(render.includes("YOUR_PAYPAL"), false);
  assert.equal(/type:\s*pserv/i.test(render), false, "free tier has no private services");
});

test("Render paid blueprint provisions a private ClamAV service", () => {
  assert.match(renderPaid, /type:\s*pserv[\s\S]*royaltyos-clamav/i);
  assert.match(renderPaid, /docker\.io\/clamav\/clamav:stable/i);
  assert.match(renderPaid, /MALWARE_SCAN_MODE[\s\S]*clamav/i);
  assert.match(renderPaid, /PAYPAL_CLIENT_SECRET[\s\S]*sync:\s*false/i);
  assert.equal(renderPaid.includes("YOUR_PAYPAL"), false);
});

test("PayPal remote MCP defaults to Streamable HTTP and is read-only", () => {
  const config = testConfig({ PAYPAL_MCP_SERVER_URL: "https://mcp.sandbox.paypal.com/http" });
  assert.equal(config.paypalAi.serverUrl, "https://mcp.sandbox.paypal.com/http");
  assert.deepEqual(config.paypalAi.allowedTools, ["list_invoices", "get_invoice", "list_transactions"]);
  assert.match(envExample, /PAYPAL_MCP_SERVER_URL=https:\/\/mcp\.sandbox\.paypal\.com\/http/);
});

test("production config does not silently change security defaults", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    PAYPAL_CLIENT_ID: "client",
    PAYPAL_CLIENT_SECRET: "secret",
    PAYPAL_WEBHOOK_ID: "WH-1",
    OPENAI_API_KEY: "openai",
  });
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.security.malwareScanMode, "disabled");
  assert.equal(config.paypal.environment, "sandbox");
  assert.equal(config.paypalAi.serverUrl, "https://mcp.sandbox.paypal.com/http");
});
