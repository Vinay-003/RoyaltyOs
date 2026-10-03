# RoyaltyOS v1.0.1 — Session Compaction / Handoff

_Generated: 2026-10-03. This document is the authoritative handoff for the next session._
_It records what was attempted, what is verified, what is unverified, and exactly what remains._

---

## 0. How to read this document

**Rule that governs everything below:** nothing is marked ✅ unless the command was actually
executed in this workspace and its output was observed. Anything not executed is marked ⏳
(pending) or ⚠️ (cannot be executed without operator credentials).

The repository is a **pre-release**. It must not be described as production-ready.

---

## 1. The objective

Take over the RoyaltyOS codebase as a pre-release and deliver a hardened **v1.0.1**:

1. **P0 release blocker:** fix the duplicate-payout / payout-reservation idempotency defect.
2. Add a **real PostgreSQL behavioral test harness** (`npm run test:db`) — replacing regex-over-source tests.
3. Add a working **`npm run test:security`** command (it did not exist).
4. Harden migrations (transaction wrapping, no Supabase-role assumptions).
5. Classify **legacy audit events** separately from cryptographically chained ones.
6. Improve `.env` operator UX (fail helpfully, never print secret values).
7. Split the two monoliths: `apps/api/router.ts` and `apps/web/public/app.js`.
8. Remove/replace static regex tests that duplicate behavioral concerns.
9. Bump version to 1.0.1 everywhere and update docs/reports.
10. Run the **entire** verification suite from a clean install.
11. Produce one authoritative final verification report.
12. **Git:** separate commits per task, ~2 hours apart, then `git branch -M main`, add remote
    `https://github.com/Vinay-003/RoyaltyOs.git`, `git push -u origin main`.
13. Answer operator questions (stack, Supabase timing, PayPal SDK/credentials).

**Highest-priority invariant:** no path may be able to cause a duplicate payout.

---

## 2. The project — what it is and what it uses

**RoyaltyOS** is contract-to-revenue infrastructure for collaborative work. It turns PDF
agreements into human-reviewed, versioned financial rules, reconciles PayPal revenue,
calculates deterministic settlements, requires finance approval, sends idempotent PayPal
payouts, and preserves explainable royalty statements, ledger records, reconciliation
issues and audit history.

### Trust boundary (must never be weakened)

```
Contract/PDF (untrusted)
  → AI interpretation (candidate rules + evidence only)
  → human review
  → immutable approved RuleSet
  → deterministic TypeScript finance engine (integer minor units)
  → settlement
  → human finance approval
  → PayPal execution
  → webhook verification + reconciliation
  → royalty statement / audit / insights
```

Hard rules: AI never calculates final payable amounts, never executes payouts, never
receives PayPal credentials. Webhook payloads are untrusted until signature verification
succeeds. Approved RuleSets and settlement lines are immutable. Payout execution is
idempotent and retry never resends SUCCESS items. Server-side authorization is
authoritative; no financial mutation depends on frontend state.

### Stack and providers

| Concern | What is used | Notes |
| --- | --- | --- |
| Runtime | **Node.js 22+** (`engines: >=22`), TypeScript 5.8.3, ESM, `--experimental-strip-types` | Local dev machine runs Node **v24.14.1** |
| Architecture | TypeScript **modular monolith**, **zero runtime dependencies** | devDeps only: `typescript`, `pg`, `@types/pg` |
| **Database / Auth / Storage** | **Supabase** (hosted PostgreSQL + Auth + private Storage bucket) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| AI (contract intelligence) | **OpenAI Responses API** with PDF input + strict Structured Outputs | `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-6-astra`) |
| **Payments** | **PayPal REST APIs** (OAuth 2, Invoicing, Payouts, Webhook verification) | raw `fetch` in `packages/paypal/gateway.ts` — **no PayPal SDK is installed or needed** |
| PayPal AI | **PayPal official Remote MCP Server** driven through the OpenAI Responses API | read-only tools only; `packages/paypal-ai/mcp-assistant.ts` |
| Deployment | **Render** Blueprint (`render.yaml`) | `royaltyos-api` (web), `royaltyos-worker` (worker), `royaltyos-clamav` (private service) |
| Email (optional) | Resend | `NOTIFICATION_PROVIDER=resend`; disabled mode records SKIPPED deliveries |
| Antivirus (prod) | ClamAV sidecar | `MALWARE_SCAN_MODE=clamav` fail-closed in production |

