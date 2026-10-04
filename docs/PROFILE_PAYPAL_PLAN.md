# Profile + Per-Workspace PayPal — Build Plan

Status: approved with recommended options. Implementation in phases P1–P4.
Decisions locked: pasted per-workspace credentials (no Partner OAuth dependency),
app-level AES-256-GCM with `PAYPAL_CREDENTIALS_KEY`, global-env fallback,
profile scope includes display-name change (password change deferred).

## 0. Architectural constraint

PayPal offers no "Log in with PayPal → grant API access" for third-party
royalty apps without the PayPal Partner program (a business approval track).
So "connect PayPal" = a workspace OWNER pastes their own REST app credentials
(client ID + secret + webhook ID) into workspace settings. The server encrypts
them and uses them for that workspace's money paths instead of the global
Render env vars. Same credential shape as today, moved per-workspace.

## 1. Database — migration 011

File: `supabase/migrations/202610030011_royaltyos_workspace_paypal.sql`
(wrapped in `begin;`/`commit;`, no version bump — precedent 008/009/010).

```sql
create table if not exists workspace_paypal_accounts (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox','live')),
  paypal_client_id text not null,
  paypal_client_secret_enc text not null,
  paypal_webhook_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- service_role only, mirroring the v101 hardening:
-- revoke all on workspace_paypal_accounts from public, anon, authenticated;
```

Notes:

- Only `client_secret` is encrypted; client ID and webhook ID are public-ish
  (visible in the PayPal dashboard) and stay plaintext for debuggability.
- No new RPCs: routes use direct service_role access plus the existing
  `royaltyos_append_audit` RPC with new action names
  (`PAYPAL_ACCOUNT_CONNECTED` / `PAYPAL_ACCOUNT_UPDATED` /
  `PAYPAL_ACCOUNT_DISCONNECTED`).
- Any future `SECURITY DEFINER` function uses
  `SET search_path = public, extensions` (VERSIONING.md rule).

## 2. Crypto — `packages/security/paypal-vault.ts` (new)

- AES-256-GCM via `node:crypto`: `encryptSecret(plaintext, keyB64)` returns
  `v1:<base64 nonce>:<base64 ciphertext>`; `decryptSecret` validates format,
  key length (32 bytes), and auth tag — wrong key or tampered input fails
  closed, never returns partial plaintext.
- Key source: `PAYPAL_CREDENTIALS_KEY` (base64, 32 bytes), read in
  `packages/core/config.ts` as **optional** (`security.paypalCredentialsKey:
  string | null`) so boot never breaks without it. Routes that need it throw
  500 with "PayPal credential encryption is not configured" when unset.
- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Unit tests `tests/unit/paypal-vault.test.ts`: roundtrip, wrong-key reject,
  tampered-cipher reject, malformed-blob reject, empty-plaintext reject.

## 3. Gateway refactor — `packages/paypal/gateway.ts`

- Constructor accepts optional override `{ clientId, clientSecret, webhookId }`
  falling back to global config per field. The OAuth token cache stays
  per-instance, which is automatically per-credential-set: two workspaces can
  never share tokens.
