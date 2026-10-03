# Observability & Financial Integrity

RoyaltyOS treats reconciliation failures as financial-integrity incidents rather than ordinary application errors.

## Correlation

- API requests receive a correlation/request identifier.
- Audit events and durable jobs preserve resource identifiers and correlation data where available.
- Provider identifiers are kept alongside internal resources: PayPal invoice ID, webhook event ID, payout batch ID, payout item ID and transaction ID.

## Minimum production signals

Monitor at least:

- API 5xx rate and p95 latency
- worker outbox backlog, oldest pending age and retry count
- PayPal OAuth/API failures, 429s and timeouts
- webhook verification failures and duplicate event count
- invoice reconciliation mismatches
- settlement calculation failures
- open `reconciliation_issues`, especially HIGH/CRITICAL
- `royaltyos_financial_integrity()` result
- payout batch success/failure/partial-failure rate
- ledger mismatch count
- AI schema validation failure/manual-review rate
- malware scan failures

## Highest-priority alert

Any non-zero settlement mismatch, ledger mismatch or unresolved CRITICAL reconciliation issue is a financial-integrity alert. Stop payout execution for the affected workspace until investigated.

## Logging policy

Do log: correlation ID, actor/workspace/resource IDs, operation, state transition, provider status code, stable error code.

Never log: passwords, Supabase service role key, PayPal client secret/OAuth token, OpenAI API key, auth/session tokens, full contract content, or raw payout destination credentials beyond the minimum needed for operations.

## Render

- API health endpoint: `/api/health`
- Keep worker separate from API.
- Keep ClamAV private-only.
- Configure Render log drains/alerts according to your account plan.
- Run Supabase migrations as an explicit release step rather than racing them from API and worker startup.
