# Complete RoyaltyOS User Flow

## Owner setup

1. Register/sign in.
2. Bootstrap a workspace/project if this is the first user.
3. Add team members and assign OWNER, CONTRACT_MANAGER, FINANCE_APPROVER, CONTRIBUTOR or AUDITOR.
4. Add beneficiaries and PayPal payout emails.

## Contract Manager flow

1. Create a contract.
2. Upload a PDF. RoyaltyOS validates PDF structure/limits, scans malware in production, hashes it and writes it to private Supabase Storage as a new immutable contract version.
3. Run AI analysis. OpenAI receives only contract documents and extraction instructions; it never receives PayPal credentials or payment tools.
4. Review candidate rules side-by-side with evidence and conflicts.
5. Edit/reject/approve candidates. Ambiguous, unsupported or conflicting rules cannot silently activate.
6. Activate the RuleSet. The compiler validates graph/dependencies and percentages and writes a hashed immutable RuleSet version.
7. Inspect Rule Graph and optionally run What-if Simulator. Simulations persist scenario output but do not create revenue, ledger or payout state.

## Revenue flow

1. Owner/Finance creates a PayPal Sandbox invoice.
2. Send the invoice.
3. External client pays in PayPal Sandbox.
4. PayPal sends a webhook.
5. RoyaltyOS cryptographically verifies it, deduplicates provider event ID and atomically creates an outbox job.
6. Worker fetches authoritative invoice state directly from PayPal.
7. Only a matched, authoritative PAID invoice produces a revenue event.
8. Worker runs the deterministic settlement engine against the active frozen RuleSet and current recoupment state.

## Finance flow

1. Open Settlements.
2. Review exact allocation, payables, recipient snapshots, RuleSet hash and algorithm version.
3. Re-authenticate when step-up is required.
4. Approve the settlement. Approved lines are immutable.
5. Execute payout. Database locking + unique payout version + internal idempotency key + PayPal identifiers prevent duplicate effects.
6. Worker/webhooks reconcile batch and recipient item states.
7. Retry only definitively failed items as a new payout version.

## Contributor flow

1. Sign in as a CONTRIBUTOR membership scoped to a beneficiary key.
2. Open Royalties.
3. See only the contributor's own allocated lines.
4. Trace an amount to source document/version, page/clause evidence, revenue event, settlement and PayPal payout status/transaction.

## Auditor flow

1. Open Insights and Audit.
2. Review audit hash-chain integrity, ledger balance integrity and reconciliation issues.
3. Export settlement CSV when authorized.
4. Review webhooks, payout results and immutable versions without payment permissions.

## PayPal AI flow

Authorized Owner/Finance/Auditor users can open **PayPal AI** and ask read-only operational questions. RoyaltyOS uses OpenAI Responses API + PayPal Remote MCP with only list/get tools. Natural-language requests that appear to mutate PayPal are rejected before the model call.
