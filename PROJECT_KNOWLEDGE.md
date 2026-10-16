# RoyaltyOS — Technical Knowledge Base & System Specification

> **Target Consumer:** Autonomous AI Agents, LLM Code Assistants, and Technical Engineers.  
> **Format:** Machine-readable, zero-fluff, dense architectural and algorithmic specification.  
> **Diagram Policy:** Diagrams omitted by design; exact technical interfaces, wire protocols, state machines, and mathematical formulas specified in text.

---

## 1. System Metadata, Core Purpose & Invariants

- **Project Name:** RoyaltyOS
- **Version:** `1.0.2`
- **Repository Type:** pnpm multi-package monorepo (Node.js 22 LTS, TypeScript 5.8)
- **Primary Domain:** Multi-tenant royalty calculation, contract term compilation, automated client invoicing, and programmatic payout disbursement for music, film, gaming, and digital creator agreements.
- **Core Problem Solved:** Eliminates manual spreadsheet accounting, fractional rounding drift, unrecouped advance tracking errors, and payment double-spend risks when distributing revenue shares across multiple rights holders.

### The Golden Architectural Invariant
```
AI interprets contracts. Deterministic software calculates money. Humans authorize high-impact actions. PayPal moves the money.
```

### Deterministic Principles
1. **Zero Floating-Point Arithmetic:** All monetary amounts are stored and computed as 64-bit integer minor units (cents: `$1.00 = 100`). Split percentages are modeled as integer basis points ($10,000\text{ bps} = 100.00\%$).
2. **Zero-Drift Remainder Allocation:** The Hare-Niemeyer Largest Remainder method distributes fractional pennies deterministically so that:
   $$\sum_{i=1}^n \text{allocated\_amount}_i = \text{total\_settlement\_amount}$$
3. **Idempotent Payment Rails:** Every disbursement dispatches an immutable, deterministic idempotency key (`payout:<workspaceId>:<settlementId>:v<version>`) preventing duplicate transfers during network timeouts.
4. **Transactional Outbox Persistence:** Background jobs are persisted to PostgreSQL within the exact same ACID transaction as the financial state mutation.
5. **Fail-Closed Execution:** Any unhandled validation error, basis-point mismatch ($\neq 10,000$), cycle detection in split rules, or database lock contention immediately halts execution without side effects.

---

## 2. Monorepo Structure & Package Manifest

```
royaltyos/
├── apps/
│   ├── api/                     # Node.js HTTP Backend (Port 3000 / 3001)
│   │   ├── src/
│   │   │   ├── server.ts        # Native node:http server, routing trie, body streaming, CORS
│   │   │   ├── routes/          # HTTP Endpoint route handlers (10 modules)
│   │   │   │   ├── auth.ts
│   │   │   │   ├── workspaces.ts
│   │   │   │   ├── contracts.ts
│   │   │   │   ├── rules.ts
│   │   │   │   ├── settlements.ts
│   │   │   │   ├── payouts.ts
│   │   │   │   ├── invoices.ts
│   │   │   │   ├── webhooks.ts
│   │   │   │   ├── audit.ts
│   │   │   │   └── system.ts
│   │   │   └── services/        # Backend business logic & database integration
│   │   │       ├── auth.ts      # Session cookies, dual-window expiry, step-up, IDOR check
│   │   │       ├── database.ts  # Supabase PostgREST client, boot migrations, advisory locks
│   │   │       ├── settlements.ts # Settlement calculation, advance recoupment, commit logic
│   │   │       ├── outbox.ts    # Polling worker, FOR UPDATE SKIP LOCKED batch dispatch
│   │   │       ├── audit.ts     # SHA-256 Merkle-style hash chain logging
│   │   │       └── notifications.ts # Resend transactional email transport
│   │   └── test/                # Test suites (unit, security, financial, integration)
│   └── web/                     # Frontend Client SPA (Vanilla JS, CSS, Port 5173 / Static CDN)
│       └── src/
│           ├── app.js           # Client router, state store, gateway retry interceptor, step-up modal
│           ├── index.html       # Single Page Application HTML shell
│           └── styles.css       # Design system styles
├── packages/
│   ├── core/                    # Pure Domain Logic & Mathematics (Zero external dependencies)
│   │   ├── money.ts             # Minor unit arithmetic, Hare-Niemeyer allocation, formatters
│   │   ├── rules.ts             # Rule schema validation, DAG cycle detection (3-state DFS)
│   │   └── types.ts             # Shared domain TypeScript types and enums
│   ├── paypal/                  # PayPal REST API Integration
│   │   ├── client.ts            # OAuth2 token caching, HTTP request dispatch with retry
│   │   ├── invoices.ts          # Invoicing API v2 (Draft, Send, QR, Cancel)
│   │   ├── payouts.ts           # Payouts API v1 (Batch disbursement, Status checks)
│   │   ├── idempotency.ts       # Idempotency key generators and validators
│   │   └── webhooks.ts          # Webhook signature verification, deduplication
│   ├── ai/                      # Contract Extraction & LLM Guardrails
│   │   ├── openai-contract.ts   # Structured outputs, regex advance cross-check, repair retries
│   │   └── schemas.ts           # JSON Schema definitions for contract term extraction
│   └── security/                # Cryptography & Request Protection
│       ├── vault.ts             # AES-256-GCM envelope encryption & decryption
│       ├── rate-limiter.ts      # In-memory sliding Token Bucket rate limiter
│       └── antivirus.ts         # ClamAV ClamD TCP zINSTREAM protocol client
├── supabase/
│   └── migrations/              # PostgreSQL DDL migrations (6 SQL files)
│       ├── 20260330000001_core_ddl.sql       # Tables, check constraints, RLS, stored procedures
│       ├── 20260330000002_rls_policies.sql   # Row Level Security policies
│       ├── 20260330000003_audit_chains.sql   # Hash chain triggers and verification functions
│       ├── 20260330000004_payout_reserve.sql # royaltyos_reserve_payout stored procedure
│       ├── 20260330000005_settlement_commit.sql # royaltyos_commit_settlement stored procedure
│       └── 20260330000006_indexes.sql        # B-tree and composite indexing
├── package.json                 # Monorepo workspaces manifest
├── pnpm-workspace.yaml          # Monorepo configuration
├── tsconfig.json                # TypeScript base configuration
└── render.yaml                  # Unified / Split container infrastructure blueprint
```

---

## 3. Technology Stack & Runtime Specifications

