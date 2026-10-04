#!/usr/bin/env node
/**
 * npm run env:check
 *
 * Reports presence/absence of every configuration key. Values are never printed.
 * This is a reporting command: it always exits 0 once it has produced the report.
 */
import { existsSync } from "node:fs";
import { ENV_FILE, formatEnvTable, loadEnvFile, isConfigured } from "./lib/env.mjs";

const CORE = ["NODE_ENV", "PORT", "APP_BASE_URL", "APP_VERSION"];
const SUPABASE = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"];
const AI = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL"];
const PAYPAL = ["PAYPAL_ENVIRONMENT", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"];
const OPTIONAL = [
  "DATABASE_URL",
  "PAYPAL_CREDENTIALS_KEY",
  "PAYPAL_AI_ENABLED",
  "PAYPAL_MCP_SERVER_URL",
  "MALWARE_SCAN_MODE",
  "CLAMAV_HOST",
  "RESEND_API_KEY",
  "TEST_APP_URL",
  "TEST_USER_EMAIL",
  "TEST_PAYPAL_BUYER_EMAIL",
];

const groups = [
  ["Application", CORE],
  ["Supabase (database/auth/storage)", SUPABASE],
  ["OpenAI (contract intelligence)", AI],
  ["PayPal Sandbox (payments)", PAYPAL],
  ["Optional / external test helpers", OPTIONAL],
];

if (!existsSync(ENV_FILE)) {
  console.log("Missing .env.");
  console.log("Copy .env.example to .env and configure:\n  - Supabase\n  - OpenAI\n  - PayPal Sandbox\n");
}

loadEnvFile();

let missingRequired = 0;
for (const [title, keys] of groups) {
  console.log(`\n${title}`);
  console.log(formatEnvTable(keys));
  if (title !== "Optional / external test helpers") {
    missingRequired += keys.filter((key) => !isConfigured(key)).length;
  }
}

const allKeys = groups.flatMap(([, keys]) => keys);
const configured = allKeys.filter((key) => isConfigured(key)).length;
console.log(`\n${configured}/${allKeys.length} variables present; ${missingRequired} required value(s) missing.`);
console.log("Values are never printed by this command.");
