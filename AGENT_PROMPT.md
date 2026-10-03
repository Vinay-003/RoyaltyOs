# RoyaltyOS Complete Local Setup + Verification Agent Prompt

Copy everything below into a capable coding agent running in the repository root.

---

You are the release engineer for RoyaltyOS v1.0.1. Your job is to get this repository running locally against Supabase and PayPal Sandbox, test it comprehensively, and prepare it for Render. Do not redesign the product or weaken financial/security boundaries. Do not use production PayPal credentials or real money.

## Canonical architecture rules

1. AI interprets contracts; deterministic code calculates money.
2. The contract LLM must never receive PayPal credentials or payment mutation tools.
3. LLM output must never be eval'd/executed. It compiles through the restricted rule model after human review.
4. Active RuleSets and historical settlements are immutable/versioned.
5. Every payout must come from an approved frozen settlement.
6. Verify/dedupe PayPal webhooks and fetch authoritative PayPal resources before recognizing financial state.
7. Money uses integer minor units/basis points; every settlement must reconcile exactly.
8. Sensitive financial actions require server-side RBAC + recent step-up + audit.
9. Contract files are untrusted and private.
10. Never log or print secrets/tokens.

## Stack

- Node.js 22 + TypeScript
- Supabase PostgreSQL/Auth/private Storage
- OpenAI Responses API for contract PDF intelligence
- PayPal REST APIs for OAuth/Invoicing/Payouts/Webhooks
- Official PayPal Remote MCP through OpenAI Responses for read-only PayPal AI questions
- Node background worker polling Postgres transactional outbox
- ClamAV for production upload scanning
- Optional Resend email
- Render target: web API + background worker + private ClamAV

## Step 1 - inspect and protect secrets

- Confirm `.env` is gitignored.
- Create `.env` from `.env.example` only if missing.
- Never paste secret values into code, logs, docs or test snapshots.
- Confirm no service-role/PayPal/OpenAI secret occurs in `apps/web/public`.

## Step 2 - install and verify static code

```bash
node --version
npm install
npm run typecheck
npm run db:check
npm test
npm run build
```

Stop and fix failures before proceeding. Do not skip financial invariant tests.

## Step 3 - provision Supabase locally OR use a throwaway hosted dev project

Preferred local path:

```bash
npm install supabase --save-dev
npx supabase start
npx supabase db reset
```

If using hosted dev:

```bash
npx supabase login
npx supabase link --project-ref <DEV_PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
npx supabase migration list
```

Do not modify the remote database manually in the Dashboard after using migrations.

Verify:

- migrations 001 through 005 applied
- `app_versions` includes `1.0.1` (with the `1.0.0` baseline record retained)
- `royaltyos-contracts` Storage bucket exists and `public=false`
- RLS is enabled on tenant/domain tables
- financial RPCs exist

Fill `.env` with the appropriate Supabase values.

## Step 4 - PayPal Sandbox setup

Use a Sandbox Business REST app. Set:

```text
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

Start the API temporarily to obtain a public host later; locally, provider OAuth can still be tested.

Run:

```bash
npm run smoke:external
```

It must prove PayPal OAuth and Invoicing API read access.

For webhook E2E, deploy Render or use a trusted HTTPS tunnel and register:

```text
https://<public-host>/api/v1/webhooks/paypal
```

Subscribe to invoice created/updated/paid/cancelled/refunded and payout batch/item processing/success/failure/return/refund/hold events. Put the generated ID in `PAYPAL_WEBHOOK_ID`.

## Step 5 - OpenAI setup

Set:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-astra
```

Run:

```bash
RUN_PAID_AI_TESTS=true npm run test:external
```

Then use the synthetic demo PDFs to verify actual contract extraction.

## Step 6 - start RoyaltyOS

Terminal A:

```bash
npm run dev
```

Terminal B:

```bash
npm run dev:worker
```

Check:

```bash
curl http://localhost:3000/api/version
curl http://localhost:3000/api/health
curl -I http://localhost:3000/insights
```

`/insights` must return the SPA, not a 404.

## Step 7 - execute full application user flow

