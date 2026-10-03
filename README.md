# RoyaltyOS v1.0.2

RoyaltyOS is contract-to-revenue infrastructure for collaborative work. It turns PDF agreements into human-reviewed, versioned financial rules, reconciles PayPal Sandbox revenue, calculates deterministic settlements, requires finance approval, sends idempotent PayPal payouts, and preserves explainable royalty statements, ledger records, reconciliation issues, and audit history.

The hard boundary is intentional:

**AI interprets contracts. Deterministic software calculates money. Humans authorize high-impact actions. PayPal moves the money.**

## What is implemented

- Supabase Auth with HttpOnly cookie sessions, refresh, logout, session revocation, workspace RBAC and password step-up.
- Workspace/project bootstrap, members, roles and contributor scoping.
- Immutable contract versions in a private Supabase Storage bucket.
- PDF magic-byte/EOF/size/page validation, SHA-256 hashing and production fail-closed ClamAV scanning.
- OpenAI Responses API contract intelligence using native PDF inputs and strict JSON-schema Structured Outputs.
- Amendment-aware extraction: up to three prior contract versions are supplied to the model to surface contradictions and superseding terms.
- Human review/edit/approve/reject of candidate rules. Unsupported or conflicting rules remain review-required.
- Restricted executable rule model and immutable, hashed RuleSet versions.
- Rule graph and source-evidence traceability.
- Non-posting what-if simulations.
- Fixed-precision deterministic settlement engine with percentages, fixed amounts, exclusions, recoupment, categories, gross/net/remainder bases, caps, floors, thresholds, date gates, priority modifiers and deterministic largest-remainder allocation.
- Recoupment accounting and exact money-conservation invariants.
- Double-entry-style shadow ledger plus integrity RPC.
- PayPal Sandbox invoice create/send/get, verified webhooks, authoritative invoice reconciliation and revenue recognition.
- Finance approval gate with recent password verification.
- Idempotent PayPal payout batches, item-level status, webhook/poll reconciliation and failed-item retries.
- Contributor royalty statements with clause -> rule -> revenue -> payout trace.
- Durable transactional outbox worker and optional email notifications.
- Tamper-evident chained audit log and reconciliation-issue tracking.
- CSV settlement export.
- Data-backed Insights route at `/insights`.
- Read-only PayPal AI assistant using the **official PayPal Remote MCP server** through OpenAI Responses API.
- Render Blueprint for web API + worker + private ClamAV service.

## Technology

| Layer | Implementation |
|---|---|
| Web | Server-served responsive SPA (HTML/CSS/JS) |
| API | Node.js 22 + TypeScript modular monolith |
| Database/Auth/Storage | Supabase PostgreSQL + Auth + private Storage |
| Background workflows | Node worker polling transactional Postgres outbox |
| Contract AI provider | OpenAI Responses API, default `gpt-6-astra` |
| PayPal payments | PayPal REST APIs: OAuth, Invoicing, Payouts, Webhooks |
| PayPal AI integration | Official PayPal Remote MCP, restricted to read-only tools, called from OpenAI Responses API |
| Malware scanning | ClamAV in production |
| Optional email | Resend |
| Deployment target | Render web service + worker + private ClamAV; Supabase remains managed state/storage |

## PayPal AI / SDK answer

RoyaltyOS deliberately uses **two PayPal integration boundaries**:

1. **Money movement:** direct PayPal REST APIs behind `packages/paypal/gateway.ts`. There is no browser-side or LLM-controlled payment SDK. This is where invoice creation, invoice sending, payout execution, payout lookup and webhook-signature verification occur.
2. **AI experience:** PayPal's **official Remote MCP server** (`https://mcp.sandbox.paypal.com/http`) through the OpenAI Responses API. RoyaltyOS restricts it to `list_invoices`, `get_invoice`, and `list_transactions` and blocks mutation prompts before any model/tool call.

This keeps PayPal AI central to the product while preserving the architecture invariant that an LLM cannot move money.

## AI provider

The current contract-intelligence implementation uses **OpenAI**. `packages/ai/openai-contract.ts` sends PDFs to the OpenAI Responses API and requests strict Structured Outputs. The default model is configurable with `OPENAI_MODEL` and currently defaults to `gpt-6-astra`. The provider is not embedded in the financial engine; approved structured rules are compiled before deterministic calculations happen.

## Quick local setup

Prerequisites:

- Node.js 22+
- Docker-compatible runtime if you want the full local Supabase stack
- Supabase CLI
- PayPal Developer Sandbox app and webhook
- OpenAI API key

```bash
cp .env.example .env
npm install
npm run verify
```

For a local Supabase stack, install the CLI into the project if needed:

```bash
npm install supabase --save-dev
npx supabase start
npx supabase db reset
```

For a hosted Supabase project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Copy the displayed Supabase URL/keys into `.env`, then add your PayPal and OpenAI values.

Start both application processes:

```bash
npm run dev
# second terminal
npm run dev:worker
```

Open `http://localhost:3000`.

## PayPal webhook URL

Local PayPal cannot call localhost directly. For a deployed Render environment use:

```text
https://YOUR_RENDER_DOMAIN/api/v1/webhooks/paypal
```

Register that URL under your PayPal Sandbox REST app, subscribe to the invoice and payout events listed in `docs/PAYPAL_SANDBOX_E2E.md`, then place the generated Webhook ID in `PAYPAL_WEBHOOK_ID`.

## Verification commands

```bash
npm run typecheck
npm run db:check
npm run test:unit
npm run test:integration
npm test
npm run build
npm run verify
```

With real credentials and a migrated Supabase project:

```bash
npm run smoke:external
```

With the API/worker running:

```bash
npm run test:external
```

Paid/model-producing checks are opt-in:

```bash
RUN_PAID_AI_TESTS=true RUN_PAYPAL_MCP_AI_TEST=true npm run test:external
```

## Demo fixtures

Use these in order to demonstrate amendment conflict handling:

1. `fixtures/demo/royaltyos-demo-agreement-v1.pdf`
2. `fixtures/demo/royaltyos-demo-amendment-v2.pdf`

The amendment changes Producer's post-recoupment share from 20% to 15%, which should be surfaced for human review before activation.

## Documentation

- `docs/LOCAL_SETUP.md`
- `docs/SUPABASE_SETUP.md`
- `docs/PAYPAL_SANDBOX_E2E.md`
- `docs/RENDER_DEPLOYMENT.md`
- `docs/USER_FLOW.md`
- `docs/TESTING.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE_CROSSCHECK.md`
- `docs/reference/RoyaltyOS_Project_Record_System_Architecture_v0.1.docx` - canonical user-supplied architecture source
- `docs/VERSIONING.md`
- `docs/PROVIDER_CHOICES.md`
- `docs/MANUAL_TEST_CHECKLIST.md`
- `docs/OBSERVABILITY.md`
- `docs/INCIDENT_RESPONSE.md`
- `AGENT_PROMPT.md`
- `FINAL_REPORT.md`
- `VERIFICATION_REPORT.md`

## Version

Current release: **1.0.2**. See `VERSION` and `CHANGELOG.md`.
