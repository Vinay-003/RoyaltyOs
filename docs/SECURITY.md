# Security Model

## Hard trust boundary

- Contract text is untrusted data.
- LLM output is untrusted data until schema validation + human review + rule compilation.
- PayPal webhooks are untrusted until signature verification and authoritative resource reconciliation.
- The LLM has no PayPal client secret, no database service key and no payment mutation tool.
- Payment mutation APIs are reachable only through explicit authenticated server workflows.

## Identity and tenant controls

- Supabase Auth handles credentials/tokens.
- Browser access tokens are held in HttpOnly SameSite=Strict cookies; Secure is enabled in production.
- Server authorization checks every workspace-owned resource.
- Workspace roles: OWNER, CONTRACT_MANAGER, FINANCE_APPROVER, CONTRIBUTOR, AUDITOR.
- Sensitive operations require recent password step-up.
- Session revocation time invalidates older access tokens.

## File controls

- PDF-only contract ingestion.
- Magic bytes, EOF, size and page limits.
- SHA-256 document hash.
- Private Supabase Storage bucket.
- Short-lived authorized signed URLs for evidence viewing.
- Production uploads require ClamAV; missing scanner fails closed.

## Financial controls

- Integer minor units / basis points only in deterministic money logic.
- No eval/exec of AI output.
- Rule graph cycle/dependency/overallocation validation.
- Immutable contract versions, documents, activated RuleSets, settlement history, ledger history and audit events.
- Settlement exact reconciliation assertion.
- Double-entry-style ledger integrity verification.
- Database transaction locks and unique constraints around revenue recognition/payout reservation.
- Idempotency keys for PayPal mutation calls.
- Failed payout retries use a new payout version and only failed/non-success items.

## Webhook controls

- Preserve raw provider payload.
- Verify using PayPal's verification endpoint and configured Webhook ID.
- Unique PayPal event ID.
- Atomically persist verified event and async outbox intent.
- Acknowledge quickly; reconcile in worker.
- Fetch authoritative invoice/payout resource before financial state transitions.

## API/browser controls

- Cross-origin cookie-backed mutations are rejected.
- CSP, no-sniff, referrer policy, permissions policy, COOP and CORP headers.
- Rate limits stored centrally in Postgres for auth/AI-sensitive endpoints.
- Service-role Supabase key never appears in browser source.

## Operational gaps to consider after hackathon

The current v1.0 design is strong for a sandbox hackathon prototype, but a real-money production launch should add organization-specific security review, formal MFA, dual approval/cooling periods for high-value payout changes, managed secrets rotation, SAST/SCA/secret scanning in CI, external penetration testing, data-retention policy implementation, alerting, backup/restore drills and PayPal production onboarding/go-live review.
