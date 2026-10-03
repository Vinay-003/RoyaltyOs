#!/usr/bin/env node
import { preflight, missingEnvMessage } from "./lib/env.mjs";

const preflightResult = preflight(["APP_BASE_URL"]);
if (!preflightResult.ok) {
  console.error(missingEnvMessage("npm run test:external", preflightResult.missing, preflightResult.envFileExists));
  process.exit(1);
}

const env = process.env;
const base = (env.TEST_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const paidAi = (env.RUN_PAID_AI_TESTS ?? 'false') === 'true';
const mcpAi = (env.RUN_PAYPAL_MCP_AI_TEST ?? 'false') === 'true';
const results = [];
async function run(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.error(`FAIL ${name} - ${detail}`);
  }
}

await run('Application health (local process)', async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();
  if (!response.ok || body.status !== 'ok') throw new Error(JSON.stringify(body));
  return `v${body.version}`;
});

await run('PayPal provider health (readiness detail)', async () => {
  const response = await fetch(`${base}/api/providers/health`);
  const body = await response.json();
  const paypalOk = body.providers?.paypal?.oauthOk === true;
  if (!response.ok || !paypalOk) throw new Error(JSON.stringify(body));
  return `oauth ok on ${body.providers?.paypal?.environment ?? 'sandbox'}`;
});

await run('Application /insights SPA route', async () => {
  const response = await fetch(`${base}/insights`, { headers: { Accept: 'text/html' } });
  const text = await response.text();
  if (!response.ok || !text.includes('RoyaltyOS')) throw new Error(`status ${response.status}`);
  return 'SPA fallback works';
});

if (paidAi) {
  await run('OpenAI Responses minimal call', async () => {
    const key = env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY missing');
    const model = env.OPENAI_MODEL ?? 'gpt-6-astra';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, input: 'Reply with exactly ROYALTYOS_OK', max_output_tokens: 20 }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text}`);
    const body = JSON.parse(text);
    const output = body.output_text ?? body.output?.flatMap((i) => i.content ?? []).map((c) => c.text ?? '').join('') ?? '';
    if (!String(output).includes('ROYALTYOS_OK')) throw new Error(`unexpected response: ${String(output).slice(0, 200)}`);
    return 'Responses API generation succeeded';
  });
} else {
  console.log('SKIP OpenAI paid generation - set RUN_PAID_AI_TESTS=true to execute');
}

if (mcpAi) {
  await run('OpenAI + PayPal remote MCP read-only call', async () => {
    const key = env.OPENAI_API_KEY;
    const id = env.PAYPAL_CLIENT_ID;
    const secret = env.PAYPAL_CLIENT_SECRET;
    if (!key || !id || !secret) throw new Error('OpenAI/PayPal credentials missing');
    const paypalBase = (env.PAYPAL_ENVIRONMENT ?? 'sandbox') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const oauth = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const oauthBody = await oauth.json();
    if (!oauth.ok || !oauthBody.access_token) throw new Error(`PayPal OAuth ${oauth.status}`);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.PAYPAL_MCP_MODEL ?? env.OPENAI_MODEL ?? 'gpt-6-astra',
        store: false,
        instructions: 'Use only the permitted read-only PayPal tools. Do not mutate any PayPal object.',
        tools: [{
          type: 'mcp',
          server_label: 'paypal-mcp',
          server_url: env.PAYPAL_MCP_SERVER_URL ?? 'https://mcp.sandbox.paypal.com/http',
          authorization: oauthBody.access_token,
          require_approval: 'never',
          allowed_tools: (env.PAYPAL_MCP_ALLOWED_TOOLS ?? 'list_invoices,get_invoice,list_transactions').split(',').map((x) => x.trim()).filter(Boolean),
        }],
        input: 'List at most one recent invoice and summarize its current status. If there are none, say none.',
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text}`);
    return 'remote MCP tool invocation accepted';
  });
} else {
  console.log('SKIP PayPal MCP AI call - set RUN_PAYPAL_MCP_AI_TEST=true to execute');
}

const failures = results.filter((r) => !r.ok);
console.log(`\nExternal provider result: ${results.length - failures.length}/${results.length} executed checks passed`);
if (failures.length) process.exitCode = 1;
