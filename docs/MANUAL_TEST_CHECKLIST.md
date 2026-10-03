# Manual Acceptance Checklist

Use Sandbox/dev accounts only. Record IDs and screenshots in a release evidence folder.

## A. Local/static

- [ ] `npm run verify` passes.
- [ ] `npm run test:integration` passes.
- [ ] No real secrets exist in repository files.
- [ ] `VERSION`, `package.json`, `.env.example`, `render.yaml` agree on release version.
- [ ] `/insights` returns the SPA instead of 404.

## B. Supabase

- [ ] All migrations 001-007 applied cleanly to a fresh project/database.
- [ ] `app_versions` includes `1.0.2` (with the `1.0.0`/`1.0.1` records retained).
- [ ] Contract Storage bucket is private.
- [ ] RLS enabled as defined by migrations.
- [ ] Owner registration/bootstrap works.
- [ ] Cross-workspace object IDs are rejected.
- [ ] Session revocation and password step-up work.
- [ ] Financial-integrity RPC returns zero mismatches on clean demo state.

## C. Contract + AI

- [ ] Upload v1 demo PDF; malformed/non-PDF upload is rejected.
- [ ] AI extraction returns parties/rules/evidence and no executable code.
- [ ] Upload v2 amendment; 20% -> 15% Producer post-recoup change is surfaced for review.
- [ ] Every candidate resolved before activation.
- [ ] Activated RuleSet is immutable/versioned and linked to exact contract version.
- [ ] Prompt-injection fixture cannot cause PayPal/DB mutation.

## D. Simulation/settlement

- [ ] $10,000 VIDEO simulation reproduces canonical result.
- [ ] Simulation creates no ledger/payout state.
- [ ] Settlement line sum equals distributable amount exactly.
- [ ] Recoupment never becomes negative.
- [ ] Same frozen input + same RuleSet + same engine version reproduces same result.
- [ ] Approval requires Finance/Owner + recent step-up.

## E. PayPal invoice/revenue

- [ ] PayPal OAuth works.
- [ ] Create/send a Sandbox invoice.
- [ ] Buyer pays with Sandbox Personal account.
- [ ] Real signed `INVOICING.INVOICE.PAID` webhook is accepted.
- [ ] Replaying the event does not duplicate revenue/settlement.
- [ ] Fake signature is rejected.
- [ ] RoyaltyOS fetches authoritative invoice before recognizing revenue.
- [ ] Amount/currency mismatch opens reconciliation issue.
- [ ] Refund/cancel after recognized revenue opens reconciliation issue without rewriting history.

## F. PayPal payout

- [ ] Approved settlement creates one payout reservation/version.
- [ ] Concurrent/repeated execute clicks cannot create duplicate payout business effect.
- [ ] Sandbox payout reaches test recipient item lifecycle.
- [ ] Batch/item webhooks/poll reconciliation update state.
- [ ] Failed item retry creates next payout version and excludes successful items.
- [ ] Recipient change after settlement approval does not mutate snapshot.

## G. Reporting/audit

- [ ] Contributor statement traces amount -> RuleSet/rule -> contract evidence -> revenue -> payout.
- [ ] Settlement CSV downloads and reconciles to settlement total.
- [ ] Audit-chain verification passes.
- [ ] Insights shows revenue, settlement/payout status, open reconciliation issues and financial-integrity state.

## H. PayPal AI

- [ ] Read-only PayPal AI can answer invoice/transaction status through official Remote MCP.
- [ ] Money-moving request is rejected before model/MCP call.
- [ ] MCP allowed tools remain read-only.

## I. Render

- [ ] API web service healthy.
- [ ] Worker stays running and drains outbox.
- [ ] ClamAV private service reachable from API/worker.
- [ ] Production upload fails closed if scanner unavailable.
- [ ] Final public webhook URL registered in PayPal Sandbox and `PAYPAL_WEBHOOK_ID` updated.
