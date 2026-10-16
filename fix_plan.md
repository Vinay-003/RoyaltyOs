# RoyaltyOS Comprehensive Fix & Enhancement Plan

> **Document Version:** 1.0.0  
> **Date:** October 16, 2026  
> **Status:** Draft / Actionable Plan  
> **Scope:** Full-system upgrade addressing complex/arbitrary contract handling, rule engine gaps, AI extraction limitations, API robustness, security, testing, CI/CD, and deployment infrastructure.

---

## Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Root Cause Analysis of Current Limitations](#2-root-cause-analysis-of-current-limitations)
3. [Taxonomy of Complex Contract Scenarios ("The Random Contracts")](#3-taxonomy-of-complex-contract-scenarios-the-random-contracts)
4. [Architecture & Design: Extending the Rule Engine](#4-architecture--design-extending-the-rule-engine)
5. [Architecture & Design: Extending AI Extraction](#5-architecture--design-extending-ai-extraction)
6. [Audit Findings & Unattended Issues (System-Wide)](#6-audit-findings--unattended-issues-system-wide)
7. [Phase-by-Phase Implementation Plan](#7-phase-by-phase-implementation-plan)
8. [Testing Strategy & Pre-Commit Verification Gate](#8-testing-strategy--pre-commit-verification-gate)
9. [GitHub Actions CI/CD Pipeline](#9-github-actions-cicd-pipeline)
10. [Rollback, Migration Safety & Deployment Checklist](#10-rollback-migration-safety--deployment-checklist)
11. [Risk Matrix & Mitigation Strategies](#11-risk-matrix--mitigation-strategies)

---

## 1. Executive Summary & Problem Statement

### 1.1 The Problem
RoyaltyOS currently operates on a **closed rule vocabulary of 11 primitive types** (`PERCENTAGE`, `FIXED_AMOUNT`, `RECOUPMENT`, `CAP`, `FLOOR`, `EXCLUSION`, `RESERVE`, `PRIORITY`, `THRESHOLD`, `DATE_RANGE`, `REVENUE_CATEGORY`). The settlement engine is **stateless per revenue event** (evaluating only the single transaction passed in `ctx.revenueMinor`), with the sole exception of `RecoupmentState` which tracks advance debt balances.

Real-world legal agreements routinely contain clauses that violate these assumptions:
- **Cumulative Earnings Escalations:** *"10% until $20,000 total cumulative earnings, then 15% thereafter."*
- **Marginal Tranche Splits:** When a single settlement event crosses an earnings threshold, the portion below must be calculated at rate $A$ and the portion above at rate $B$.
- **Retroactive Rate Escalations:** *"Once cumulative earnings exceed $100,000, all prior earnings for the year are re-calculated at 18%."*
- **Cross-Contract / Cross-Beneficiary Recoupment (Cross-Collateralization):** *"Album 2 advances may be recouped from Album 1 royalties if Album 1 is in profit."*
- **Time-Decaying Splits:** *"50% for Year 1, 40% for Year 2, 30% for Year 3, 20% in perpetuity."*
- **Nested / Hierarchical Derivative Splits:** *"Producer receives 20% of Artist's 50% share, minus 50% of mastering costs."*
- **Performance-Gated Splits:** *"Rate increases from 12% to 16% if stream count exceeds 1,000,000 in a quarter."*
- **Currency-Specific Minimum Guarantees:** *"EUR revenue must yield at least €1,000/quarter regardless of USD exchange rates."*

### 1.2 The Goal
Extend RoyaltyOS so that it can **accurately represent, extract, validate, compile, and execute ANY legal contract structure** without compromising the Golden Architectural Invariant:

```
AI interprets contracts. Deterministic software calculates money.
Humans authorize high-impact actions. PayPal moves the money.
```

The system must **never** allow an LLM to generate or execute arbitrary code. Every contract structure must compile into a **deterministic, strongly typed, mathematically verifiable AST** executed by the core settlement engine.

---

## 2. Root Cause Analysis of Current Limitations

### 2.1 Limitation 1: Closed Rule Type Enum
- **Location:** `packages/core/types.ts:1–13`
- **Issue:** `RULE_TYPES` contains only 11 types. Any contract clause that cannot be mapped to these 11 types must be marked `UNSUPPORTED`.
- **Impact:** `packages/core/ruleset-compiler.ts:19` explicitly throws:
  ```typescript
  if (candidate.type === "UNSUPPORTED") throw new Error(`Unsupported rule ${candidate.id} cannot compile`);
  ```
  The compiler fails-closed, completely blocking activation of contracts containing non-standard clauses.

### 2.2 Limitation 2: Stateless Single-Event Settlement Engine
- **Location:** `packages/core/settlement-engine.ts:124–136`
- **Issue:** `calculateSettlement(ctx, rules, recoupments)` receives only:
  - `ctx: RevenueContext` — Single event's `revenueMinor`, `currency`, `category`, `occurredAt`.
  - `rules: ExecutableRule[]` — Static rule list.
  - `recoupments: RecoupmentState[]` — Advance debt balances only.
- **Impact:** The engine has **no memory of prior settlements**. It cannot answer: "How much has Beneficiary X earned to date across all historical settlements?"

### 2.3 Limitation 3: `THRESHOLD` Modifier Is Event-Level, Not Cumulative
- **Location:** `packages/core/settlement-engine.ts:110–115`
- **Issue:**
  ```typescript
  if (rule.type === "THRESHOLD") {
    const threshold = rule.fixedMinor ?? numberConfig(rule, "thresholdMinor") ?? 0;
    const mode = stringConfig(rule, "mode") ?? "MIN_REVENUE";
    if (mode === "MIN_REVENUE" && remainingAvailable < threshold) amount = 0;
    if (mode === "MIN_PAYOUT" && amount < threshold) amount = 0;
  }
  ```
  The code only checks if the *current event's* distributable pool or calculated payout exceeds a threshold. It is a per-event minimum cutoff, not a cumulative revenue meter.

### 2.4 Limitation 4: Closed AI Extraction Schema
- **Location:** `packages/ai/openai-contract.ts:35–136`
- **Issue:** `contractSchema.properties.rules.items.properties.config` sets `additionalProperties: false` and lists a closed set of 15 property names.
- **Impact:** The OpenAI model **cannot** emit fields like `tiers[]`, `cumulativeBasis`, `isRetroactive`, or `escalationThresholdMinor`. If it attempts to, OpenAI's Structured Outputs API rejects the response at the grammar-sampling level with a 400 Bad Request.

### 2.5 Limitation 5: No Marginal Tranche Bifurcation Math
- **Location:** `packages/core/settlement-engine.ts:245–248`
- **Issue:** `allocateLargestRemainder()` takes a single `baseMinor` and applies flat weights (`basisPoints`).
- **Impact:** There is no function `allocateTieredTranches(baseMinor, cumulativePrior, tiers)` that splits an incoming amount across rate boundaries ($E_{\text{prior}} \to \text{Threshold} \to E_{\text{new}}$).

---

## 3. Taxonomy of Complex Contract Scenarios ("The Random Contracts")

To ensure the new architecture handles *every* contract type, we categorize real-world complex contract patterns into 8 distinct paradigms:

| Paradigm | Example Clause | Mathematical Model | Required Engine Capability |
|---|---|---|---|
| **P1: Cumulative Escalation (Marginal)** | *"10% on first $20k, 15% thereafter."* | Piecewise marginal: $\sum \Delta E_i \times r_i$ | Cumulative ledger + tranche splitting |
| **P2: Cumulative Escalation (Retroactive)** | *"10% initially. If year-to-date revenue hits $50k, rate becomes 15% on ALL revenue for the year."* | Step function with true-up credit: $E_{\text{total}} \times r_{\text{new}} - \text{Paid}_{\text{prior}}$ | Historical recalculation + adjustment lines |
| **P3: Cross-Collateralization** | *"Recoup $10k advance from Album A OR Album B royalties."* | Shared debt pool: $\min(D_{\text{shared}}, R_A + R_B)$ | Cross-contract recoupment ledger |
| **P4: Nested / Derivative Splits** | *"Producer gets 15% of Artist's 60% share, after deducting 50% of mastering."* | Hierarchical DAG with intermediate nodes: $(R \times r_{\text{parent}} - D) \times r_{\text{child}}$ | Arbitrary DAG depth + sub-pool allocation |
| **P5: Time-Decaying / Step-Down Splits** | *"50% Year 1, 35% Year 2, 20% perpetuity."* | Time-parameterized rate: $r(t) = \text{rateForDate}(t)$ | Date-bracketed percentage rules |
| **P6: Dual-Threshold (AND/OR Conditions)** | *"15% if revenue > $10k AND occurred before Dec 2026, ELSE 10%."* | Boolean logic trees on rule activation | Composite condition evaluator (`AND`, `OR`, `NOT`) |
| **P7: Multi-Currency Guarantees** | *"12% with minimum €500/settlement, paid in USD at spot rate."* | FX conversion + currency floor: $\max(R_{\text{USD}} \times r, \text{Floor}_{\text{EUR}} \times \text{FX})$ | Settlement-time FX rate snapshot |
| **P8: Performance / External Metric Gated** | *"Rate jumps to 20% if streams exceed 5,000,000."* | Metric-conditioned rate: $r(M) = M \ge T ? r_2 : r_1$ | External metric input in `RevenueContext` |

---

## 4. Architecture & Design: Extending the Rule Engine

### 4.1 New Rule Types

Add three new first-class rule types to `packages/core/types.ts`:

```typescript
export const RULE_TYPES = [
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "RECOUPMENT",
  "CAP",
  "FLOOR",
  "EXCLUSION",
  "RESERVE",
  "PRIORITY",
  "THRESHOLD",
  "DATE_RANGE",
  "REVENUE_CATEGORY",
  // NEW TYPES:
  "TIERED_CUMULATIVE",      // Marginal or retroactive tiered escalation
  "DERIVATIVE_SPLIT",        // Nested split off a parent rule's output
  "COMPOSITE_CONDITION",     // Complex boolean logic (AND/OR/NOT) for rule activation
] as const;
```

### 4.2 Tiered Cumulative Rule Specification

```typescript
export type TierDefinition = {
  tierIndex: number;
  thresholdMinor: number | null; // null = infinity (the final tier)
  rateBasisPoints: number;       // The rate for this tier
  label?: string;                // e.g., "Tier 1: $0 - $20,000"
};

export type TieredCumulativeConfig = {
  beneficiaryKey: string;
  basis: "GROSS_REVENUE" | "NET_REVENUE" | "BENEFICIARY_EARNINGS";
  tiers: TierDefinition[];
  mode: "MARGINAL" | "RETROACTIVE";
  resetPeriod?: "NEVER" | "ANNUAL" | "QUARTERLY" | "MONTHLY";
  resetAnchorDate?: string;      // ISO date for annual reset anchor (e.g., "2026-01-01")
};
```

#### Tranche Splitting Algorithm (`packages/core/money.ts`):
```typescript
export type TrancheAllocation = {
  tierIndex: number;
  rateBasisPoints: number;
  applicableRevenueMinor: number;
  allocatedMinor: number;
};

export function allocateTieredTranches(
  eventRevenueMinor: number,
  priorCumulativeMinor: number,
  tiers: TierDefinition[],
): TrancheAllocation[] {
  let revenueRemaining = eventRevenueMinor;
  let currentCumulative = priorCumulativeMinor;
  const allocations: TrancheAllocation[] = [];

  for (const tier of tiers) {
    if (revenueRemaining <= 0) break;

    const tierCeiling = tier.thresholdMinor ?? Number.MAX_SAFE_INTEGER;
    if (currentCumulative >= tierCeiling) {
      // Prior earnings already exceeded this tier, skip to next
      continue;
    }

    // How much headroom remains in this tier?
    const tierCapacity = tierCeiling - currentCumulative;
    const applicable = Math.min(revenueRemaining, tierCapacity);

    // Calculate allocation for this tranche using integer arithmetic
    const rawUnits = (applicable * tier.rateBasisPoints) / 10000;
    const allocatedMinor = Math.floor(rawUnits);

    allocations.push({
      tierIndex: tier.tierIndex,
      rateBasisPoints: tier.rateBasisPoints,
      applicableRevenueMinor: applicable,
      allocatedMinor,
    });

    revenueRemaining -= applicable;
    currentCumulative += applicable;
  }

  return allocations;
}
```

### 4.3 Derivative Split (Hierarchical Sub-Pools)

Allow rules to set `base: "PARENT_RULE"` with `targetRuleId: string`:

```typescript
// When base === "PARENT_RULE":
// 1. Parent rule calculates its line: amountMinor = $1,000
// 2. Child rule calculates: childAmount = floor(parentAmount * childBps / 10000)
// 3. Parent line amount is reduced by childAmount (or child is paid alongside)
// 4. DAG cycle detection guarantees acyclic hierarchy
```

### 4.4 Cumulative Earnings Ledger (Database + State)

#### New Database Table: `cumulative_earnings_ledger`
```sql
CREATE TABLE IF NOT EXISTS cumulative_earnings_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  beneficiary_key TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'BENEFICIARY_EARNINGS',
  cumulative_revenue_minor BIGINT NOT NULL DEFAULT 0,
  cumulative_earnings_minor BIGINT NOT NULL DEFAULT 0,
  period_anchor DATE,
  last_settlement_id UUID,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cumulative_ledger UNIQUE (contract_id, rule_id, beneficiary_key, period_anchor),
  CONSTRAINT chk_cumulative_revenue_nonneg CHECK (cumulative_revenue_minor >= 0),
  CONSTRAINT chk_cumulative_earnings_nonneg CHECK (cumulative_earnings_minor >= 0)
);

CREATE INDEX idx_cumulative_ledger_lookup
  ON cumulative_earnings_ledger(contract_id, beneficiary_key);
```

#### Settlement Engine Integration (`packages/core/settlement-engine.ts`):
Extend `calculateSettlement()` signature to accept cumulative state:

```typescript
export type CumulativeState = {
  ruleId: string;
  beneficiaryKey: string;
  cumulativeRevenueMinor: number;
  cumulativeEarningsMinor: number;
  periodAnchor: string | null;
};

export function calculateSettlement(
  ctx: RevenueContext,
  rules: ExecutableRule[],
  recoupments: RecoupmentState[],
  cumulatives: CumulativeState[] = [], // NEW PARAMETER (defaults to empty for backward compat)
): SettlementResult
```

### 4.5 Composite Conditions (Boolean Logic Trees)

Extend `RuleCondition` to support logical operators:

```typescript
export type CompositeCondition = {
  logic: "AND" | "OR" | "NOT";
  conditions: Array<RuleCondition | CompositeCondition>;
};
```

The evaluator in `settlement-engine.ts` recursively evaluates conditions, supporting arbitrarily complex criteria like:
`((category === 'STREAMING' AND revenue > 10000) OR (category === 'SYNC')) AND occurred_at >= '2026-01-01'`.

---

## 5. Architecture & Design: Extending AI Extraction

### 5.1 Updated Contract Extraction Schema (`packages/ai/openai-contract.ts`)

Update `contractSchema` to natively support the new rule types and configurations:

```typescript
// Add new rule types to enum
const RULE_TYPES = [
  "PERCENTAGE", "FIXED_AMOUNT", "RECOUPMENT", "CAP", "FLOOR",
  "EXCLUSION", "RESERVE", "PRIORITY", "THRESHOLD", "DATE_RANGE",
  "REVENUE_CATEGORY",
  // NEW:
  "TIERED_CUMULATIVE", "DERIVATIVE_SPLIT", "COMPOSITE_CONDITION",
  "UNSUPPORTED"
];

// Extend config schema:
properties: {
  config: {
    type: "object",
    additionalProperties: false,
    required: [
      "advanceMinor", "preRecoupmentBasisPoints", "postRecoupmentBasisPoints",
      "maxRecoupmentPerEventMinor", "category", "currency", "startDate", "endDate",
      "targetRuleId", "amountMinor", "capMinor", "floorMinor", "thresholdMinor",
      "mode", "priorityValue",
      // NEW REQUIRED CONFIG FIELDS (nullable for other rule types):
      "tiers", "cumulativeBasis", "tierMode", "resetPeriod", "parentRuleId"
    ],
    properties: {
      // ... existing fields ...
      tiers: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tierIndex", "thresholdMinor", "rateBasisPoints", "label"],
              properties: {
                tierIndex: { type: "integer", minimum: 0 },
                thresholdMinor: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
                rateBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
                label: { anyOf: [{ type: "string" }, { type: "null" }] }
              }
            }
          },
          { type: "null" }
        ]
      },
      cumulativeBasis: {
        anyOf: [
          { type: "string", enum: ["GROSS_REVENUE", "NET_REVENUE", "BENEFICIARY_EARNINGS"] },
          { type: "null" }
        ]
      },
      tierMode: {
        anyOf: [
          { type: "string", enum: ["MARGINAL", "RETROACTIVE"] },
          { type: "null" }
        ]
      },
      resetPeriod: {
        anyOf: [
          { type: "string", enum: ["NEVER", "ANNUAL", "QUARTERLY", "MONTHLY"] },
          { type: "null" }
        ]
      },
      parentRuleId: {
        anyOf: [{ type: "string" }, { type: "null" }]
      }
    }
  }
}
```

### 5.2 System Prompt Enhancement
Update the system prompt in `packages/ai/openai-contract.ts` with explicit few-shot examples for:
1. **Tiered cumulative clauses** (marginal vs retroactive).
2. **Derivative/producer splits** (`parentRuleId` referencing the artist's rule).
3. **Time-decaying agreements** (multiple `DATE_RANGE`-gated `PERCENTAGE` rules).
4. **Multi-condition clauses** (category + date + revenue threshold).

### 5.3 Semantic Guardrails for Tiered Rules
Add dedicated validation checks before accepting extracted tiered rules:
1. **Tier Ordering Invariant:** Tiers must be ordered with strictly increasing `thresholdMinor` values.
2. **Final Tier Nullability:** The last tier's `thresholdMinor` must be `null` (representing $+\infty$).
3. **Rate Sanity:** Each tier's `rateBasisPoints` must be $0 \le \text{rate} \le 10,000$.
4. **Total Percentage Across Beneficiaries:** For any tier level, the sum of all active rules' rates for that tier must not exceed $10,000$ bps ($100\%$).

---

## 6. Audit Findings & Unattended Issues (System-Wide)

Beyond the rule engine limitations, our four audit subagents uncovered several unattended issues and architectural technical debt that must be addressed:

### 6.1 Critical Issues (P0)

| ID | Location | Issue | Fix |
|---|---|---|---|
| **AUD-1** | `packages/core/ruleset-compiler.ts:19` | `UNSUPPORTED` rule halts entire compilation. Single complex clause blocks all 10 other valid rules. | Introduce a "Partial Compilation" mode where unsupported rules can be flagged for manual calculation while supported rules compile. |
| **AUD-2** | `packages/core/rule-validation.ts:54–68` | Modifier target rules (`config.targetRuleId`) are not included in the dependency graph for cycle detection. | Add modifier targets as directed edges in `validateRuleGraph` cycle DFS. |
| **AUD-3** | `packages/core/rule-validation.ts` | No conflict detection when `capMinor < floorMinor` for the same beneficiary. | Add explicit validation issue `CAP_EXCEEDED_BY_FLOOR`. |
| **AUD-4** | `render.paid.yaml:32` | Worker service references non-existent entry point `dist/apps/api/worker.js`. | Create `apps/api/worker.ts` as a standalone background worker entry point or update `render.paid.yaml`. |
| **AUD-5** | `packages/ai/openai-client.ts` | No `AbortSignal` timeout on OpenAI fetch calls. Hanging API calls hold sockets open indefinitely. | Add 60-second `AbortSignal.timeout(60_000)` to all external fetch calls. |

### 6.2 High-Priority Issues (P1)

| ID | Location | Issue | Fix |
|---|---|---|---|
| **AUD-6** | `apps/api/server.ts` | No global `process.on('uncaughtException')` or `unhandledRejection` handlers. | Register crash logging and graceful shutdown handlers. |
| **AUD-7** | `apps/api/http.ts:70–120` | Rate limiter is in-memory, single-process only. Does not share state across container replicas. | Document Redis upgrade path; add configuration for shared Redis token bucket. |
| **AUD-8** | `apps/api/auth.ts:220–260` | `authorizeByResource()` must be manually called in each route. Can be accidentally omitted. | Create a route wrapper or middleware decorator that enforces authorization automatically for parameterized routes. |
| **AUD-9** | `packages/ai/pdf-text.ts` | No page count cap on uploaded PDFs. A 500-page PDF can exhaust memory/tokens. | Enforce `MAX_PDF_PAGES = 50` limit with clear user error. |
| **AUD-10** | `packages/ai/openai-contract.ts:29` | Silent truncation at `MAX_EXTRACTION_CHARS = 120_000` with no user warning. | Emit a `TRUNCATED_DOCUMENT` warning in the extraction result. |

### 6.3 Medium-Priority Issues (P2)

| ID | Location | Issue | Fix |
|---|---|---|---|
| **AUD-11** | `apps/api/routes/finance.ts` | No settlement void/reversal endpoint. Once committed, errors require direct DB intervention. | Implement `POST /api/projects/:projectId/settlements/:settlementId/void` with inverse ledger adjustments. |
| **AUD-12** | `apps/web/public/app.js` | No offline detection. Network disconnections leave financial action buttons enabled. | Add `online`/`offline` event listeners with UI banner and button disabling. |
| **AUD-13** | `apps/web/public/app.js` | No client-side form validation before submitting financial figures. | Add pre-flight validation (non-negative integer minor units, required fields). |
| **AUD-14** | `.gitignore` | Missing entries for `.env.local`, `coverage/`, `.playwright-mcp/`. | Update `.gitignore` with comprehensive exclusions. |
| **AUD-15** | `fixtures/` | Only 3 fixture files. No tiered, multi-party, or non-English contract fixtures. | Add rich fixture set covering all 8 contract paradigms. |

---

## 7. Phase-by-Phase Implementation Plan

```
Phase 1: Core Math & Types (Zero dependencies, pure domain logic)
   │
   ▼
Phase 2: Database Schema & Migration (Cumulative ledger, stored procedures)
   │
   ▼
Phase 3: Settlement Engine Extension (Tranche splitting, cumulative state)
   │
   ▼
Phase 4: Rule Validation & Compiler (DAG cycle detection, modifier validation)
   │
   ▼
Phase 5: AI Extraction Schema & Prompt (OpenAI Structured Outputs for tiers)
   │
   ▼
Phase 6: API Layer & Outbox Worker (Endpoints, void flow, standalone worker)
   │
   ▼
Phase 7: Frontend UI (Tiered rule displays, offline banner, form validation)
   │
   ▼
Phase 8: Testing, CI/CD & Verification Gate (100% test pass, GitHub Actions)
```

---

### Phase 1: Core Types & Tranche Math
- [ ] **1.1** Update `packages/core/types.ts`:
  - Add `"TIERED_CUMULATIVE"`, `"DERIVATIVE_SPLIT"`, `"COMPOSITE_CONDITION"` to `RULE_TYPES`.
  - Add `TierDefinition`, `TieredCumulativeConfig`, `CumulativeState` types.
  - Extend `RevenueContext` with optional `cumulativePrior` and `externalMetrics`.
  - Add `"PARENT_RULE"` to `CandidateRule.base` and `ExecutableRule.base`.
- [ ] **1.2** Update `packages/core/money.ts`:
  - Implement `allocateTieredTranches(eventRevenueMinor, priorCumulativeMinor, tiers)`.
  - Add unit tests verifying:
    - Single-tier calculation matches standard percentage.
    - Two-tier calculation strictly below threshold uses Tier 1 rate.
    - Two-tier calculation strictly above threshold uses Tier 2 rate.
    - Straddle/boundary-crossing calculation splits into exact tranches.
    - Integer rounding in tranches conserves total revenue without drift.
    - Extreme threshold values ($0, MAX_SAFE_INTEGER) behave safely.

---

### Phase 2: Database Schema & Migrations
- [ ] **2.1** Create migration `supabase/migrations/20260401000001_cumulative_ledger.sql`:
  - Create `cumulative_earnings_ledger` table with check constraints and unique index.
  - Create `royaltyos_update_cumulative_ledger` PL/pgSQL function.
  - Update `royaltyos_commit_settlement` stored procedure to atomically update both `recoupment_ledger` and `cumulative_earnings_ledger`.
- [ ] **2.2** Create migration `supabase/migrations/20260401000002_void_settlement.sql`:
  - Create `royaltyos_void_settlement(p_settlement_id, p_actor_id, p_reason)` stored procedure.
  - Reverses recoupment balance deductions and cumulative earnings credits.
  - Transitions settlement status to `VOIDED`.
  - Records an entry in `audit_logs` with the cryptographic hash chain intact.

---

### Phase 3: Settlement Engine Extension
- [ ] **3.1** Update `packages/core/settlement-engine.ts`:
  - Accept `cumulatives: CumulativeState[]` parameter in `calculateSettlement()`.
  - Add `TIERED_CUMULATIVE` processing step in the calculation pipeline:
    - Locate cumulative state for each tiered rule.
    - Call `allocateTieredTranches()`.
    - Generate `SettlementLine` entries with kind `"PAYABLE"` and metadata detailing tranche breakdowns.
    - Track cumulative delta to return in `SettlementResult.cumulativeDeltas`.
  - Implement `DERIVATIVE_SPLIT` step:
    - Calculate parent rule first (guaranteed by topological priority ordering).
    - Sub-allocate child percentage off parent's line amount.
  - Implement `COMPOSITE_CONDITION` evaluator:
    - Recursive boolean evaluation (`AND`, `OR`, `NOT`).
  - Add conflict resolution for CAP/FLOOR:
    - If `capMinor < floorMinor`, FLOOR wins with an explanation warning logged, or CAP caps the floor. Document behavior explicitly.

---

### Phase 4: Rule Validation & Compiler Updates
- [ ] **4.1** Update `packages/core/rule-validation.ts`:
  - Validate `TIERED_CUMULATIVE` rules:
    - Tiers array must have $\ge 2$ entries.
    - `thresholdMinor` must be strictly monotonically increasing.
    - Last tier `thresholdMinor` must be `null`.
    - Sum of rates across all active rules for any given tier must not exceed $10,000$ bps.
  - Include `config.targetRuleId` in dependency graph cycle detection.
  - Add validation issue `CAP_EXCEEDED_BY_FLOOR` when `capMinor < floorMinor`.
  - Validate `THRESHOLD.config.mode` against allowed enums (`"MIN_REVENUE" | "MIN_PAYOUT"`).
- [ ] **4.2** Update `packages/core/ruleset-compiler.ts`:
  - Support Partial Compilation: Allow compiling rulesets where some rules are flagged for manual review, with explicit compilation flags.
  - Ensure canonical hash generation includes tier definitions.

---

### Phase 5: AI Extraction Pipeline Upgrades
- [ ] **5.1** Update `packages/ai/openai-contract.ts`:
  - Extend `contractSchema` with `tiers`, `cumulativeBasis`, `tierMode`, `resetPeriod`, `parentRuleId`.
  - Add 60-second `AbortSignal` timeout to OpenAI fetch calls.
  - Enforce `MAX_PDF_PAGES = 50` limit before parsing text.
  - Emit user warning when `documentText.length >= MAX_EXTRACTION_CHARS`.
  - Enhance system prompt with few-shot examples of tiered, derivative, and complex contracts.
- [ ] **5.2** Update `packages/ai/vision-contract.ts`:
  - Cap vision extraction at 20 pages max to prevent runaway API costs.
  - Add timeout to image rendering.

---

### Phase 6: API Layer & Background Worker
- [ ] **6.1** Create `apps/api/worker.ts`:
  - Standalone entry point for the background outbox worker (resolving `render.paid.yaml` bug).
  - Listens for `SIGTERM`/`SIGINT` with graceful shutdown.
  - Implements stalled-job recovery sweep on startup.
- [ ] **6.2** Update `apps/api/server.ts`:
  - Add global `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers.
- [ ] **6.3** Update `apps/api/routes/finance.ts`:
  - Pass `cumulativeState` from database to `calculateSettlement()`.
  - Implement `POST /api/projects/:projectId/settlements/:settlementId/void` endpoint.
- [ ] **6.4** Create `apps/api/routes/webhooks.ts`:
  - Move PayPal webhook handling from inline services into a dedicated route module.

---

### Phase 7: Frontend & Configuration Hardening
- [ ] **7.1** Update `apps/web/public/app.js`:
  - Render tier breakdown chips on settlement preview lines.
  - Add `online`/`offline` event listeners with non-intrusive status banner.
  - Disable financial mutation buttons when offline.
  - Add client-side integer minor unit validation before form submission.
- [ ] **7.2** Update configuration files:
  - Update `.gitignore` with `.env.local`, `coverage/`, `.playwright-mcp/`.
  - Verify `.dockerignore` excludes `.env`, `tests/`, `docs/`.
- [ ] **7.3** Create comprehensive test fixtures in `fixtures/`:
  - `tiered-escalation-contract.txt` (P1)
  - `retroactive-bonus-contract.txt` (P2)
  - `cross-collateralized-contract.txt` (P3)
  - `nested-producer-split.json` (P4)

---

### Phase 8: GitHub Actions CI/CD Pipeline
- [ ] **8.1** Create `.github/workflows/ci.yml`:
  - Run on every `push` to `main` and all `pull_request` events.
  - Steps:
    1. Checkout repository.
    2. Setup Node.js 22 LTS.
    3. Install pnpm / npm dependencies (`npm ci`).
    4. Run typecheck (`npm run typecheck`).
    5. Run database migration check (`npm run check:db`).
    6. Run secret scan (`npm run scan:secrets`).
    7. Run test suite (`npm test`).
    8. Run production build (`npm run build`).
  - Enforce branch protection: CI must pass before merging.

---

## 8. Testing Strategy & Pre-Commit Verification Gate

### 8.1 Required Test Categories

To guarantee zero regressions and verify every complex contract scenario, the test suite must be expanded from 106 to **160+ tests**:

```
tests/
├── unit/
│   ├── money.test.ts                 # Largest remainder + Tranche allocation (NEW)
│   ├── tiered-calculation.test.ts     # P1: Marginal tranche calculations (NEW)
│   ├── retroactive-tier.test.ts      # P2: Retroactive true-up calculations (NEW)
│   ├── derivative-split.test.ts       # P4: Parent-child DAG split calculations (NEW)
│   ├── composite-conditions.test.ts   # P6: Boolean condition trees (NEW)
│   ├── modifier-conflicts.test.ts     # CAP vs FLOOR conflict resolution (NEW)
│   ├── rules.test.ts                  # Extended with tiered rule validation
│   ├── compiler.test.ts               # Extended with partial compilation
│   ├── finance.test.ts                # Extended with cumulative ledger state
│   ├── advance-extraction.test.ts     # Existing + non-USD currencies
│   ├── openai.test.ts                 # Extended with tiered extraction schema
│   ├── auth.test.ts                   # Existing (sessions, dual-window, step-up)
│   ├── security.test.ts               # Existing (PDF validation, ClamAV)
│   ├── vault.test.ts                  # Existing (AES-256-GCM)
│   └── deployment.test.ts             # Updated with worker entry point check
└── integration/                       # NEW: End-to-end integration tests
    ├── settlement-lifecycle.test.ts   # Upload → Extract → Compile → Calculate → Commit
    └── void-reversal.test.ts          # Commit → Void → Verify ledger inverse
```

### 8.2 New Test Specifications (Detail)

#### Test 1: Marginal Tranche Allocation Math
```typescript
test("allocateTieredTranches splits revenue across boundary correctly", () => {
  const tiers: TierDefinition[] = [
    { tierIndex: 0, thresholdMinor: 2_000_000, rateBasisPoints: 1000, label: "10% up to $20k" },
    { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 1500, label: "15% thereafter" },
  ];
  // Prior earnings: $18,000 (1,800,000 minor)
  // New revenue: $5,000 (500,000 minor)
  // Tranche 1: $2,000 @ 10% = $200 (20,000 minor)
  // Tranche 2: $3,000 @ 15% = $450 (45,000 minor)
  // Total payout: $650 (65,000 minor)
  const result = allocateTieredTranches(500_000, 1_800_000, tiers);
  assert.equal(result.length, 2);
  assert.equal(result[0].allocatedMinor, 20_000);
  assert.equal(result[1].allocatedMinor, 45_000);
  assert.equal(result[0].applicableRevenueMinor + result[1].applicableRevenueMinor, 500_000);
});
```

#### Test 2: Invariant Property Sweep on Tiered Math
```typescript
test("fuzz: tiered allocations never exceed revenue and never lose cents", () => {
  for (let i = 0; i < 500; i++) {
    const revenue = Math.floor(Math.random() * 10_000_000) + 1; // Up to $100k
    const prior = Math.floor(Math.random() * 5_000_000);       // Up to $50k
    const threshold = Math.floor(Math.random() * 8_000_000) + 1;
    const tiers: TierDefinition[] = [
      { tierIndex: 0, thresholdMinor: threshold, rateBasisPoints: 1000 },
      { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 1500 },
    ];
    const tranches = allocateTieredTranches(revenue, prior, tiers);
    const totalApplicable = tranches.reduce((sum, t) => sum + t.applicableRevenueMinor, 0);
    assert.equal(totalApplicable, revenue);
  }
});
```

### 8.3 The Pre-Commit Verification Gate

Before ANY commit is made, the developer/agent MUST run:

```bash
# Step 1: Strict TypeScript compilation check (zero errors allowed)
npm run typecheck

# Step 2: Database migration syntax and convention check
npm run check:db

# Step 3: Automated secret scan (zero high-entropy credentials)
npm run scan:secrets

# Step 4: Run the complete test suite (all 160+ tests must pass)
npm test

# Step 5: Production build (TypeScript to dist/)
npm run build
```

**Rule:** If ANY step exits with a non-zero code, **DO NOT COMMIT**. Fix the issue and re-run from Step 1.

---

## 9. GitHub Actions CI/CD Pipeline

Create `.github/workflows/ci.yml`:

```yaml
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Typecheck, Scan, Test & Build
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js 22 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install Dependencies
        run: npm ci

      - name: Step 1 - TypeScript Typecheck
        run: npm run typecheck

      - name: Step 2 - Database Migration Check
        run: npm run check:db

      - name: Step 3 - Secret Scan
        run: npm run scan:secrets

      - name: Step 4 - Automated Test Suite
        run: npm test

      - name: Step 5 - Production Build
        run: npm run build

      - name: Verify Build Artifacts
        run: |
          test -f dist/apps/api/server.js || (echo "API build artifact missing" && exit 1)
          test -f dist/packages/core/settlement-engine.js || (echo "Core engine build artifact missing" && exit 1)
          echo "All build artifacts verified successfully."
```

---

## 10. Rollback, Migration Safety & Deployment Checklist

### 10.1 Database Migration Safety Protocol
1. **Forward-Only SQL Migrations:** Never modify existing migration files (`20250329000000_baseline.sql`). Always add new migrations with timestamps.
2. **Transaction Wrapping:** Every migration script must be wrapped in `BEGIN; ... COMMIT;`.
3. **Advisory Lock Protected:** Boot migrations acquire lock `19840301`.
4. **Idempotent Statements:** Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION`.
5. **Rollback Plan:** For each new migration, write a corresponding compensating rollback script stored in `docs/rollbacks/`.

### 10.2 Pre-Deployment Checklist
- [ ] All 160+ automated tests passing locally (`npm test`).
- [ ] CI pipeline green on GitHub Actions.
- [ ] No hardcoded secrets in git diff (`npm run scan:secrets`).
- [ ] Database migration tested against clean local PostgreSQL instance.
- [ ] Worker entry point `dist/apps/api/worker.js` compiles cleanly.
- [ ] `render.paid.yaml` and `render.yaml` configs validated against schemas.
- [ ] Environment variables verified against `.env.example`.

---

## 11. Risk Matrix & Mitigation Strategies

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **R1: Tranche rounding error loses fractional cents** | High (Financial) | Low | Hare-Niemeyer floor + remainder applied within each tranche; property-based fuzz tests verify $\sum \text{allocated} \le \text{revenue}$. |
| **R2: Cumulative ledger out of sync with settlement history** | Critical | Low | Ledger update executes inside the exact same ACID transaction as settlement approval in `royaltyos_commit_settlement`. |
| **R3: OpenAI Structured Outputs rejects extended schema** | High | Low | Pre-validate JSON schema using local Ajv validator before passing to OpenAI; ensure `additionalProperties: false` is honored on all object definitions. |
| **R4: Complex DAG cycles in derivative splits cause stack overflow** | High | Low | Depth-First Search 3-state cycle detection runs at compile time; runtime recursion depth capped at 10 tiers. |
| **R5: Worker crash leaves outbox jobs in `PROCESSING`** | Medium | Medium | Stalled-job recovery sweep on startup resets jobs older than 15 minutes back to `PENDING`. |
| **R6: Backward compatibility break on existing active rulesets** | Critical | Low | New `cumulatives` parameter in `calculateSettlement()` defaults to `[]`; existing 11 rule types retain identical evaluation semantics. |

---

*End of Comprehensive Fix & Enhancement Plan.*