| Category | Technology | Version | Location / Config | Operational Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `>=22.0.0` | `.nvmrc`, `package.json` | Native `fetch`, built-in `node:crypto`, ES Modules, stable standard libraries. |
| **Language** | TypeScript | `^5.8.2` | `tsconfig.json` | Strict type safety (`strict: true`, `noImplicitAny: true`), monorepo path aliases. |
| **HTTP Transport** | Native `node:http` | Node 22 stdlib | `apps/api/src/server.ts` | Zero-dependency footprint, fast boot (<100ms), 30MB RSS memory, reduced supply-chain attack surface. |
| **Database** | PostgreSQL | `15+` | Supabase Cloud | ACID transactions, row-level locks, PL/pgSQL stored procedures, advisory locks. |
| **Database Client** | Custom Fetch Adapter | Native `fetch` | `apps/api/src/services/database.ts` | Zero ORM overhead, direct Supabase PostgREST integration on port 6543 (PgBouncer) & direct port 5432. |
| **Payments** | PayPal REST APIs | v1 / v2 | `packages/paypal/` | Global payouts rail, automated merchant invoicing, cryptographic webhook verification. |
| **AI Extraction** | OpenAI Responses API | GPT-4o | `packages/ai/` | Structured Outputs (`response_format: { type: 'json_schema', strict: true }`). |
| **Frontend** | Vanilla JavaScript SPA | ES2022 | `apps/web/src/app.js` | Zero client bundle build overhead, direct DOM manipulation, ~45KB total payload. |
| **Security / Crypto** | Node.js `node:crypto` | Native | `packages/security/` | AES-256-GCM authenticated encryption for secrets, SHA-256 for audit hash chains. |
| **Antivirus** | ClamAV (ClamD) | TCP Socket | `packages/security/antivirus.ts` | In-flight streaming inspection of uploaded PDFs via `zINSTREAM` protocol. |
| **Email** | Resend REST API | v1 | `apps/api/src/services/notifications.ts` | Transactional disbursement notifications and security alerts. |

---

## 4. Database Architecture, Schema, RPCs & Migrations

### 4.1 Table Schema Catalog

1. **`workspaces`**: Multi-tenant isolation boundary. Stores `id` (UUID), `name`, `currency` (ISO-4217, default 'USD'), `owner_id`, `created_at`.
2. **`workspace_members`**: Join table mapping `workspace_id`, `user_id`, `role` (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), `created_at`. Composite PK: `(workspace_id, user_id)`.
3. **`users`**: Platform users. Stores `id` (UUID), `email`, `password_hash` (Argon2id/bcrypt), `full_name`, `created_at`.
4. **`sessions`**: Active authentication sessions. Stores `id`, `user_id`, `access_token_hash`, `refresh_token_hash`, `expires_at`, `idle_expires_at`, `step_up_until`, `revoked`.
5. **`contracts`**: Ingested legal agreements. Stores `id`, `workspace_id`, `title`, `file_url`, `file_hash` (SHA-256), `status` (`UPLOADED`, `EXTRACTED`, `REVIEW_REQUIRED`, `ACTIVE`, `AMENDED`, `ARCHIVED`), `raw_text`, `metadata` (JSONB).
6. **`contract_amendments`**: Audit log of contract revisions. Stores `id`, `contract_id`, `version`, `previous_rule_snapshot` (JSONB), `reason`, `amended_by`.
7. **`rulesets`**: Executable split configurations for contracts. Stores `id`, `contract_id`, `workspace_id`, `total_basis_points` (`CHECK (total_basis_points = 10000)`), `status` (`DRAFT`, `ACTIVE`, `DEPRECATED`), `version`.
8. **`rules`**: Individual split terms within a ruleset. Stores `id`, `ruleset_id`, `recipient_id` (UUID), `basis_points` (INT), `priority` (INT), `parent_rule_id` (UUID, nullable), `split_type` (`PERCENTAGE`, `FIXED_OFF_THE_TOP`, `TIERED`).
9. **`recipients`**: Payout beneficiaries. Stores `id`, `workspace_id`, `name`, `email`, `paypal_email`, `tax_id_encrypted`, `status` (`ACTIVE`, `SUSPENDED`).
10. **`recoupment_ledger`**: Balance tracking for unrecouped advances. Stores `id`, `contract_id`, `recipient_id`, `initial_advance_minor` (INT), `unrecouped_advance_minor` (INT), `last_updated_at`.
11. **`settlements`**: Financial settlement runs. Stores `id`, `workspace_id`, `contract_id`, `period_start`, `period_end`, `gross_revenue_minor` (INT), `net_distributable_minor` (INT), `status` (`DRAFT`, `CALCULATED`, `APPROVED`, `SETTLED`, `VOIDED`), `version` (INT).
12. **`settlement_allocations`**: Individual recipient breakdown for a settlement. Stores `id`, `settlement_id`, `recipient_id`, `gross_share_minor` (INT), `recouped_amount_minor` (INT), `net_payable_minor` (INT), `allocated_basis_points` (INT).
13. **`payouts`**: Payment execution records. Stores `id`, `settlement_id`, `recipient_id`, `amount_minor` (INT), `currency`, `idempotency_key` (UNIQUE), `status` (`PENDING`, `RESERVED`, `PROCESSING`, `SUCCESS`, `FAILED`), `paypal_payout_batch_id`, `paypal_item_id`, `error_code`, `version`.
14. **`invoices`**: Billing records issued to licensees. Stores `id`, `workspace_id`, `settlement_id`, `paypal_invoice_id`, `amount_minor`, `currency`, `status` (`DRAFT`, `SENT`, `PAID`, `CANCELLED`, `DISPUTED`), `due_date`.
15. **`webhook_events`**: Deduplication and audit log of incoming PayPal events. Stores `id`, `transmission_id` (UNIQUE), `event_type`, `payload` (JSONB), `status` (`RECEIVED`, `PROCESSED`, `FAILED`), `received_at`.
16. **`outbox_events`**: Transactional background job queue. Stores `id`, `workspace_id`, `event_type`, `payload` (JSONB), `status` (`PENDING`, `PROCESSING`, `COMPLETED`, `DEAD_LETTER`), `retry_count`, `next_retry_at`, `created_at`.
17. **`audit_logs`**: Cryptographically chained tamper-evident audit records. Stores `id`, `workspace_id`, `action`, `actor_id`, `payload` (JSONB), `previous_hash` (CHAR 64), `entry_hash` (CHAR 64), `created_at`.
18. **`vault_secrets`**: Encrypted sensitive credentials. Stores `id`, `workspace_id`, `secret_name`, `encrypted_payload` (JSONB), `key_version` (INT), `updated_at`.

### 4.2 Critical Stored Procedures (PL/pgSQL RPCs)