- New `paypalForWorkspace(ctx, workspaceId)` in `apps/api/services.ts`:
  loads the workspace row via service_role, decrypts the secret, returns
  `{ gateway, source: "workspace" | "global" }`. No row (or route opt-out) →
  global gateway built from env (today's behavior, byte-identical).
- `verifyWebhook` already receives the webhook ID as a parameter — call sites
  pass the resolved one. Webhook route flow becomes: existing
  `resolveWebhookWorkspace` (invoice/batch/item → workspace, in
  `apps/api/routes/helpers.ts`) → `paypalForWorkspace` → verify with that
  workspace's ID. Unresolvable events keep global-ID verification.
- Call-site inventory to convert (all currently use global `ctx.paypal`):
  `apps/api/routes/finance.ts`: createInvoice, sendInvoice, getInvoice,
  createPayout, getPayoutBatch, verifyWebhook.
  `apps/workflows/worker.ts`: same set, one gateway per job built from the
  row's workspace_id (fine at worker throughput).
  `apps/api/routes/assistant.ts`: UNCHANGED (PayPal MCP path uses no REST
  credentials). `ctx.paypal` remains for `/api/providers/health` only —
  after P2, grep must show no other `ctx.paypal` money-path usage.

## 4. Backend routes — new `apps/api/routes/profile.ts`

Registered in `apps/api/router.ts` (exact if-chain style — the server-spa
test asserts literal `if(p===...)` lines).

- `GET /api/v1/profile` → `{ id, email, displayName, workspaces: [{ id,
  name, role, paypalConnected, paypalEnvironment }] }` (any authenticated user).
- `PATCH /api/v1/profile` → display name only. Needs new
  `SupabaseClient.updateUserById` (`PUT /auth/v1/admin/users/{id}` with the
  service-role key, `{ user_metadata: { display_name } }`). Verify the exact
  response shape during build; step-up NOT required (non-financial).
- `GET /api/v1/workspaces/:id/paypal-account` → OWNER only. Returns status,
  environment, full client ID, webhook ID, `secretConfigured: true/false`,
  timestamps — **never the secret**. Extract pure `toSafeAccount(row)` so
  redaction is unit-testable.
- `PUT /api/v1/workspaces/:id/paypal-account` → OWNER + step-up. Body:
  `{ clientId, clientSecret, webhookId, environment }`. Server validates by
  fetching a PayPal OAuth token with the NEW credentials BEFORE storing (fail
  fast on typos), encrypts, upserts, audits `PAYPAL_ACCOUNT_CONNECTED` (or
  `_UPDATED` when a row existed).
- `DELETE /api/v1/workspaces/:id/paypal-account` → OWNER + step-up. Deletes,
  audits `PAYPAL_ACCOUNT_DISCONNECTED`. Global env fallback resumes silently.
- RBAC mirrors `finance.ts`: `authorizeWorkspace(ctx, req, workspaceId,
  ["OWNER"], true)` for writes.

## 5. Frontend

- `apps/web/public/js/nav.js`: append `["/profile","Profile","U"]` to
  `navItems`.
- `apps/web/public/js/router.js`: exact-style route + `loadingView` title.
- `apps/web/public/js/pages/profile.js` (new, modeled on `team.js`):
  identity card (email read-only, display-name form, per-workspace roles) +
  PayPal connection card per owned workspace (status, environment select
  sandbox/live, client ID/secret/webhook ID form, connect/update/disconnect
  with confirm). Non-owners see "contact your workspace owner" instead of the
  form. Reuses `busy`/`submitButton`/`toast`/`withStepUp`; spinner + skeleton
  conventions from the loading pass apply.
- `tests/integration/server-spa.test.ts`: add the profile route lines.

## 6. Config / env / docs

- `packages/core/config.ts`: `security.paypalCredentialsKey` (optional).
- `.env.example`, `render.yaml`, `render.paid.yaml` (`sync: false`, no
  default), `scripts/env-check.mjs` OPTIONAL list.
- CHANGELOG Unreleased; `docs/USER_FLOW.md` profile section;
  `docs/MANUAL_TEST_CHECKLIST.md` bullets (bad secret fails fast before
  storing; disconnect falls back to global; non-OWNER gets 403; secret absent
  from every GET response; PUT/DELETE demand step-up);
  `docs/RENDER_DEPLOYMENT.md` key-generation command.

## 7. Tests

- **unit** (`tests/unit/`): vault roundtrip/tamper/format;
  gateway override produces the `Basic` header from override creds (mocked
  fetch, existing paypal-gateway style); `toSafeAccount` redaction (no secret
  key present in output).
- **security**: table RLS matrix via harness patterns (anon/authenticated
  denied, service_role allowed) in the new DB test file.
- **database** (`tests/database/workspace-paypal-accounts.test.ts`):
  one-row-per-workspace constraint, cascade on workspace delete, RLS matrix,
  connect→read→disconnect cycle leaves audit rows.
- **migration**: 011 auto-covered by wrap + re-apply tests (`begin;`/`commit;`
  + idempotent).
- Route glue is thin and mirrors existing shapes (same honesty note as the
  refresh route); covered by the manual checklist E2E below.

## 8. Manual E2E (staging workspace, before push)

1. Connect sandbox creds on a test workspace (fails fast on a bad secret).
2. Run a $1 invoice cycle end to end on workspace creds.
3. Disconnect → confirm global fallback resumes.
4. Non-owner attempts → 403s; GET responses contain no secret; step-up enforced.

## 9. Rollout

- **P1**: migration 011 + vault + unit tests (no behavior change; suite green).
- **P2**: gateway override + `paypalForWorkspace` + worker/finance call-sites
  (identical behavior via global fallback; full suite green).
- **P3**: profile routes + frontend + docs (feature live but inert until first
  connect).
- **P4**: security/DB tests + manual sandbox E2E → push.
- Zero-downtime: fallback + optional key mean existing single-credential
  deployments behave byte-identically until the first workspace connects.
- Explicit non-goals for v1: encryption-key rotation (old key must be retained;
  documented limitation), PayPal Partner OAuth (business track, not code),
  per-environment (sandbox+live simultaneously) rows — one row per workspace,
  environment is a field.
