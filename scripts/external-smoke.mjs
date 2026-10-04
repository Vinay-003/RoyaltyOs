#!/usr/bin/env node
import { preflight, missingEnvMessage } from "./lib/env.mjs";

const preflightResult = preflight([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "OPENAI_API_KEY",
]);
if (!preflightResult.ok) {
  console.error(missingEnvMessage("npm run smoke:external", preflightResult.missing, preflightResult.envFileExists));
  process.exit(1);
}

const env = process.env;
const checks = [];
function required(name) {
  const value = env[name];
  if (!value || value.startsWith('YOUR_')) throw new Error(`Missing ${name}`);
  return value;
}
async function run(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    console.error(`FAIL ${name} - ${checks.at(-1).detail}`);
  }
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const paypalBase = (env.PAYPAL_ENVIRONMENT ?? 'sandbox') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
let paypalToken = '';

await run('Supabase REST + migrations', async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/app_versions?select=version,applied_at,notes&order=applied_at.desc&limit=20`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || !rows.some((row) => row.version === (env.APP_VERSION ?? '1.0.2'))) {
    throw new Error(`APP_VERSION ${env.APP_VERSION ?? '1.0.2'} not found in app_versions; run Supabase migrations first`);
  }
  return `${rows.length} app version record(s)`;
});

await run('Supabase private contract bucket', async () => {
  const bucket = env.SUPABASE_STORAGE_BUCKET ?? 'royaltyos-contracts';
  const response = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  const body = JSON.parse(text);
  if (body.public === true) throw new Error('contract bucket is public');
  return `${bucket} is private`;
});

await run('PayPal OAuth', async () => {
  const id = required('PAYPAL_CLIENT_ID');
  const secret = required('PAYPAL_CLIENT_SECRET');
  const response = await fetch(`${paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  const body = JSON.parse(text);
  if (!body.access_token) throw new Error('PayPal returned no access token');
  paypalToken = body.access_token;
  return `OAuth OK (${env.PAYPAL_ENVIRONMENT ?? 'sandbox'})`;
});

await run('PayPal Invoicing API read', async () => {
  if (!paypalToken) throw new Error('PayPal OAuth did not succeed');
  const response = await fetch(`${paypalBase}/v2/invoicing/invoices?page=1&page_size=1&total_required=true`, {
    headers: { Authorization: `Bearer ${paypalToken}`, Accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return 'invoicing API reachable';
});

// All configured OpenAI keys (primary plus fallbacks) for key rotation.
function openaiKeys() {
  return ['OPENAI_API_KEY', 'OPENAI_API_KEY_FALLBACK_1', 'OPENAI_API_KEY_FALLBACK_2']
    .map((name) => env[name])
    .filter((key) => typeof key === 'string' && key && !key.startsWith('YOUR_'));
}

await run('OpenAI API/model access', async () => {
  const keys = openaiKeys();
  if (!keys.length) throw new Error('Missing OPENAI_API_KEY');
  const model = env.OPENAI_MODEL ?? 'gpt-6-astra';
  const baseUrl = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  // Portable across OpenAI and OpenAI-compatible gateways (some gateways only
  // implement the list endpoint, not per-model GET). A 401/402/429 rotates to
  // the next configured key. Note the list endpoint may stay 200 on
  // quota-exhausted keys; generation endpoints enforce quota.
  let text = '';
  let status = 0;
  for (const key of keys) {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    text = await response.text();
    status = response.status;
    if (status !== 401 && status !== 402 && status !== 429) break;
  }
  if (status < 200 || status >= 300) throw new Error(`${status} ${text}`);
  try {
    const ids = (JSON.parse(text).data ?? []).map((entry) => entry.id).filter(Boolean);
    if (ids.length && !ids.includes(model)) throw new Error(`model ${model} not listed (${ids.length} models available)`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`model ${model} not listed`)) throw error;
  }
  return `model accessible: ${model}`;
});

const failed = checks.filter((c) => !c.ok);
console.log(`\nExternal smoke result: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exitCode = 1;