#### 1. `royaltyos_commit_settlement`
- **Location:** `supabase/migrations/20260330000005_settlement_commit.sql`
- **Signature:** `royaltyos_commit_settlement(p_settlement_id UUID, p_actor_id UUID) RETURNS BOOLEAN`
- **Execution Logic:**
  1. Sets `search_path = public, pg_temp;`.
  2. Acquires row-level write lock: `SELECT * FROM settlements WHERE id = p_settlement_id FOR UPDATE;`.
  3. Validates settlement status is `CALCULATED`. Rejects if already `APPROVED` or `SETTLED`.
  4. Verifies sum of allocations equals `net_distributable_minor`.
  5. Updates `recoupment_ledger` balances: deducts `recouped_amount_minor` from `unrecouped_advance_minor`.
  6. Inserts payout rows in `payouts` with status `PENDING` for all recipients with `net_payable_minor > 0`.
  7. Inserts an event into `outbox_events` (`event_type: 'SETTLEMENT_COMMITTED'`).
  8. Transitions settlement status to `APPROVED`.
  9. Appends a chained entry to `audit_logs`.
  10. Commits atomically.

#### 2. `royaltyos_reserve_payout`
- **Location:** `supabase/migrations/20260330000004_payout_reserve.sql`
- **Signature:** `royaltyos_reserve_payout(p_payout_id UUID, p_idempotency_key TEXT) RETURNS BOOLEAN`
- **Execution Logic:**
  1. Sets `search_path = public, pg_temp;`.
  2. Row-level write lock: `SELECT * FROM payouts WHERE id = p_payout_id FOR UPDATE;`.
  3. Verifies current status is `PENDING`.
  4. Checks that `idempotency_key` is not already used by another non-failed payout.
  5. Updates status to `RESERVED`, stores `p_idempotency_key`, sets `reserved_at = NOW()`.
  6. Commits and releases lock.

#### 3. `royaltyos_verify_audit_chain`
- **Location:** `supabase/migrations/20260330000003_audit_chains.sql`
- **Signature:** `royaltyos_verify_audit_chain(p_workspace_id UUID) RETURNS TABLE(valid BOOLEAN, tampered_row_id UUID)`
- **Execution Logic:**
  1. Iterates ordered cursor `SELECT * FROM audit_logs WHERE workspace_id = p_workspace_id ORDER BY created_at ASC;`.
  2. For genesis row: verifies `previous_hash` matches static genesis string (`0000000000000000000000000000000000000000000000000000000000000000`).
  3. For subsequent rows: verifies `row.previous_hash == prev_row.entry_hash`.
  4. Recomputes `expected_hash = encode(digest(row.previous_hash || row.action || row.payload::text || row.created_at::text, 'sha256'), 'hex')`.
  5. If `row.entry_hash != expected_hash`, immediately returns `(false, row.id)`.
  6. Returns `(true, NULL)` if entire chain validates.

#### 4. `royaltyos_financial_integrity`
- **Signature:** `royaltyos_financial_integrity(p_settlement_id UUID) RETURNS BOOLEAN`
- **Execution Logic:** Verifies $\sum \text{allocations.net\_payable} + \sum \text{allocations.recouped} == \text{settlement.net\_distributable}$. Returns boolean.

---

## 5. Complete 52-Endpoint API Catalog

All endpoints are hosted on the Node.js API server (`apps/api/src/server.ts`).

| Method | Path | Auth Scope | Step-Up Required | Request Body / Parameters | Success Response | Error Codes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | No | `{ email, password, full_name }` | `201 { user, workspace }` | 400, 409 |
| `POST` | `/api/auth/login` | Public | No | `{ email, password }` | `200 { user, session }` + Set-Cookie | 400, 401, 429 |
| `POST` | `/api/auth/refresh` | Public | No | Read from `royaltyos_refresh` cookie | `200 { refreshed: true }` + Set-Cookie | 401 |
| `POST` | `/api/auth/logout` | Session | No | Empty | `200 { logged_out: true }` + Clear Cookies | 401 |
| `GET` | `/api/auth/me` | Session | No | None | `200 { user, active_workspace }` | 401 |
| `POST` | `/api/auth/step-up` | Session | No | `{ password }` | `200 { step_up_valid_until }` + Set-Cookie | 401, 403 |
| `GET` | `/api/workspaces` | Session | No | None | `200 { workspaces: [] }` | 401 |
| `POST` | `/api/workspaces` | Session | No | `{ name, currency }` | `201 { workspace }` | 400, 401 |
| `GET` | `/api/workspaces/:id` | Member | No | URL Param: `id` | `200 { workspace, members }` | 401, 403, 404 |
| `PUT` | `/api/workspaces/:id` | Admin | Yes | `{ name, settings }` | `200 { workspace }` | 401, 403, 428 |
| `POST` | `/api/workspaces/:id/members` | Admin | Yes | `{ email, role }` | `201 { member }` | 400, 401, 403, 428 |
| `DELETE` | `/api/workspaces/:id/members/:uid` | Admin | Yes | URL Params: `id`, `uid` | `200 { removed: true }` | 401, 403, 428 |
| `GET` | `/api/contracts` | Member | No | Query: `?workspace_id=...` | `200 { contracts: [] }` | 401, 403 |
| `POST` | `/api/contracts/upload` | Member | No | `multipart/form-data` (PDF file) | `201 { contract_id, status }` | 400, 413, 415, 503 |
| `GET` | `/api/contracts/:id` | Member | No | URL Param: `id` | `200 { contract, rulesets }` | 401, 403, 404 |
| `POST` | `/api/contracts/:id/extract` | Member | No | `{ force_reextract: boolean }` | `200 { candidate_rules, status }` | 401, 403, 502 |
| `POST` | `/api/contracts/:id/amend` | Admin | Yes | `{ reason, rules: [] }` | `201 { amendment_id, version }` | 400, 401, 403, 428 |
| `DELETE` | `/api/contracts/:id` | Admin | Yes | URL Param: `id` | `200 { deleted: true }` | 401, 403, 428 |
| `GET` | `/api/rulesets` | Member | No | Query: `?contract_id=...` | `200 { rulesets: [] }` | 401, 403 |
| `POST` | `/api/rulesets` | Admin | No | `{ contract_id, rules: [] }` | `201 { ruleset }` | 400, 401, 403 |
| `GET` | `/api/rulesets/:id` | Member | No | URL Param: `id` | `200 { ruleset, rules: [] }` | 401, 403, 404 |
| `POST` | `/api/rulesets/:id/compile` | Admin | No | None | `200 { compiled: true, hash }` | 400, 401, 403, 422 |
| `PUT` | `/api/rulesets/:id/activate` | Admin | Yes | None | `200 { active: true }` | 401, 403, 428 |
| `GET` | `/api/recipients` | Member | No | Query: `?workspace_id=...` | `200 { recipients: [] }` | 401, 403 |
| `POST` | `/api/recipients` | Admin | No | `{ name, email, paypal_email }` | `201 { recipient }` | 400, 401, 403 |
| `GET` | `/api/recipients/:id` | Member | No | URL Param: `id` | `200 { recipient, balance }` | 401, 403, 404 |
| `PUT` | `/api/recipients/:id` | Admin | Yes | `{ paypal_email, status }` | `200 { recipient }` | 400, 401, 403, 428 |
| `GET` | `/api/settlements` | Member | No | Query: `?workspace_id=...` | `200 { settlements: [] }` | 401, 403 |
| `POST` | `/api/settlements` | Admin | No | `{ contract_id, gross_revenue_minor, period_start, period_end }` | `201 { settlement }` | 400, 401, 403 |
| `GET` | `/api/settlements/:id` | Member | No | URL Param: `id` | `200 { settlement, allocations }` | 401, 403, 404 |
| `POST` | `/api/settlements/:id/calculate` | Admin | No | None | `200 { status: 'CALCULATED', allocations: [] }` | 400, 401, 403, 422 |
| `POST` | `/api/settlements/:id/commit` | Admin | Yes | None | `200 { status: 'APPROVED', payout_count }` | 401, 403, 428, 409 |
| `POST` | `/api/settlements/:id/void` | Admin | Yes | `{ reason }` | `200 { status: 'VOIDED' }` | 401, 403, 428 |
| `GET` | `/api/payouts` | Member | No | Query: `?settlement_id=...` | `200 { payouts: [] }` | 401, 403 |
| `POST` | `/api/payouts/execute` | Admin | Yes | `{ settlement_id }` | `202 { batch_id, status: 'RESERVED' }` | 400, 401, 403, 428 |
| `GET` | `/api/payouts/:id` | Member | No | URL Param: `id` | `200 { payout }` | 401, 403, 404 |
| `POST` | `/api/payouts/:id/retry` | Admin | Yes | None | `202 { retry_queued: true }` | 401, 403, 428 |
| `GET` | `/api/invoices` | Member | No | Query: `?workspace_id=...` | `200 { invoices: [] }` | 401, 403 |
| `POST` | `/api/invoices` | Admin | No | `{ settlement_id, amount_minor, recipient_email }` | `201 { invoice, paypal_id }` | 400, 401, 403 |
| `GET` | `/api/invoices/:id` | Member | No | URL Param: `id` | `200 { invoice }` | 401, 403, 404 |
| `POST` | `/api/invoices/:id/send` | Admin | Yes | None | `200 { sent: true }` | 401, 403, 428 |
| `POST` | `/api/invoices/:id/cancel` | Admin | Yes | `{ reason }` | `200 { cancelled: true }` | 401, 403, 428 |
| `POST` | `/api/webhooks/paypal` | PayPal | No | PayPal transmission headers + JSON body | `200 { received: true }` | 400, 401 |
| `GET` | `/api/audit` | Admin | Yes | Query: `?workspace_id=...&limit=50` | `200 { logs: [] }` | 401, 403, 428 |
| `POST` | `/api/audit/verify` | Admin | Yes | `{ workspace_id }` | `200 { valid: boolean, tampered_row_id }` | 401, 403, 428 |
| `GET` | `/api/system/health` | Public | No | None | `200 { status: 'healthy', timestamp }` | 503 |
| `GET` | `/api/system/live` | Public | No | None | `200 { live: true }` | None |
| `GET` | `/api/system/ready` | Public | No | None | `200 { db_ready: true, outbox_ready: true }` | 503 |
| `GET` | `/api/system/metrics` | Admin | Yes | None | `200 { memory_rss, uptime, outbox_depth }` | 401, 403, 428 |
| `GET` | `/api/recoupment/:contractId`| Member | No | URL Param: `contractId` | `200 { unrecouped_advance_minor, entries: [] }` | 401, 403 |
| `POST`| `/api/recoupment/:contractId/adjust` | Admin | Yes | `{ adjustment_minor, reason }` | `200 { new_balance_minor }` | 400, 401, 403, 428 |
| `GET` | `/api/dashboard/summary`| Member | No | Query: `?workspace_id=...` | `200 { gross_ytd, pending_payouts, active_contracts }` | 401, 403 |

