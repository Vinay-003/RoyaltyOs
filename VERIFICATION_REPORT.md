# RoyaltyOS v1.0.1 Verification Report

Date: 03 October 2026

> Superseded by `reports/release-1.0.1.md` for the v1.0.1 behavioral verification. This file is kept as the release narrative.

## Release status

**Source/build verification: PASS**

**External Supabase/PayPal/OpenAI end-to-end verification in this execution environment: NOT EXECUTED**, because no user provider credentials are present here and this container does not have Docker, `psql`, or Supabase CLI installed. External scripts and a complete manual/agent test procedure are included so those checks can be run against the user's Sandbox/dev services without exposing secrets to this environment.

This distinction is deliberate: no provider integration is marked successful unless it was actually exercised against the provider.

## Automated checks executed here

Command:

```bash
npm run verify
```

Result: **PASS**.

The verification run completed:

- TypeScript typecheck: PASS
- migration static syntax/shape check: PASS for 5 migration files
- Node test suite: **57/57 PASS**
- production TypeScript build: PASS
- web asset copy/build: PASS

### Covered test areas

- hostile contract prompt injection isolation
- amendment/conflict review requirement
- OpenAI PDF request + strict Structured Outputs request shape
- PayPal OAuth/invoice/webhook/retry request behavior using test doubles
- PayPal OAuth token caching
- `/insights` SPA fallback and all documented SPA route fallbacks
- version endpoint
- Supabase server/anon key separation
- cross-workspace IDOR denial and recent step-up ordering
- secure cookie behavior and bearer CLI support
- migration duplicate-payout/revenue locks
- private Storage and distributed rate limiting migration shape
- notification idempotency
- transactional webhook/outbox migration
- PayPal AI mutation rejection + read-only Remote MCP request shape
- PDF magic-byte/EOF/page/size/SHA-256 behavior
- production malware-scanner fail-closed behavior
- v1 reconciliation/financial-integrity migration
- Render private ClamAV/secrets blueprint properties
- browser source secret checks
- RLS/immutability source controls
- largest-remainder and integer-money unit tests
- rule dependency/cycle/overallocation checks
- compiler unresolved-rule rejection and deterministic RuleSet hash
- canonical recoupment example
- caps/floors/fixed/date/priority/gross calculations
- 500 generated financial scenarios asserting conservation/non-negative integer output/determinism

## Demo PDF fixture QA

Created and rendered for visual inspection:

- `fixtures/demo/royaltyos-demo-agreement-v1.pdf` - PASS visual QA
- `fixtures/demo/royaltyos-demo-amendment-v2.pdf` - PASS visual QA

The v1 fixture has a 20% Producer post-recoupment clause; the v2 amendment explicitly supersedes it with 15%, providing a repeatable amendment/conflict test.

## Migration validation level

`npm run db:check` statically checked all migration files, including v1.0 migration `202610030005_royaltyos_v100_release.sql`.

Authoritative PostgreSQL/Supabase execution was not possible in this container because:

```text
psql: not installed
Docker/Podman: not installed
Supabase CLI: not installed
No user's Supabase credentials supplied to this container
```

Required user/agent verification command:

```bash
npm install supabase --save-dev
npx supabase start
npx supabase db reset
```

or against a throwaway hosted dev project:

```bash
npx supabase link --project-ref YOUR_DEV_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
npx supabase migration list
npm run smoke:external
```

## External provider checks still requiring credentials

### Supabase

- execute all migrations on clean Postgres
- confirm private Storage bucket
- exercise Auth signup/login/refresh/step-up
- exercise RPC locks/outbox/audit/ledger integrity against actual database

### OpenAI

- actual contract PDF extraction with `OPENAI_API_KEY`
- actual amendment conflict result on demo fixture pair
- actual PayPal Remote MCP invocation through OpenAI Responses

### PayPal Sandbox

- actual OAuth token
- create/send/pay invoice
- receive genuine signed webhook
- authoritative invoice reconciliation
- automatic revenue/settlement creation
- approve settlement
- execute payout to Sandbox recipients
- receive/reconcile payout batch/item events
- retry a definitive failed item

No mock can substitute for these final provider checks.

## External test scripts included

```bash
npm run smoke:external
```

Checks Supabase migrations/storage, PayPal OAuth/Invoicing read, and OpenAI model access.

```bash
npm run test:external
```

Checks running app health and Insights SPA route.

Optional billable/model/tool checks:

```bash
RUN_PAID_AI_TESTS=true RUN_PAYPAL_MCP_AI_TEST=true npm run test:external
```

## Deployment readiness

Included:

- `render.yaml`: API + worker + private ClamAV
- `Dockerfile`
- `.dockerignore`
- `.env.example`
- Supabase forward migrations
- Render setup guide
- PayPal Sandbox E2E guide
- full local agent prompt

## Known production-stage qualifications

RoyaltyOS v1.0.1 is a comprehensive PayPal Sandbox/hackathon implementation. Before handling real money, complete PayPal production onboarding and an organization-specific security review, use production-grade MFA/dual controls for high-value operations, configure monitoring/alerts/backups, enable secret/SAST/SCA/container scanning in CI and perform external security testing.