### Where Supabase connects (operator question 3)

Supabase is the **system of record from the very first request**. The connection points are:

1. **Schema** — `supabase/migrations/*.sql` are applied to the Supabase Postgres database
   (`npm run db:push` with the Supabase CLI, or `psql "$DATABASE_URL"`).
2. **Runtime** — `packages/supabase/client.ts` + `repository.ts` use the project URL and the
   anon key for user-scoped calls; the **service-role key stays server-side only**.
3. **Auth** — `royaltyos_access` / `royaltyos_refresh` HttpOnly cookies are issued after
   Supabase Auth sign-in; RLS plus server-side role checks gate every read/write.
4. **Storage** — contract PDFs go to the **private** `royaltyos-contracts` bucket via signed
   URLs; the browser never receives provider secrets.

So: **migrations first, then env vars, then the app boots against it.** Until `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exist, the API cannot serve authenticated
requests — but everything except live provider calls is testable locally (see §6).

### Credentials required for real end-to-end acceptance (none present today)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`.
PayPal webhooks additionally require a **public HTTPS URL** (Render, or a tunnel such as
ngrok/cloudflared). `http://localhost:3000` cannot receive PayPal webhook deliveries. The
webhook endpoint is `POST https://<host>/api/v1/webhooks/paypal`.

**No PayPal REST SDK is required.** The gateway speaks the REST API directly over `fetch`.
Only PayPal *Sandbox* accounts (business + personal test buyers) are needed, plus a webhook
registered in the PayPal developer dashboard to obtain `PAYPAL_WEBHOOK_ID`.

---

## 3. What is DONE and VERIFIED

### 3.1 P0 — payout idempotency / duplicate-payout defect ✅

**The original bug (from the audit):**
- `execute` built `payout:<workspaceId>:<settlementId>:v<n>`
- `retry` built `payout:<settlementId>:v<n>`
- `royaltyos_reserve_payout` minted a **new full-value batch** whenever it was handed a fresh
  key, so retry could re-reserve recipients that had already succeeded.

**The fix — one canonical key helper:** `packages/paypal/idempotency.ts`
```ts
export function buildPayoutIdempotencyKey({ workspaceId, settlementId, version }) {
  return `payout:${workspaceId}:${settlementId}:v${version}`;
}
export function isCanonicalPayoutIdempotencyKey(key: string): boolean { /* regex */ }
```
Verified by grep: the only manual `payout:` strings left in the codebase are **inside the
database tests that deliberately exercise rejected non-canonical keys**. Both execute and
retry in `apps/api/routes/finance.ts` call the helper, and the PayPal `requestId` is derived
from the batch the database actually returned (`Number(batch.payout_version)`), so a repeat or
concurrent call replays the same PayPal idempotent request.

**Database-level enforcement** (`supabase/migrations/202610030006_royaltyos_v101_hardening.sql`):
- `begin; … commit;` wrapped (a failure can never half-apply).
- `uniq_payout_item_line_per_batch` — one payout item per settlement line per batch.
- Dropped the ambiguous `royaltyos_mark_payout_submitted(uuid,text)` overload; exactly one
  signature remains (the defaulted three-argument one). Two candidates made a 2-arg call
  ambiguous for psql *and* PostgREST, which could leave a submitted payout unmarked.
- Rewrote `royaltyos_reserve_payout`: locks the settlement row `FOR UPDATE` (serializes
  concurrent execute/retry), reuses an exact-key batch for this settlement, rejects a key
  owned by another settlement, and if **any** batch already exists it returns it when
  sendable/finished — otherwise it raises `settlement payout requires retry reservation`.
  A brand-new batch may only be created when no batch exists at all, version always 1, and
  only with the canonical key. Only payable lines without any SUCCESS item are reserved.
