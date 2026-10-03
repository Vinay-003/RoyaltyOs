# Architecture v0.1 Cross-Check

Basis: `RoyaltyOS_Project_Record_System_Architecture_v0.1.docx`, 03 Oct 2026.

Status legend: **DONE** implemented in v1.0; **SUPPORTED** implemented but requires external credentials/provider environment to prove real provider execution; **POST-HACKATHON** explicitly beyond the baseline hackathon scope.

## Core invariants

| Architecture invariant | v1.0 implementation |
|---|---|
| LLM never receives PayPal credentials or payout tool | DONE - contract AI adapter receives only PDFs/instructions. PayPal AI is separate and read-only tool filtered. |
| LLM never calculates final payment settlement | DONE - `packages/core/settlement-engine.ts` is deterministic TypeScript. |
| Restricted schema-validated financial rule model | DONE - strict Structured Outputs -> CandidateRule -> compiler -> ExecutableRule. |
| Activated RuleSet immutable/versioned | DONE - DB guards + version/hash + compiler. |
| Settlement references exact RuleSet version/hash | DONE. |
| Payout idempotent and tied to approved settlement | DONE - DB reservation RPC, locks, payout version, internal key and PayPal request/batch IDs. |
| Sensitive financial actions server-authorized/audited | DONE - RBAC + password step-up + chained audit RPC. |
| Untrusted contract/webhook/LLM cannot directly execute payment | DONE by explicit adapters/state gates. |

## Hackathon must-have scope

| Requirement | Status | Evidence in repo |
|---|---|---|
| Authentication + one workspace/project | DONE | Supabase Auth, bootstrap, memberships, projects |
| PDF contract upload/versioning | DONE | private Storage, immutable `contract_versions`, upload validation |
| AI extraction + evidence | DONE | OpenAI Responses PDF + strict schema; evidence metadata |
| Human approval + immutable RuleSet | DONE | candidate review routes + compiler + activation RPC |
| Rule graph | DONE | `/rule-graph` + active rules API |
| What-if simulation | DONE | simulation endpoint/engine; no posting |
| PayPal Sandbox invoice | SUPPORTED | create/send/get via `PayPalGateway`; needs user's live Sandbox test |
| Verified/reconciled payment event | SUPPORTED | verified webhook -> outbox -> authoritative invoice -> revenue; needs real PayPal event test |
| Deterministic settlement + recoupment | DONE | engine + canonical tests + DB settlement RPC |
| Finance approval | DONE | explicit state/role/step-up |
| PayPal payout batch | SUPPORTED | REST payout gateway + reserve/submit RPC; needs real Sandbox payout recipient test |
| Payout status/reconciliation | SUPPORTED | item/batch webhook + poll reconciliation + retry |
| Contributor statement + audit | DONE | `/royalties`, `/audit` |

## Should-have scope

| Feature | Status |
|---|---|
| Amendment conflict detection | DONE - previous PDFs are supplied; conflicts mark candidate review-required |
| Multiple revenue categories | DONE - `REVENUE_CATEGORY` rules / category conditions |
| Payout retry/recovery UI | DONE |
| Email notifications | DONE optional Resend; disabled mode remains durable/non-blocking |
| CSV exports | DONE |
| Tamper-evident audit hash chain | DONE database RPC + verify endpoint |
| Role-separated demo accounts | DONE role model/team assignment; actual accounts must be created in Supabase Auth by tester |

## Functional requirements FR-001 - FR-033

| ID | Status | Notes |
|---|---|---|
| FR-001 | DONE | authenticated private access |
| FR-002 | DONE | workspace membership + roles |
| FR-003 | DONE | server resource/workspace authorization |
| FR-004 | DONE | recent password step-up |
| FR-005 | DONE | PDF validation |
| FR-006 | DONE | SHA-256 + private storage |
| FR-007 | DONE | immutable versions + supersedes relationship |
| FR-008 | DONE | authorized five-minute signed original-evidence URL |
| FR-009 | DONE | percentages/categories/recoupment/thresholds/exclusions/dates schema |
| FR-010 | DONE | evidence/confidence/model/source version |
| FR-011 | DONE | conflicts + amendment comparison |
| FR-012 | DONE | unresolved/unsupported review required |
| FR-013 | DONE | restricted rule compiler |
| FR-014 | DONE | dependency/cycle validation |
| FR-015 | DONE | immutable RuleSet versions |
| FR-016 | DONE | non-mutating simulation |
| FR-017 | SUPPORTED | real PayPal invoice API implemented; provider test required |
| FR-018 | SUPPORTED | signature verification/dedup implemented; provider event required |
| FR-019 | SUPPORTED | authoritative invoice/payout get before recognized state |
| FR-020 | SUPPORTED | revenue RPC only after authoritative PAID reconciliation |
| FR-021 | DONE | deterministic calculation |
| FR-022 | DONE | percentages, fixed, recoup, cap/floor, exclusion, priority, reserve |
| FR-023 | DONE | exact reconciliation invariant/property tests |
| FR-024 | DONE | finance approval required |
| FR-025 | DONE | immutable settlement after approval/submission guards |
| FR-026 | SUPPORTED | payout only from approved settlement |
| FR-027 | DONE | lock/unique/idempotency protections |
| FR-028 | SUPPORTED | individual payout item lifecycle |
| FR-029 | SUPPORTED | provider reconciliation + ledger + issue tracking |
| FR-030 | DONE | contributor statement/status |
| FR-031 | DONE | evidence trace from statement |
| FR-032 | DONE | audit hash chain |
| FR-033 | DONE | settlement CSV |

## Architecture additions in v1.0

These are compatible additions, not scope violations:

- Read-only PayPal AI operations assistant using PayPal Remote MCP.
- Reconciliation issue table for post-revenue reversals/mismatches.
- Distributed rate limiter.
- Optional Resend notifications.
- Production ClamAV private service in Render Blueprint.
- External provider smoke scripts.

## Explicitly not claimed

The architecture baseline explicitly excludes tax/withholding, custodial escrow/stored-value wallet, complex FX, cryptocurrency/blockchain settlement, full accounting replacement, native mobile, custom OCR research, microservice decomposition and production-grade multi-merchant onboarding. v1.0 does not pretend to implement those areas.