1. Register owner account.
2. Confirm workspace/project bootstrap.
3. Create beneficiaries: artist, producer, manager, featured_creator with PayPal Sandbox recipient emails.
4. Create contract.
5. Upload `fixtures/demo/royaltyos-demo-agreement-v1.pdf`.
6. Analyze with AI.
7. Inspect source page/clause evidence. Resolve/approve every rule and activate RuleSet.
8. Upload v2 amendment fixture. Analyze. Confirm post-recoupment Producer conflict (20% prior vs 15% amendment) is visible and human review is required.
9. Resolve amendment to 15% and activate new RuleSet.
10. Run VIDEO `$10,000.00` simulation. Confirm money conservation and the expected recoupment scenario.
11. Create a small Sandbox invoice first, send, pay with Sandbox buyer.
12. Verify PayPal webhook signature/dedupe and worker authoritative reconciliation.
13. Confirm exactly one revenue event and one settlement for the invoice.
14. Verify settlement line sum equals distributable amount and ledger integrity RPC reports valid.
15. Finance user step-up and approve settlement.
16. Execute payout.
17. Confirm exactly one payout version is reserved/submitted despite repeated clicks.
18. Reconcile item states through real PayPal webhook/poll.
19. Verify Royalties statement traces to contract/rule/revenue/payout.
20. Verify Audit hash chain and Insights financial integrity are valid.
21. Export settlement CSV.

## Step 8 - adversarial / chaos tests

Execute and record results:

- replay same webhook ID twice -> one business effect
- fake webhook signature -> reject
- concurrent payout execute requests -> no duplicate reservation/payment
- worker restart with pending outbox -> event eventually resumes
- PayPal 429/500 mocked tests -> bounded retry only where safe/idempotent
- payout item failure -> retry creates next payout version and excludes SUCCESS items
- payout recipient changed after settlement approval -> old settlement snapshot unchanged
- refund/cancel after recognized revenue -> reconciliation issue opened, immutable history not rewritten
- contract prompt injection -> no payment tool/credential exposure
- invalid/non-PDF/truncated/oversized file -> reject
- production upload with no ClamAV -> fail closed
- cross-workspace IDs -> 403/404 without data disclosure

## Step 9 - PayPal AI sponsor integration

Set `PAYPAL_AI_ENABLED=true` and use:

```text
PAYPAL_MCP_SERVER_URL=https://mcp.sandbox.paypal.com/http
PAYPAL_MCP_ALLOWED_TOOLS=list_invoices,get_invoice,list_transactions
```

Run:

```bash
RUN_PAYPAL_MCP_AI_TEST=true npm run test:external
```

Confirm the request uses OpenAI Responses API `type: "mcp"`, PayPal Remote MCP URL, OAuth token in `authorization`, `allowed_tools`, and `require_approval: "never"`. Attempt `Create and send a payout`; RoyaltyOS must reject before any model/MCP call.

## Step 10 - Render readiness

Review `render.yaml`:

- web service `/api/health`
- background worker
- private ClamAV service
- secrets are `sync:false`
- `APP_BASE_URL` matches final public service

Apply DB migrations separately before deploy. Do not make both API and worker race migrations.

Deploy, register final PayPal webhook URL, update Webhook ID, then repeat the PayPal E2E test on Render.

## Step 11 - final release evidence

Run and capture:

```bash
npm run verify
npm run smoke:external
RUN_PAID_AI_TESTS=true RUN_PAYPAL_MCP_AI_TEST=true npm run test:external
```

Also record:

- `npx supabase migration list`
- result of audit integrity endpoint/UI
- result of financial integrity RPC/Insights
- one real Sandbox invoice ID
- one verified webhook event ID
- one resulting revenue event/settlement ID
- one Sandbox payout batch ID and item statuses

Update `VERIFICATION_REPORT.md` with exact PASS/FAIL/SKIP reasons. Never mark provider tests PASS unless they were actually executed.

## Final acceptance criteria

Release is acceptable only if:

- `npm run verify` passes
- all five migrations execute on a clean Supabase DB
- no code secret scan issue
- contract fixture flow works with real OpenAI
- real PayPal Sandbox OAuth/invoice/webhook/revenue/payout flow works
- no duplicate payout under replay/concurrency test
- audit and ledger/settlement integrity are clean
- `/insights` opens and displays system-of-record metrics
- final docs reflect the actual code/provider choices

Do not silently change architecture or replace PayPal/OpenAI with mocks for final E2E evidence. Mocks are allowed only for unit/integration tests.

---
