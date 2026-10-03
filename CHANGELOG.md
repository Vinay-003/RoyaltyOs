# RoyaltyOS Changelog

## Unreleased

### Fixed

- AI extraction saved zero rules while reporting success: some gateways accept the `input_file` part, bill its tokens, then silently drop it. PDFs are now parsed server-side (pdf.js per-page text) and sent as `input_text`, which every gateway forwards. `OPENAI_SEND_PDF_FILE=true` additionally attaches the native file for providers proven to forward it (api.openai.com).
- Image-only PDFs fail fast with a scan/OCR message instead of burning tokens; textless priors are skipped with a warning.
- Model beneficiary keys are normalized to `snake_case` with a party-name fallback, so activation compiles against registered recipient keys.
- PayPal Sandbox answers invoice creation with a bare self-link, not the invoice object: the gateway now reads the id off the href.
- Every mutating button shows an inline spinner and ignores double-clicks; route changes paint a loading skeleton first.

## 1.0.2 - 2026-10-03

### Fixed

- Supabase-hosted `function digest(text, unknown) does not exist`: fresh Supabase projects pre-install `pgcrypto` into the `extensions` schema, so migration 001's `create extension if not exists` was a silent no-op and every `search_path=public` function (bootstrap, audit chain) failed on hosted while passing on vanilla PostgreSQL. Migration `202610030007_royaltyos_v102_supabase_compat.sql` relocates `pgcrypto` into `public` when missing, sets `search_path = public, extensions` on every `royaltyos_*` function, and defaults sessions to both schemas (covers `gen_random_uuid()` column defaults over PostgREST).
- Sign-in showed the Display name field: `.field{display:grid}` overrode the `hidden` attribute. A global `[hidden]` rule fixes it; sign-in is email plus password only.
- Register stranded users on a message; it now bootstraps and enters the app directly when Supabase returns a session. Backend `displayName` falls back to the email local-part.
- Mutation guard only accepted `APP_BASE_URL`: `CORS_ORIGINS` (comma-separated) is now an additional allowlist so a custom domain and the Render default URL both work.

### Added

- `OPENAI_BASE_URL` override for OpenAI-compatible gateways (config, contract extraction, PayPal MCP assistant, external scripts).
- `npm run start:free` (`scripts/start-free.mjs`): API plus outbox worker in one Render free-tier process group.
- Free-tier Render blueprint (`render.yaml`); paid api/worker/ClamAV layout preserved in `render.paid.yaml`.

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