---

## 6. Core Financial Math & Algorithms (`packages/core`)

### 6.1 Integer Minor Units & Basis Points
- Minor units represent whole cents ($1.00 = 100$, $\$125.50 = 12,550$).
- Basis points represent hundredths of a percent ($100.00\% = 10,000 \text{ bps}$, $1.00\% = 100 \text{ bps}$, $0.01\% = 1 \text{ bps}$).

### 6.2 Hare-Niemeyer Largest Remainder Allocation Formula
Implemented in `packages/core/money.ts`:
```typescript
export function allocateLargestRemainder(
  totalUnits: number,
  allocations: Array<{ recipientId: string; basisPoints: number }>
): Map<string, number> {
  const totalBps = allocations.reduce((sum, a) => sum + a.basisPoints, 0);
  if (totalBps !== 10000) {
    throw new Error(`Total basis points must equal 10000, received ${totalBps}`);
  }

  const result = new Map<string, number>();
  const remainders: Array<{ recipientId: string; remainder: number; index: number }> = [];

  let allocatedUnits = 0;

  for (let i = 0; i < allocations.length; i++) {
    const { recipientId, basisPoints } = allocations[i];
    const rawUnits = (totalUnits * basisPoints) / 10000;
    const floorUnits = Math.floor(rawUnits);
    const remainder = (totalUnits * basisPoints) % 10000;

    result.set(recipientId, floorUnits);
    allocatedUnits += floorUnits;
    remainders.push({ recipientId, remainder, index: i });
  }

  let undistributed = totalUnits - allocatedUnits;

  // Sort descending by remainder; break ties by stable original index
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let i = 0; i < undistributed; i++) {
    const recipientId = remainders[i].recipientId;
    result.set(recipientId, (result.get(recipientId) || 0) + 1);
  }

  return result;
}
```

### 6.3 Directed Acyclic Graph (DAG) 3-State Cycle Detection
Implemented in `packages/core/rules.ts`:
- Graph vertices ($V$): Rule entities. Directed edges ($E$): `parent_rule_id` references.
- DFS node state map: `0 = UNVISITED`, `1 = VISITING (In recursion stack)`, `2 = VISITED (Safe)`.
- When an adjacent vertex has state `1`, a directed cycle is present. Throws `CyclicDependencyError`. Time complexity: $O(V + E)$, Space complexity: $O(V)$.

---

## 7. Security Architecture & Implementations

### 7.1 Stateful Dual-Window Cookie Authentication
Set in `apps/api/src/services/auth.ts`:
1. `royaltyos_access`: Signed JWT containing `sub` (userId), `ws` (workspaceId), `exp`.
2. `royaltyos_refresh`: Cryptographically random 32-byte hex token.
3. `royaltyos_session_exp`: Absolute session window timestamp (Unix epoch, strict 7 days).
4. `royaltyos_idle_exp`: Sliding idle timeout timestamp (Unix epoch, strict 24 hours).
- **Cookie Security Flags:** `HttpOnly=true; Secure=true; SameSite=Lax; Path=/api`.
- **Validation Rule:** If `Date.now() > idle_exp` OR `Date.now() > session_exp`, the session is rejected (`HTTP 401`) and the session row in PostgreSQL is marked `revoked = true`.