- Rewrote `royaltyos_reserve_payout_retry`: only from `PARTIAL_FAILURE` /
  `RECONCILIATION_REQUIRED`, reuses an existing next-version batch, copies **only**
  `FAILED / RETURNED / BLOCKED / CANCELED` lines from the latest batch, and excludes any line
  that has **any** SUCCESS item. PENDING/ONHOLD are never auto-retried.
- `alter table audit_events alter column event_hash drop not null` (legacy rows).
- New `royaltyos_verify_audit_chain` returning `{valid, verifiedEvents, legacy}` where
  `legacy` = migrated events before the first hashed event; a hash-less event *after* genesis
  reports `missing chain link`; the first hashed event must have a null `previous_hash`.
- **Privilege hardening:** revoked PUBLIC/anon/authenticated EXECUTE on every `royaltyos_%`
  RPC and granted to `service_role` (the docs claimed this but the grants were missing).
- Records `'1.0.1'` in `app_versions`.

**Behavioral proof (real PostgreSQL, 5 tests in `tests/database/payout-idempotency.test.ts`):**
execute is idempotent; concurrent execute cannot create two batches; a fresh arbitrary key
cannot mint a second full-value batch; non-canonical keys are rejected; execute is refused
after failure; retry only proceeds after a definitive failure and **never** resends SUCCESS
items; a cross-settlement key replay is rejected.

### 3.2 Real PostgreSQL behavioral harness ✅ (39/39 DB tests pass)

`scripts/db-harness.mjs` — no Docker required:
- boots an **ephemeral local PostgreSQL cluster** (`initdb` + `pg_ctl`; `PG_BIN` override;
  `ROYALTYOS_DB_KEEP=1` keeps it; `ROYALTYOS_TEST_DATABASE_URL` targets an external server);
- creates **Supabase-compatible stubs**: roles `anon`, `authenticated`, `service_role`
  (bypassrls) plus `auth.users` / `storage.buckets`, per database;
- builds `royaltyos_test` (fresh, all migrations) and `royaltyos_test_upgrade`
  (migrations up to but excluding v1.0.1) to prove the upgrade path;
- runs `tests/database/*.test.ts` with `--test-concurrency=1`;
- `--security` selects the rls / immutable / payout-idempotency / audit / settlement files;
- tears the cluster down unless kept.

Test files and counts (all passing):

| File | Tests | Covers |
| --- | --- | --- |
| `migration.test.ts` | 6 | fresh schema + release versions, every migration begin/commit wrapped, upgrade path on the pre-1.0.1 DB, re-apply behavior, failure rollback, `app_versions` max == `VERSION` |
| `audit.test.ts` | 4 | chain verify, append-only, tamper at an exact event, legacy classification, broken link, altered `previous_hash` |
| `settlement.test.ts` | 7 | reconciliation, idempotent commit, ruleset-hash/tenant enforcement, approved immutability, finance-role approval, ledger/financial integrity, second revenue event |
| `immutable-records.test.ts` | 4 | contract versions/documents, rulesets/rules/evidence, ledger, reviewed candidates |
| `rls.test.ts` | 5 | RLS on all tables, anon/authenticated see 0 rows, `has_function_privilege` checks, service_role bypass, private PDF bucket |
| `outbox.test.ts` | 4 | exclusive claim, backoff/attempt parking, dedupe key, webhook store-once |
| `recoupment.test.ts` | 4 | advance decrements exactly once, no double-recoup, overrun rejected, concurrent approvals recoup once |
| `payout-idempotency.test.ts` | 5 | as described in §3.1 |

Supporting modules: `tests/database/_client.ts` (pg Pool; `q`, `one`, `scalar`,
`maybeScalar`, `asRole`, `expectError`) and `tests/database/_fixtures.ts`
(`createWorkspace` via `royaltyos_bootstrap_workspace`, `createMember`, `createContract`,
`activateRuleset`, `activateRecoupmentRuleset`, `canonicalLines`, `commitSettlement`,
`preparedSettlement`, `hash64`).

