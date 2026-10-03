/**
 * Shared environment loading/reporting for operator scripts.
 *
 * Values are never printed - only presence/absence.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const ENV_FILE = path.resolve(process.cwd(), ".env");

/** Minimal .env parser: KEY=VALUE lines, '#' comments, optional quotes. Real env wins. */
export function readEnvFile(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Loads .env into process.env without overriding variables already set by the shell. */
export function loadEnvFile(file = ENV_FILE) {
  const values = readEnvFile(file);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
  return values;
}

export function isConfigured(key) {
  const value = process.env[key];
  return Boolean(value) && !value.startsWith("YOUR_");
}

/** True when the file exists and every required key has a real (non-placeholder) value. */
export function preflight(keys, file = ENV_FILE) {
  if (!existsSync(file)) return { ok: false, missing: [], envFileExists: false };
  loadEnvFile(file);
  const missing = keys.filter((key) => !isConfigured(key));
  return { ok: missing.length === 0, missing, envFileExists: true };
}

export function formatEnvTable(keys) {
  const width = Math.max(...keys.map((key) => key.length));
  return keys.map((key) => `${key.padEnd(width)} ${isConfigured(key) ? "✅" : "❌"}`).join("\n");
}

export function missingEnvMessage(scriptName, missing, envFileExists) {
  const lines = [
    `${scriptName} was NOT executed.`,
    "",
    envFileExists
      ? `Missing or placeholder values in .env:\n${missing.map((key) => `  - ${key}`).join("\n")}`
      : "Missing .env.\nCopy .env.example to .env and configure:\n  - Supabase\n  - OpenAI\n  - PayPal Sandbox",
    "",
    "Run `npm run env:check` to see presence/absence of every variable (values are never printed).",
    "No provider result is claimed as passed until this script actually runs.",
  ];
  return lines.join("\n");
}