### 7.2 Step-Up Authentication Protocol
Sensitive endpoints verify `session.step_up_until > Date.now()`.
- If expired or absent, API terminates execution with status code `428 Precondition Required`:
  `{ error: 'STEP_UP_REQUIRED', message: 'Re-authentication required for financial mutations' }`.
- Client calls `POST /api/auth/step-up` with password payload. On success, server sets `step_up_until = Date.now() + 15 * 60 * 1000` (15-minute validity window).

### 7.3 Multi-Tenant IDOR Guard (`authorizeByResource`)
Defined in `apps/api/src/services/auth.ts`:
```typescript
export async function authorizeByResource(
  table: string,
  resourceId: string,
  userId: string,
  requiredRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER'
): Promise<{ workspaceId: string }>
```
- Performs a SQL join between the resource table and `workspace_members`.
- Verifies `workspace_members.user_id = userId` AND `workspace_members.role` satisfies `requiredRole`. Throws `HTTP 403 Forbidden` if missing.

### 7.4 In-Memory Token Bucket Rate Limiter
Defined in `packages/security/rate-limiter.ts`:
- Buckets keyed by `${ip}:${endpoint_scope}`.
- Auth endpoints: 5 tokens, refill rate 1 token / 180s.
- Financial endpoints: 30 tokens, refill rate 1 token / 2s.
- Over-limit requests return `HTTP 429 Too Many Requests` with `Retry-After` header.

### 7.5 Secret Storage with AES-256-GCM
Defined in `packages/security/vault.ts`:
- Key: 32 bytes (`VAULT_MASTER_KEY`).
- Initialization Vector: 12 bytes (`node:crypto.randomBytes(12)`).
- Output structure: `{ v: 1, iv: "hex", tag: "hex", data: "hex" }`.
- Decryption validates the 16-byte authentication tag; tampered ciphertext throws `AuthenticationTagMismatchError`.

---

## 8. Payment & Invoicing Integration (`packages/paypal`)

### 8.1 Payout Idempotency Key Format
Defined in `packages/paypal/idempotency.ts`:
```
payout:<workspaceId>:<settlementId>:v<version>
```
- Example: `payout:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d:e8a3a2a1-0000-4000-8000-111122223333:v1`
- PayPal Payouts API enforces idempotency on this header. Duplicate submissions with identical keys return the original batch payload without re-executing disbursement.

### 8.2 Webhook Signature Verification
Defined in `packages/paypal/webhooks.ts`:
- PayPal headers extracted: `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`.
- Validates transmission time is within 600 seconds of local clock.
- Validates `PAYPAL-CERT-URL` originates from trusted domain `api.paypal.com` or `api.sandbox.paypal.com`.
- Downloads PEM public certificate and verifies SHA-256 with RSA signature against raw payload.

---

## 9. AI Contract Extraction & Guardrails (`packages/ai`)

### 9.1 Multi-Layered Validation Pipeline
```
Raw PDF Upload -> ClamAV Stream Scan -> Text Extraction -> OpenAI Responses API
     |
     v
[Layer 1] JSON Schema Strict Mode (response_format: { type: 'json_schema', strict: true })
     |
     v
[Layer 2] Regex Ground-Truth Cross-Check (extractAdvanceMinor())
     |
     v
[Layer 3] Semantic Discrepancy Gate (Rejects 10x order-of-magnitude hallucinations)
     |
     v
[Layer 4] Automated Repair Prompt Retry (1 retry allowed on discrepancy)
     |
     v
[Layer 5] Human-In-The-Loop Approval (Rules saved in REVIEW_REQUIRED status)
```

### 9.2 Regex Ground-Truth Extractor
`extractAdvanceMinor()` scans contract text with regex patterns matching currency definitions (e.g., `/(?:advance|upfront|pre-payment)[^$0-9]*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i`).
If regex detects `$5,000` (500,000 cents) while the LLM emits `$50,000` (5,000,000 cents), Layer 3 rejects the extraction.

---

## 10. Background Processing & Transactional Outbox

### 10.1 Outbox Poller Execution Cycle
Defined in `apps/api/src/services/outbox.ts`:
```sql
SELECT id, workspace_id, event_type, payload, retry_count
FROM outbox_events
WHERE status = 'PENDING' AND next_retry_at <= NOW()
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
```
1. Worker queries pending rows with `FOR UPDATE SKIP LOCKED`.
2. Marks selected rows as `status = 'PROCESSING'`.
3. Dispatches job based on `event_type`:
   - `PAYOUT_DISBURSEMENT`: Calls `packages/paypal/payouts.ts`.
   - `INVOICE_SYNC`: Calls `packages/paypal/invoices.ts`.
   - `AUDIT_CHECKPOINT`: Recomputes Merkle tree anchor.
   - `NOTIFICATION_SEND`: Calls `apps/api/src/services/notifications.ts`.
4. On success: sets `status = 'COMPLETED'`, `processed_at = NOW()`.
5. On failure: increments `retry_count`. If `retry_count < 5`, calculates exponential backoff ($2^{\text{retry\_count}} \times 1000\text{ms}$) and sets `next_retry_at`. If `retry_count >= 5`, transitions to `status = 'DEAD_LETTER'`.

---

## 11. Client Architecture (`apps/web`)

- Single Page Application (SPA) with zero build tools; raw ES modules imported in `apps/web/src/index.html`.
- State Management: Central reactive store `state = { user, workspace, route, cache }`.
- Cold-Start Gateway Interceptor in `apiFetch()`:
  - Listens for HTTP statuses `502`, `503`, `504` and `TypeError: Failed to fetch`.
  - Emits UI banner: "Waking up secure server...".
  - Retries request up to 4 times with exponential backoff: $t_{\text{wait}} = 2^k \times 1000\text{ms} + \text{jitter}$ ($k \in \{0, 1, 2, 3\}$).
  - Bypasses retries on `4xx` and `500 Internal Server Error`.

---

## 12. Build, Deployment & Infrastructure Specifications

- **Containerization:** `Dockerfile` multi-stage build.
  - Stage 1 (`build`): Node 22-slim, pnpm install, `pnpm run build` (TypeScript compilation to `dist/`).
  - Stage 2 (`runtime`): Node 22-slim, production dependencies only, non-root user `node`.
- **Render Blueprints:**
  - `render.yaml`: Single unified container hosting both API server and client static assets.
  - `render.paid.yaml`: Split infrastructure into 3 services:
    1. `royaltyos-api`: Web service (`node dist/apps/api/src/server.js`).
    2. `royaltyos-worker`: Background worker (`node dist/apps/api/src/worker.js`).
    3. `royaltyos-web`: Static CDN hosting `apps/web/src/`.
