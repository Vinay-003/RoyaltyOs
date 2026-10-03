# RoyaltyOS Changelog

## 1.0.1 - 2026-10-03

### Fixed

- P0 payout idempotency: single canonical `payout:<workspaceId>:<settlementId>:v<n>` key helper (`packages/paypal/idempotency.ts`); execute and retry share it and derive the PayPal `requestId` from the database-returned batch version, so repeats and concurrent calls replay the same idempotent request.
- Database-enforced payout safety (`202610030006_royaltyos_v101_hardening.sql`): one payout item per settlement line per batch, single `royaltyos_mark_payout_submitted` signature, `FOR UPDATE` settlement locking, exact-key batch reuse, cross-settlement key rejection, retry only from `PARTIAL_FAILURE` / `RECONCILIATION_REQUIRED` with `FAILED / RETURNED / BLOCKED / CANCELED` lines only and never resending `SUCCESS` items.
- Frontend legacy audit crash: hash-less (pre-chain) events no longer throw on `event_hash.slice`; Audit and Insights pages render verified vs legacy counts separately.

### Added

- Real PostgreSQL behavioral test harness (`npm run test:db`, 39 tests): fresh + upgrade databases, Supabase-compatible role stubs, no Docker required.
- New `npm run test:security` command (secret scan + unit red-team + DB security subset).
- Release tooling: `npm run release:report` (`reports/release-<version>.md`) and `npm run release:checksums` (`reports/SHA256SUMS-<version>.txt`).
- Legacy audit classification: `royaltyos_verify_audit_chain` returns `{valid, verifiedEvents, legacyEvents}` with a genesis boundary; post-genesis hash-less rows fail as `missing chain link`.

### Changed

- All migrations wrapped in `begin;` / `commit;`; Supabase-role revokes no longer assume roles exist; `royaltyos_*` RPC execution revoked from PUBLIC/anon/authenticated and granted to `service_role` only.
- Health endpoint split: `/api/health` is liveness only, plus `/api/readiness` and `/api/providers/health`.
- API router split (`apps/api/router.ts` 762 lines to 47-line dispatcher + `apps/api/routes/*`); frontend split (`apps/web/public/app.js` bootstrap + `apps/web/public/js/*` modules).
- Operator `.env` UX: `npm run env:check` reports presence only (never values); external scripts fail closed with a helpful missing-env message.
- Static regex tests that duplicated behavioral coverage removed in favour of the DB harness; secret-scan and payout-key-shape static checks retained.
- Version bumped to 1.0.1 everywhere (`VERSION`, `package.json`, `APP_VERSION` defaults, `render.yaml`, `.env.example`, docs).

## 1.0.0 - 2026-10-03

### Release hardening

- Added GitHub Actions verification, Gitleaks secret scanning and CodeQL workflow.
- Added local committed-secret scanner to `npm run verify`.
- Added cross-workspace authorization/step-up tests and full SPA route regression coverage.
- Added final operator docs: provider choices, observability, incident response and manual acceptance checklist.


Hackathon-complete portable release aligned to the RoyaltyOS architecture baseline v0.1.

### Added

- Supabase Auth, workspace/project bootstrap, RBAC, session revocation and password step-up.
- Immutable/versioned contract PDFs in private Supabase Storage with SHA-256 metadata.
- PDF structure/size/page validation plus production fail-closed ClamAV scanning.
- OpenAI Responses API contract intelligence with PDF input, strict Structured Outputs, evidence metadata and prior-version amendment/conflict context.
- Human candidate-rule editing/approval/rejection, graph validation and immutable hashed RuleSet activation.
- Deterministic fixed-precision settlement engine with percentage/fixed/exclusion/recoupment/category/cap/floor/threshold/date/priority primitives.
- Deterministic largest-remainder rounding and property/invariant tests.
- Recoupment accounts and canonical $10,000 VIDEO demo scenario.
- PayPal REST gateway for OAuth, Invoicing, Payouts, authoritative resource reads and webhook-signature verification.
- Verified/deduplicated PayPal webhook ingestion + transactional Postgres outbox worker.
- Authoritative invoice reconciliation before revenue recognition; post-revenue refund/cancellation mismatch tracking.
- Finance approval gate, frozen payout destination snapshots, idempotent payout reservation and failed-item retry versions.
- Recipient-level payout reconciliation and shadow ledger updates.
- Double-entry-style ledger integrity verification.
- Tamper-evident audit hash chain.
- Contributor royalty statements, CSV exports, notifications, Team/RBAC UI, Recipients UI, Payouts, Settlements, Rule Graph, Simulator, Audit and working Insights route.
- Read-only PayPal AI assistant using official PayPal Remote MCP through OpenAI Responses API.
- Reconciliation issues and aggregate financial-integrity RPC.
- External provider smoke/test scripts.
- Render Blueprint with API, worker and private ClamAV service.
- Synthetic PDF fixtures for original agreement/amendment conflict testing.
- Complete setup/deployment/testing/security/user-flow/cross-check documentation and local setup agent prompt.

### Changed

- Application version finalized at 1.0.0.
- PayPal Remote MCP default moved to Streamable HTTP endpoint `/http`.
- OpenAI Remote MCP authorization uses the Responses API `authorization` field.

## 0.5.0 - 2026-10-03

- Transactional verified webhook ingestion/outbox.
- Atomic payout reconciliation enqueue.
- Workspace-scoped webhook metrics and secure-cookie hardening.

## 0.4.0 - 2026-10-03

- Private Supabase Storage provisioning.
- Distributed PostgreSQL rate limiting.
- Notification delivery metadata/idempotency.
- Amendment-aware AI extraction and initial Render deployment configuration.

## 0.3.0 - 2026-10-03

- Additional immutable-state guards and financial hardening.

## 0.2.0 - 2026-10-03

- First portable TypeScript/Supabase implementation aligned to architecture baseline v0.1.