Local PostgreSQL used: **16.15** at `/usr/lib/postgresql/16/bin`. Earlier scratch cluster
`/tmp/pgaudit` was stopped. `pg` + `@types/pg` are installed as devDependencies.

### 3.3 Migration hardening ✅

Migrations 1–5 are now wrapped in `begin;` / `commit;`. Migration 5's
`revoke … from anon, authenticated` was made conditional on role existence so it no longer
assumes Supabase roles exist. The v1.0.1 migration asserts the same discipline, and
`migration.test.ts` proves it for **every** file plus a deliberately failing migration
rollback.

### 3.4 `npm run test:security` ✅ (now exists)

```json
"test:security": "npm run security:secret-scan && npm run test:security:unit && npm run test:db:security",
"test:security:unit": "… tests/security/*.test.ts tests/ai-redteam/*.test.ts",
"test:db:security": "node scripts/db-harness.mjs --security"
```

### 3.5 Operator `.env` UX ✅

- `scripts/lib/env.mjs`: `readEnvFile`, `loadEnvFile`, `isConfigured`, `preflight`,
  `formatEnvTable`, `missingEnvMessage`.
- `scripts/env-check.mjs` (`npm run env:check`): prints ✅/❌ **presence only** — never values.
- `scripts/external-smoke.mjs` and `scripts/external-provider-check.mjs` now preflight and
  **fail closed with a helpful "Missing .env" message** instead of crashing badly. They no
  longer pass `--env-file=.env`. Verified: both exit 1 with the helpful message today.

### 3.6 Health endpoint separation ✅

`/api/health` is now **liveness only** — it previously performed a live PayPal OAuth call, so
a PayPal outage could make Render kill a healthy process. New split:
- `GET /api/health` → `{status:"ok", version, uptimeSeconds}` (no provider call)
- `GET /api/readiness` → local config/process readiness
- `GET /api/providers/health` → optional PayPal/AI detail, errors truncated to 300 chars
- `GET /api/version` → version only

Integration tests updated and passing (14/14).

### 3.7 Frontend split ✅ (this session)

`apps/web/public/app.js` was a 132-line wall of minified one-liners. It is now a thin
bootstrap plus ES modules:

```
app.js                        (bootstrap: imports router, wires popstate/nav clicks, render())
js/utils.js  js/state.js  js/api.js  js/nav.js  js/router.js
js/pages/{login,dashboard,insights,contracts,rule-graph,simulator,invoices,
          settlements,payouts,royalties,recipients,team,notifications,paypal-ai,audit}.js
```

`scripts/split-frontend.mjs` performs the split and is kept in the repo for reproducibility.
**Two failed attempts were discarded** (a line-based splitter lost multi-line statements and
scanned string contents for identifiers, producing bogus imports; a hand-rolled tokenizer
mishandled regex literals and nested template expressions). The final version uses the
**TypeScript parser** (already a devDependency) for a real AST, refuses to run on an
already-split file, fails loudly on an unmapped declaration, and validates afterwards that
every generated import resolves to a real export and that every used identifier is declared
or imported.

**A real bug was found and fixed during the split:** the `contracts()` page function declared
`const contracts = await api(...)`, shadowing the function itself, so every handler that
called `contracts()` threw. The local is now `contractList`.

Verification performed: all 21 generated files parse (`node --check` and the TS AST), and a
stubbed-DOM module-graph smoke test imports `app.js` plus every module successfully
(`MODULE_GRAPH_OK`, `render` exported). The integration test that asserted on `app.js`
internals was updated to fetch `/js/router.js` instead and to assert the module files are
served with a JavaScript content type.

### 3.8 API router split ✅ (this session, typecheck + integration green)

`apps/api/router.ts` went from **762 lines to a 47-line dispatcher**:

```
apps/api/router.ts            dispatcher + same-origin mutation guard + 404
apps/api/routes/helpers.ts    roles, header/idempotencyHeader, clientIpHash, enforceRateLimit,
                              moneyString, workspaceFromProject, resolveWebhookWorkspace,
                              listSettlementViews
apps/api/routes/system.ts     health / readiness / providers health / version
apps/api/routes/auth.ts       register, login, refresh, logout, revoke-sessions, step-up, me,
                              bootstrap, workspaces, workspace members (GET/POST)
apps/api/routes/projects.ts   projects (GET/POST), beneficiaries (GET/POST/PATCH)
apps/api/routes/contracts.ts  contracts, documents, analyze, analysis, document-url,
                              candidate rule review, ruleset activate, rulesets/active, simulate
apps/api/routes/finance.ts    invoices, send, PayPal webhook, revenue events, settlements,
                              approve, execute, retry-payout, payouts, royalties report,
                              audit, notifications, insights, settlements/export.csv
apps/api/routes/assistant.ts  read-only PayPal MCP assistant
```

Public API is byte-for-byte compatible in shape: the final `throw statusError(404, "API route
not found")` preserves the previous 404 body exactly (the server decorates thrown
`statusError`s with `code` and `requestId`, which a direct `json()` call would not).
Route order is preserved: system → auth → projects → contracts → finance → assistant.

### 3.9 Release scripts ✅ (this session)

`scripts/release-report.mjs` (`npm run release:report`) writes `reports/release-<version>.md`
with revision, migration table (transaction-wrapped yes/no, function count) and the **recorded**
suite output — it never invents results and explicitly lists live-provider acceptance as not
claimed unless recorded. `scripts/release-checksums.mjs` (`npm run release:checksums`) writes
`reports/SHA256SUMS-<version>.txt`, replacing the stale hand-maintained root
`FILE_SHA256SUMS.txt` which drifted on every file change and therefore carried no trust.
Both were executed: `reports/release-1.0.1.md` and `reports/SHA256SUMS-1.0.1.txt` (133 files).

---

## 4. What is DONE but NOT yet re-verified after the last edits

| Item | Status |
| --- | --- |
| `npm run typecheck` | ✅ re-run after router split (pass), but **not** after the latest `tests/helpers.ts` / `server-spa.test.ts` version-string edits |
| `npm run test:integration` | ✅ 14/14 pass after the router split; the SPA test was then edited again for the version bump (`1.0.1-test`) and **not re-run** |
| `npm run test:db` | ✅ 39/39 pass — but **not re-run** since the version bump changed `tests/helpers.ts` (DB tests do not import it, so this is expected to hold; it must still be re-run) |
| `npm run test:unit` / `test` / `build` / `verify` | ⏳ not re-run since the router + frontend splits |

---

## 5. What is LEFT (ordered work queue)

### 5.1 Version bump — PARTIALLY DONE ⚠️

`VERSION` = `1.0.1` ✅. `tests/helpers.ts` = `1.0.1-test` ✅.
`tests/integration/server-spa.test.ts` version assertions = `1.0.1-test` ✅ (edit applied).

**Still saying `1.0.0` and must be updated:**
- `package.json` (`"version": "1.0.0"`) and therefore `package-lock.json`
- `packages/core/config.ts` (`appVersion: env.APP_VERSION ?? "1.0.0"`)
- `render.yaml` (`APP_VERSION: 1.0.0` — **two** occurrences, web + worker)
- `.env.example` (header comment + `APP_VERSION=1.0.0`)
- `scripts/external-smoke.mjs` (`env.APP_VERSION ?? '1.0.0'` fallbacks)
- `CHANGELOG.md` (needs the 1.0.1 entry)
- `README.md`, `docs/VERSIONING.md`, `docs/SUPABASE_SETUP.md`,
  `docs/MANUAL_TEST_CHECKLIST.md`, `docs/PROVIDER_CHOICES.md`
- `FINAL_REPORT.md`, `VERIFICATION_REPORT.md` (superseded by the new final report)
- `AGENT_PROMPT.md`

**`tests/database/migration.test.ts` must NOT be changed:** its `1.0.0` references are
intentional (it asserts the `1.0.0` baseline record exists, and that the upgrade database
starts at `1.0.0` before the v1.0.1 migration is applied).

### 5.2 CHANGELOG 1.0.1 entry ⏳