- **Boot Migration Guarantee:**
  - On process boot, `apps/api/src/services/database.ts` executes `ensureDatabaseMigrations()`.
  - Acquires PostgreSQL connection-level advisory lock `19840301`.
  - Runs pending migration files sequentially.
  - Fails closed (`process.exit(1)`) on migration failure unless explicitly bypassed with `SKIP_BOOT_MIGRATIONS=true`.

---

## 13. System-Wide Integration Contracts & Technical Connections

This section details the exact technical plumbing, interfaces, data formats, state transitions, and error-handling mechanics bridging all modules.

---

### Connection 1: Client SPA (`apps/web`) $\longleftrightarrow$ API Transport (`apps/api`)

#### Protocol & Transport
- **Wire Protocol:** HTTPS / HTTP/1.1 JSON REST.
- **Client Fetch Wrapper:** `apiFetch(endpoint, options)` in `apps/web/src/app.js`.
- **Request Headers Sent:**
  - `Content-Type: application/json`
  - `Accept: application/json`
- **Credentials:** `credentials: 'include'` (browser automatically attaches HttpOnly cookies).

#### Cookie Handshake & Session Synchronization
- On successful `POST /api/auth/login`, API emits response headers:
  ```http
  Set-Cookie: royaltyos_access=<jwt>; Path=/api; HttpOnly; Secure; SameSite=Lax
  Set-Cookie: royaltyos_refresh=<hex>; Path=/api; HttpOnly; Secure; SameSite=Lax
  Set-Cookie: royaltyos_session_exp=<unix_ms>; Path=/api; HttpOnly; Secure; SameSite=Lax
  Set-Cookie: royaltyos_idle_exp=<unix_ms>; Path=/api; HttpOnly; Secure; SameSite=Lax
  ```
- The client cannot read these tokens via JavaScript (`document.cookie` is empty).
- The client maintains internal state `state.user` populated exclusively from response JSON.

#### Gateway Cold-Start Retry Loop
```
Client apiFetch() -> HTTP 502/503/504
  |-> Interceptor traps status
  |-> Displays banner: "Waking up server..."
  |-> Delay: backoff = (1000 * 2^attempt) + random(0, 500) ms
  |-> Re-issue fetch()
  |-> Maximum 4 attempts
  |-> If 200 OK: dismisses banner, returns payload
  |-> If exhausted: emits UI error "Server unavailable"
```

#### Step-Up Authentication Handshake
```
1. Client calls POST /api/settlements/commit
2. Server executes requireStepUp() middleware
3. If session.step_up_until < Date.now():
     Server returns HTTP 428 Precondition Required
     Body: { "error": "STEP_UP_REQUIRED", "message": "Re-authentication required" }
4. Client apiFetch() detects status 428
5. Client pauses original request Promise in memory
6. Client displays modal asking user for password
7. User submits password -> POST /api/auth/step-up
8. Server verifies password -> Updates session.step_up_until -> Returns 200 OK
9. Client resolves paused Promise -> Re-dispatches POST /api/settlements/commit
10. Server verifies step-up validity -> Executes settlement commit -> Returns 200 OK
```

---

### Connection 2: Auth Middleware $\longleftrightarrow$ Session Store $\longleftrightarrow$ Step-Up State Machine

#### Internal Middleware Chain (`apps/api/src/services/auth.ts`)
```
Incoming Request -> parseCookies(req)
  |-> Check royaltyos_access cookie
  |-> If absent -> Return 401 Unauthorized
  |-> Verify JWT signature via HMAC-SHA256 (JWT_SECRET)
  |-> If expired:
        |-> Check royaltyos_refresh cookie
        |-> Query sessions table by refresh_token_hash
        |-> If valid -> Issue new access token, update cookies, continue
        |-> If invalid -> Return 401 Unauthorized
  |-> Check dual-window clocks:
        |-> If Date.now() > session_exp -> Invalidate, return 401
        |-> If Date.now() > idle_exp -> Invalidate, return 401
  |-> Slide idle window: Update royaltyos_idle_exp = Date.now() + 24*3600*1000
  |-> Attach req.session = { userId, workspaceId, stepUpUntil }
  |-> Continue to route handler
```

---

### Connection 3: Contract Ingestion $\longleftrightarrow$ ClamAV Daemon $\longleftrightarrow$ OpenAI Responses API

#### Flow: `POST /api/contracts/upload`
1. **Body Streaming & Buffering:**
   - Server reads incoming multipart stream up to 25MB (`MAX_UPLOAD_SIZE = 26214400`).
   - Magic byte verification: first 4 bytes must match `%PDF` (`0x25, 0x50, 0x44, 0x46`). If invalid, abort with `HTTP 415 Unsupported Media Type`.
2. **ClamAV Antivirus TCP Streaming:**
   - Server opens raw TCP socket to `CLAMAV_HOST:CLAMAV_PORT` (default `127.0.0.1:3310`).
   - Dispatches ClamD `zINSTREAM` command.
   - Streams buffer in chunks preceded by 4-byte big-endian chunk length.
   - ClamD returns response: `stream: OK` or `stream: <virus_name> FOUND`.
   - If infected: connection destroyed, file deleted, returns `HTTP 400 Bad Request { error: 'MALWARE_DETECTED' }`.
   - If daemon fails in production: throws `SecurityScanUnavailableError`, returns `HTTP 503 Service Unavailable` (fail-closed).
3. **Database Insertion:**
   - Contract record inserted into `contracts` table with `status = 'UPLOADED'`.
4. **Trigger AI Extraction (`POST /api/contracts/:id/extract`):**
   - Reads raw text from stored contract.
   - Calls `extractContractWithOpenAI(contractText)` in `packages/ai/openai-contract.ts`.

---

### Connection 4: AI Extraction $\longleftrightarrow$ Semantic Guardrail Gate $\longleftrightarrow$ Ruleset Storage

#### Extraction Plumbing (`packages/ai/openai-contract.ts`)
1. **Schema Definition:**
   - Passes strict JSON Schema defining contract properties: `parties`, `advance_amount_minor`, `effective_date`, `rules: [{ recipient_name, basis_points, split_type }]`.
2. **OpenAI API Request:**
   - Model: `gpt-4o`.
   - Input structure: XML-isolated system prompt:
     ```
     <contract_text>
     ${sanitizedContractText}
     </contract_text>
     ```
   - Instructs model: content inside XML tags is pure untrusted data, never executable system instructions (prompt injection mitigation).
3. **Ground-Truth Regex Cross-Check:**
   - Server executes `extractAdvanceMinor(sanitizedContractText)` using regex patterns.
   - Regex produces ground-truth advance: $A_{\text{regex}}$.
   - OpenAI output produces extracted advance: $A_{\text{llm}}$.
   - If $|A_{\text{llm}} - A_{\text{regex}}| / A_{\text{regex}} > 0.5$ (discrepancy $> 50\%$):
     - Layer 3 semantic gate triggers.
     - Automatically issues repair prompt to OpenAI:
       ```
       "Discrepancy detected: Extracted advance $A_llm differs from textual evidence $A_regex. Re-extract and verify against line items."
       ```
     - If second extraction still diverges, advances are held as `REVIEW_REQUIRED`.
