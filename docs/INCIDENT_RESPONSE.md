# Incident Response Playbook

## 1. Duplicate or suspicious payout

1. Disable payout execution for the affected workspace/application deployment.
2. Preserve settlement, payout batch/item, audit, webhook and ledger records.
3. Fetch authoritative PayPal payout batch/item state.
4. Do not automatically retry UNKNOWN or PENDING provider outcomes.
5. Reconcile internal ledger/state, then decide whether a failed item is safely retryable.
6. Rotate PayPal credentials if credential exposure is suspected.

## 2. Fake/replayed webhook

1. Verify whether signature verification failed or provider event ID was already seen.
2. Confirm no domain effect was created for an unverified event.
3. Review webhook event records and correlated outbox jobs.
4. If webhook credentials/webhook ID may be exposed, rotate/re-register them.

## 3. Contract or AI interpretation issue

1. Do not mutate historical active RuleSets or settlements.
2. Mark the new interpretation review-required.
3. Upload/activate a new immutable contract/RuleSet version after human review.
4. If a paid settlement is affected, create a reconciliation issue/corrective workflow rather than rewriting history.

## 4. Secret exposure

1. Revoke/rotate the exposed key immediately (PayPal/OpenAI/Supabase/etc.).
2. Revoke active application sessions if auth material was exposed.
3. Purge secrets from logs/artifacts and repository history using approved procedures.
4. Re-run secret scanning and provider health tests.

## 5. Contract storage leak

1. Disable compromised signed URLs/keys and rotate relevant storage credentials.
2. Confirm the bucket remains private and review access logs.
3. Identify affected document hashes/versions and users.
4. Follow organizational breach-notification requirements.

## 6. Database integrity failure

1. Stop payout execution.
2. Snapshot/backup the database before remediation.
3. Run `royaltyos_financial_integrity()` and audit-chain verification.
4. Compare PayPal authoritative state against invoices/payouts/ledger.
5. Repair with append-only corrective records where possible; do not rewrite settled history silently.