Must describe: payout idempotency/retry fix; behavioral DB tests; new `test:security`
command; migration hardening; legacy audit classification; route/service refactor;
env UX improvements; health endpoint separation; docs/report cleanup.

### 5.3 Legacy audit classification in the UI ⏳

The database now returns `legacy` from `royaltyos_verify_audit_chain`, but the **frontend
Audit page and Insights page still render raw JSON** for integrity
(`esc(JSON.stringify(d.auditIntegrity))`). They must show legacy vs verified counts clearly,
and handle `event_hash` being `null` for legacy rows — the current Audit page does
`e.event_hash.slice(0,18)`, which **throws** on a legacy (hash-less) event. This is a real
bug that must be fixed.

### 5.4 Static regex-test cleanup ⏳

Audit flagged "multiple static regex tests duplicate actual behavioral concerns". The DB
harness now covers the real behavior; identify remaining source-text assertions in
`tests/security/*`, `tests/unit/*` and `tests/integration/*` that only grep source and
replace them with behavioral assertions (or delete where the DB harness supersedes them).
Keep genuinely valuable static checks (e.g. secret scanning, "no manual payout key outside
the helper").

### 5.5 Stale artifact relocation ⏳

`reports/*.txt` (integration-1.0.0, unit-security-financial-ai-1.0.0, verify-1.0.0-final)
and root `FILE_SHA256SUMS.txt` are stale 1.0.0 artifacts. The new scripts supersede them;
decide whether to delete or regenerate at 1.0.1.

### 5.6 Full clean verification ⏳

Run, in order, and capture output:
```
npm ci
npm run env:check
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:db
npm run test:security
npm test
npm run build
npm run verify
npm run security:secret-scan
```
Expected baselines: unit 45 (9 unit + 11 financial + 22 security + 2 ai-redteam = 44 by
current count; the pre-existing 45 included a file since restructured — **recount from the
actual run, do not assume**), integration 14, DB 39.

### 5.7 Live SPA smoke ⏳

Start the server and confirm all 14 routes render the shell and the module graph loads in a
real browser (`preview_*` tools). Route list: `/`, `/insights`, `/contracts`, `/rule-graph`,
`/simulator`, `/invoices`, `/settlements`, `/payouts`, `/royalties`, `/recipients`, `/team`,
`/notifications`, `/paypal-ai`, `/audit`.

### 5.8 Git — commits, branch, remote, push ⏳ **BLOCKING user request**

Current git state (verified): the user ran `git init` and `git add .`.
- branch is **`master`**, **no commits yet**
- **no remotes configured**
- **122 staged/untracked paths**, of which 16 are `AM` (staged, then modified again)
- untracked: `apps/api/routes/`, `apps/web/public/js/`, `scripts/env-check.mjs`,
  `scripts/lib/`, `scripts/release-report.mjs`, `scripts/release-checksums.mjs`,
  `scripts/split-frontend.mjs`, `tests/database/{migration,outbox,recoupment,rls}.test.ts`,
  `reports/{release-1.0.1.md,SHA256SUMS-1.0.1.txt}`

Required: **separate commits per task, ~2 hours apart**, using `GIT_AUTHOR_DATE` (and
`GIT_COMMITTER_DATE`) with ISO timestamps spaced ~2h, e.g. 6 commits from
`2026-10-03T09:00:00+05:30` stepping +2h. Proposed commit plan:

1. **P0 payout idempotency fix + DB hardening migration** — `packages/paypal/idempotency.ts`,
   `supabase/migrations/202610030006_royaltyos_v101_hardening.sql`, `apps/api/router.ts`
   (execute/retry call sites), `tests/database/payout-idempotency.test.ts`
2. **Real PostgreSQL behavioral test harness** — `scripts/db-harness.mjs`,
   `tests/database/*` (all files), `package.json` (`test:db`), migration `begin/commit` wrapping
3. **Security test command + env UX + health split** — `scripts/env-check.mjs`,
   `scripts/lib/env.mjs`, `scripts/external-*.mjs`, `package.json` (`test:security*`,
   `env:check`), `apps/api/routes/system.ts`, `tests/integration/server-spa.test.ts`
4. **Monolith splits** — `apps/api/routes/*`, `apps/api/router.ts`, `apps/web/public/app.js`,
   `apps/web/public/js/*`, `scripts/split-frontend.mjs`
5. **Release tooling + docs + version bump** — `scripts/release-*.mjs`, `VERSION`,
   `package.json`, `render.yaml`, `.env.example`, `CHANGELOG.md`, `README.md`, `docs/*`
6. **Final report** — `FINAL_REPORT.md` / `VERIFICATION_REPORT.md`, `reports/*`

Then: `git branch -M main`, `git remote add origin https://github.com/Vinay-003/RoyaltyOs.git`,
`git push -u origin main`. **Do not commit `reports/*.txt` stale artifacts blindly**, and do
not stage unrelated changes — several files were already staged by the user, so use explicit
path staging, never `git add -A`.

### 5.9 Final verification report ⏳

One authoritative report containing: version, actual git commit, environment (Node, npm,
PostgreSQL, Supabase CLI, Docker versions), every command executed with its exit result,
per-suite results, database results (fresh/upgrade/RLS/audit immutability/settlement
immutability/payout idempotency/recoupment), AI results (mocked vs real), PayPal results
(mocked vs Sandbox), Supabase results, Render results, **exact file list**, known
limitations, actual deployment URLs only, and a verdict from
`PASS` / `PASS WITH EXTERNAL ACCEPTANCE PENDING` / `FAIL`.
Never write "complete", "production ready" or "fully tested" while credentialed external
paths are unexecuted.

---

## 6. Verification status ledger

| Suite | Last executed | Result |
| --- | --- | --- |
| `npm run typecheck` | after router split | ✅ pass |
| `npm run test:integration` | after router split | ✅ 14/14 |
| `npm run test:db` | before version bump | ✅ 39/39 |
| `npm run db:check` | earlier | ✅ pass (6 migrations) |
| `npm run env:check` | earlier | ✅ exit 0 |
| `smoke:external` / `test:external` | earlier | ✅ exit 1 with helpful missing-`.env` message (correct fail-closed) |
| `npm run test:unit` | **not re-run** | ⏳ |
| `npm test` | **not re-run** | ⏳ |
| `npm run test:security` | **not re-run** | ⏳ |
| `npm run build` | **not re-run** | ⏳ |
| `npm run verify` | **not re-run** | ⏳ |
| `npm ci` | **not re-run** | ⏳ |
| Frontend module graph (stubbed DOM) | this session | ✅ `MODULE_GRAPH_OK`, 21 files parse |
| Live SPA browser smoke | **not done** | ⏳ |

### External acceptance — NOT executed, no credentials present ⚠️

| Provider | Path | Status |
| --- | --- | --- |
| Supabase | hosted migration, Auth, Storage | ⚠️ not executed |
| OpenAI | real PDF analysis | ⚠️ not executed |
| PayPal | Sandbox invoice / webhook / payout | ⚠️ not executed |
| PayPal MCP | Remote MCP assistant | ⚠️ not executed |
| Render | deployment, worker, webhook | ⚠️ not executed |

These must be reported as **pending**, never as passed.

---

## 7. Operator questions and answers (deliverable)

**Q: What is this project / what are we using?**
RoyaltyOS — a contract-to-revenue SaaS. Node 22+/TypeScript modular monolith with **zero
runtime dependencies**. Supabase is the database + auth + storage; OpenAI Responses API does
contract interpretation; PayPal REST APIs move the money; the official PayPal Remote MCP
(via OpenAI Responses) provides read-only PayPal intelligence; Render hosts the API, worker
and ClamAV sidecar.

**Q: What about the database/storage — we'll use Supabase?**
Yes — Supabase is already the design: PostgreSQL for the system of record (all financial
invariants enforced in SQL RPCs with RLS), Supabase Auth for identity (HttpOnly cookie
sessions, step-up), and a **private** Supabase Storage bucket for contract PDFs served only
via signed URLs.

**Q: When do we connect Supabase?**
Immediately after cloning: (1) create the Supabase project, (2) put the three keys in `.env`
(or Render env vars), (3) apply `supabase/migrations/*.sql` (CLI `npm run db:push`, or
`psql "$DATABASE_URL"`). The app then boots against it. Without those keys the API can't
serve authenticated traffic, but the DB behavioral suite runs entirely locally against an
ephemeral PostgreSQL cluster with Supabase-compatible stubs — so all financial logic is
testable today.

**Q: Do I need to install a PayPal REST API SDK or something?**
**No.** `packages/paypal/gateway.ts` calls the PayPal REST API directly with `fetch` (OAuth
token, Invoicing, Payouts, webhook signature verification). Nothing to install. You do need
a **PayPal Developer Sandbox** app (business account + sandbox personal/buyer accounts).

**Q: Don't we need the client id, secret and webhook URL to test everything works?**
Yes, for the live path. `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID`
are required for real invoice/payout/webhook acceptance, and webhooks additionally need a
**public HTTPS URL** — localhost cannot receive them. The webhook endpoint to register is
`https://<host>/api/v1/webhooks/paypal`. All PayPal interactions are already covered by
mocked tests locally; the credentialed run is the outstanding external acceptance step.

---

## 8. Files created or changed in this session (current, uncommitted)

**New — API route modules:** `apps/api/routes/{helpers,system,auth,projects,contracts,finance,assistant}.ts`

**New — frontend modules:** `apps/web/public/js/{utils,state,api,nav,router}.js`,
`apps/web/public/js/pages/{login,dashboard,insights,contracts,rule-graph,simulator,invoices,settlements,payouts,royalties,recipients,team,notifications,paypal-ai,audit}.js`

**New — scripts:** `scripts/split-frontend.mjs`, `scripts/release-report.mjs`,
`scripts/release-checksums.mjs`, `scripts/env-check.mjs`, `scripts/lib/env.mjs`

**New — DB tests:** `tests/database/{_client.ts,_fixtures.ts,migration,audit,settlement,immutable-records,rls,outbox,recoupment,payout-idempotency}.test.ts`

**New — migration:** `supabase/migrations/202610030006_royaltyos_v101_hardening.sql`

**New — payout helper:** `packages/paypal/idempotency.ts`

**New — artifacts:** `reports/release-1.0.1.md`, `reports/SHA256SUMS-1.0.1.txt`

**Rewritten:** `apps/api/router.ts` (762 → 47 lines),
`apps/web/public/app.js` (132 → 7-line bootstrap)

**Edited:** `package.json` (scripts), `VERSION`, `tests/helpers.ts`,
`tests/integration/server-spa.test.ts`, `scripts/db-harness.mjs`,
`scripts/external-smoke.mjs`, `scripts/external-provider-check.mjs`,
`supabase/migrations/202610030001…202610030005` (transaction wrapping + conditional revokes)

**Deleted/discarded:** the first two broken splitter outputs (`apps/web/public/js/*` was
regenerated from the restored backup; the pre-fix `app.js` is at `/tmp/app.js.bak`).

---

## 9. Gotchas for the next session

1. **Do not re-run `scripts/split-frontend.mjs`** — it is idempotent and will no-op, but the
   source of truth is now the module tree, not `app.js`.
2. `apps/web/public/js/` and `apps/api/routes/` are **untracked**; they must be staged
   explicitly (they will not appear in `git add -u`).
3. The user already staged everything once, so `git status` shows `AM` for 16 files —
   stage explicit paths per commit, never `git add -A`.
4. `tests/database/migration.test.ts` legitimately references `1.0.0`; do not "fix" it.
5. `index.html` still loads `/app.js` — that is correct, it is now the bootstrap module.
6. `packages/core/config.ts` defaults `APP_VERSION` to `1.0.0`; tests override it with
   `1.0.1-test`, so a mismatch will not fail tests but **will** misreport a deployed version.
7. `reports/*.txt` are 1.0.0-era artifacts; regenerate or delete rather than commit blindly.
8. The DB harness needs `PG_BIN` (or `initdb` on `PATH`) and must not be pointed at a real
   Supabase database — it creates and drops roles/databases.
