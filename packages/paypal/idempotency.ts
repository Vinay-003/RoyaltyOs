/**
 * Canonical payout idempotency key.
 *
 * Every payout reservation (initial execute and failed-item retry) MUST use this
 * helper. The database enforces the same format in `royaltyos_reserve_payout` and
 * `royaltyos_reserve_payout_retry`, and raises if a caller supplies a key that does
 * not match the canonical shape. That assertion is what prevents two code paths from
 * drifting apart and accidentally reserving two payout batches for one settlement.
 *
 * Format: payout:<workspaceId>:<settlementId>:v<version>
 */
export interface PayoutIdempotencyKeyInput {
  workspaceId: string;
  settlementId: string;
  version: number;
}

export function buildPayoutIdempotencyKey({ workspaceId, settlementId, version }: PayoutIdempotencyKeyInput): string {
  if (!workspaceId) throw new Error("workspaceId is required for a payout idempotency key");
  if (!settlementId) throw new Error("settlementId is required for a payout idempotency key");
  if (!Number.isInteger(version) || version < 1) throw new Error("payout version must be a positive integer");
  return `payout:${workspaceId}:${settlementId}:v${version}`;
}

/** True when a string has the canonical payout key shape (used by defensive checks/tests). */
export function isCanonicalPayoutIdempotencyKey(key: string): boolean {
  return /^payout:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}:v\d+$/.test(key);
}