4. **Ruleset Persistence:**
   - Extracted terms are written to `rulesets` and `rules` tables with `status = 'REVIEW_REQUIRED'`.
   - Ruleset is NOT active and cannot calculate settlements until an administrator explicitly reviews and approves it.

---

### Connection 5: Rule Compiler $\longleftrightarrow$ DAG Cycle DFS Engine $\longleftrightarrow$ Active Ruleset

#### Compilation Plumbing (`packages/core/rules.ts`)
1. **Input:** Candidate rules from `rules` table for a specific `ruleset_id`.
2. **Pre-Condition Validation:**
   - Sum of top-level `basis_points` must equal exactly $10,000$ bps.
   - Every rule's `basis_points` must be integer $> 0$.
3. **Graph Construction:**
   - Maps parent-child relationships where `rule.parent_rule_id` denotes derivative splits (e.g., Producer gets 2000 bps of Artist's 5000 bps share).
4. **Cycle Detection (DFS Algorithm):**
   ```
   For each node in rule graph:
     If node is UNVISITED:
       call dfs(node)

   dfs(node):
     node.state = VISITING (1)
     For each child in node.children:
       If child.state == VISITING (1):
         throw CyclicDependencyError("Cycle detected at rule " + child.id)
       If child.state == UNVISITED (0):
         dfs(child)
     node.state = VISITED (2)
   ```
5. **Ruleset Activation:**
   - On clean DFS completion, compiler computes SHA-256 hash of compiled rule AST.
   - Server updates `rulesets.status = 'ACTIVE'`, deprecating prior active versions.

---

### Connection 6: Settlement Engine $\longleftrightarrow$ Recoupment Ledger $\longleftrightarrow$ Largest Remainder Math

#### Calculation Flow (`apps/api/src/services/settlements.ts`)
1. **Input:** `settlement_id`, `gross_revenue_minor`.
2. **Active Ruleset Query:** Retrieves active rules for contract.
3. **Off-The-Top Deduction:**
   - Fixed expenses deducted first: `net_distributable_minor = gross_revenue_minor - off_the_top_expenses_minor`.
4. **Hare-Niemeyer Split:**
   - Passes `net_distributable_minor` and `activeRules` into `allocateLargestRemainder()`.
   - Receives deterministic `Map<recipientId, gross_share_minor>`.
5. **Recoupment Deduction State Machine:**
   - Queries `recoupment_ledger` for each recipient: retrieves `unrecouped_advance_minor`.
   - For each recipient:
     ```typescript
     const unrecouped = ledger.unrecouped_advance_minor;
     const gross = allocationMap.get(recipient.id);

     let recoupedAmount = 0;
     let netPayable = 0;

     if (unrecouped > 0) {
       if (gross <= unrecouped) {
         recoupedAmount = gross;
         netPayable = 0;
       } else {
         recoupedAmount = unrecouped;
         netPayable = gross - unrecouped;
       }
     } else {
       recoupedAmount = 0;
       netPayable = gross;
     }
     ```
6. **Integrity Invariant Check:**
   $$\sum \text{gross} = \text{net\_distributable}$$
   $$\sum (\text{netPayable} + \text{recoupedAmount}) = \text{net\_distributable}$$
7. **Write Draft Allocations:**
   - Allocations written to `settlement_allocations` table.
   - Settlement status set to `CALCULATED`.

---

### Connection 7: Settlement Commit $\longleftrightarrow$ PostgreSQL Transaction $\longleftrightarrow$ Outbox Event Enqueue

#### Transaction Boundary (`supabase/migrations/20260330000005_settlement_commit.sql`)
The commit operation bridges financial balance mutation and background event emission within a single ACID transaction:
```sql
BEGIN;
  -- 1. Lock settlement row
  SELECT * FROM settlements WHERE id = p_settlement_id FOR UPDATE;

  -- 2. Verify status is CALCULATED
  -- 3. Verify financial integrity check procedure

  -- 4. Update recoupment balances in recoupment_ledger
  UPDATE recoupment_ledger r
  SET unrecouped_advance_minor = unrecouped_advance_minor - sa.recouped_amount_minor,
      last_updated_at = NOW()
  FROM settlement_allocations sa
  WHERE sa.settlement_id = p_settlement_id
    AND sa.recipient_id = r.recipient_id
    AND sa.recouped_amount_minor > 0;

  -- 5. Insert payouts for non-zero recipients
  INSERT INTO payouts (id, settlement_id, recipient_id, amount_minor, status, version)
  SELECT gen_random_uuid(), p_settlement_id, recipient_id, net_payable_minor, 'PENDING', 1
  FROM settlement_allocations
  WHERE settlement_id = p_settlement_id AND net_payable_minor > 0;

  -- 6. Insert Transactional Outbox Event
  INSERT INTO outbox_events (id, workspace_id, event_type, payload, status, retry_count, next_retry_at)
  VALUES (
    gen_random_uuid(),
    v_workspace_id,
    'SETTLEMENT_COMMITTED',
    json_build_object('settlement_id', p_settlement_id, 'actor_id', p_actor_id),
    'PENDING',
    0,
    NOW()
  );

  -- 7. Update settlement status
  UPDATE settlements SET status = 'APPROVED' WHERE id = p_settlement_id;

  -- 8. Append chained audit log entry
  -- (Audit hash chaining trigger fires automatically)

COMMIT;
```

---

### Connection 8: Outbox Worker Poller $\longleftrightarrow$ `SKIP LOCKED` $\longleftrightarrow$ PayPal Payouts Client

#### Poller Dispatch Loop (`apps/api/src/services/outbox.ts`)
```
Worker Timer (every 5000ms)
  |-> Connect to PostgreSQL
  |-> BEGIN Transaction
  |-> SELECT * FROM outbox_events WHERE status = 'PENDING' FOR UPDATE SKIP LOCKED LIMIT 50
  |-> UPDATE outbox_events SET status = 'PROCESSING' WHERE id IN (...)
  |-> COMMIT
  |-> For each event:
        |-> If event_type == 'SETTLEMENT_COMMITTED':
              |-> Query pending payouts for settlement
              |-> For each payout:
                    |-> Call reservePayout(payout.id) -> Stored procedure locks row
                    |-> Call PayPal Payouts API (packages/paypal/payouts.ts)
                    |-> If HTTP 201 Created:
                          |-> Update payout: status = 'PROCESSING', paypal_batch_id
                    |-> If HTTP error:
                          |-> Update payout: status = 'FAILED', error_code
        |-> Mark outbox_event as 'COMPLETED'
```

---

### Connection 9: Payout Reservation $\longleftrightarrow$ Stored Procedure $\longleftrightarrow$ Distributed Idempotency Key

#### Double-Spend Defense Architecture
1. **Idempotency Key Construction:**
   - `buildPayoutIdempotencyKey(workspaceId, settlementId, version)` produces:
     `payout:<workspaceId>:<settlementId>:v<version>`.
2. **Database State Reservation:**
   - `royaltyos_reserve_payout(payout_id, idempotency_key)` executes in PostgreSQL before any outbound network call.
   - The stored procedure verifies status is `PENDING`, updates to `RESERVED`, and commits.
3. **Outbound PayPal API Call:**
   - Dispatches `POST /v1/payments/payouts` with HTTP Header:
     `PayPal-Request-Id: payout:<workspaceId>:<settlementId>:v<version>`.
4. **Crash Recovery Scenario:**
   - If server crashes during network call, payout record remains `RESERVED`.
   - On worker reboot, poller re-dispatches the exact same idempotency key.
   - PayPal recognizes duplicate key, suppresses secondary disbursement, and returns original transaction metadata.

---

### Connection 10: Invoicing $\longleftrightarrow$ PayPal REST API $\longleftrightarrow$ Webhook Ingestion $\longleftrightarrow$ Reconciliation

#### Flow: Client Invoicing & Payment Settlement
1. **Create Invoice (`POST /api/invoices`):**
   - Calls PayPal Invoicing API (`/v2/invoicing/invoices`).
   - Obtains `paypal_invoice_id`. Saves record in `invoices` table (`status = 'DRAFT'`).
2. **Dispatch Invoice (`POST /api/invoices/:id/send`):**
   - Dispatches via PayPal. Status transitions to `SENT`.
3. **Client Pays Invoice on PayPal:**
   - PayPal issues `INVOICING.INVOICE.PAID` webhook to `POST /api/webhooks/paypal`.
4. **Webhook Verification & Storage:**
   - Webhook route verifies headers and signature.
   - Inserts row into `webhook_events` (`transmission_id` uniqueness protects against replay).
   - Responds `HTTP 200 OK` to PayPal in under 50ms.
5. **Asynchronous Outbox Reconciliation:**
   - Outbox worker picks up webhook event.
   - Updates `invoices.status = 'PAID'`.
   - Transitions associated settlement from `AWAITING_FUNDS` to `READY_FOR_SETTLEMENT`.

---

### Connection 11: Audit Middleware $\longleftrightarrow$ Merkle Hash Chain Generator $\longleftrightarrow$ Tamper Verification RPC

#### Hash Chaining Mechanism (`supabase/migrations/20260330000003_audit_chains.sql`)
1. **Insert Trigger on `audit_logs`:**
   - When any row is inserted into `audit_logs`:
     ```sql
     -- 1. Fetch previous hash for this workspace
     SELECT entry_hash INTO v_prev_hash
     FROM audit_logs
     WHERE workspace_id = NEW.workspace_id
     ORDER BY created_at DESC LIMIT 1;

     -- If no previous row, use static 64-char zero genesis hash
     IF v_prev_hash IS NULL THEN
       v_prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
     END IF;

     -- 2. Bind previous_hash
     NEW.previous_hash := v_prev_hash;

     -- 3. Compute entry_hash via SHA-256
     NEW.entry_hash := encode(digest(
       NEW.previous_hash || NEW.action || NEW.payload::text || NEW.created_at::text,
       'sha256'
     ), 'hex');
     ```
2. **Verification RPC (`royaltyos_verify_audit_chain`):**
   - Called via `POST /api/audit/verify`.
   - Scans rows sequentially.
   - If any `entry_hash` does not equal `sha256(previous_hash || action || payload || created_at)`, returns `valid = false` and `tampered_row_id = id`.

---

### Connection 12: Boot Runner $\longleftrightarrow$ PostgreSQL Advisory Lock $\longleftrightarrow$ Schema Migration Suite

#### Boot Safety Lifecycle (`apps/api/src/services/database.ts`)
1. **API Server Starts (`server.ts`):**
   - Executes `await ensureDatabaseMigrations()`.
2. **Advisory Lock Acquisition:**
   - Opens direct session connection to PostgreSQL on port 5432.
   - Executes: `SELECT pg_try_advisory_lock(19840301);`.
   - If `false` (another replica is currently migrating): polls with 1000ms delay until lock is released.
3. **Migration Execution:**
   - Queries `schema_migrations` table for executed filenames.
   - Reads `.sql` files from `supabase/migrations/` in ascending alphabetical order.
   - Executes pending files sequentially inside individual transactions.
   - Records completed filename in `schema_migrations`.
4. **Advisory Lock Release:**
   - Executes: `SELECT pg_advisory_unlock(19840301);`.
5. **Fail-Closed Guarantee:**
   - If any migration fails, Node.js logs error to stderr and calls `process.exit(1)`. The container halts immediately, preventing execution against an invalid schema.

---

### Connection 13: Error Handling & Cold-Start Gateway Interceptor Loop

#### Cross-Layer Error Codes & Status Propagation
| Error Class | Originating Layer | HTTP Status | Response Payload | Client Interceptor Action |
| :--- | :--- | :--- | :--- | :--- |
| **Proxy Cold Start** | Render Gateway | `502 / 503 / 504` | HTML / Gateway timeout | Displays "Waking up server..."; executes exponential backoff retry. |
| **Rate Limit Exceeded** | `packages/security` | `429` | `{ error: 'TOO_MANY_REQUESTS', retry_after: N }` | Renders countdown banner; blocks input for $N$ seconds. |
| **Session Expired** | `apps/api/auth` | `401` | `{ error: 'UNAUTHORIZED', code: 'SESSION_EXPIRED' }` | Clears local user state; redirects to `/login`. |
| **Step-Up Required** | `apps/api/auth` | `428` | `{ error: 'STEP_UP_REQUIRED' }` | Pauses transaction; triggers password modal; retries on success. |
| **IDOR Access Denied** | `apps/api/auth` | `403` | `{ error: 'FORBIDDEN', message: 'Unauthorized resource' }` | Renders access denied alert; routes to dashboard. |
| **Cyclic Rule Graph** | `packages/core` | `422` | `{ error: 'CYCLIC_DEPENDENCY', cycle: [...] }` | Highlights offending split rules in contract editor. |
| **Malware Detected** | `packages/security` | `400` | `{ error: 'MALWARE_DETECTED', signature: '...' }` | Aborts upload; alerts user. |
| **Database Lock Wait** | Supabase PostgreSQL | `409` | `{ error: 'CONFLICT', message: 'Resource locked' }` | Prompts user to retry concurrent action. |

---

*End of Technical Knowledge Base & System Specification.*
