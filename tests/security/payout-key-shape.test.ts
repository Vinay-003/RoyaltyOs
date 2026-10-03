import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildPayoutIdempotencyKey, isCanonicalPayoutIdempotencyKey } from "../../packages/paypal/idempotency.ts";

const ALLOWED_MANUAL_KEY_FILES = new Set([
  // The canonical helper itself.
  "packages/paypal/idempotency.ts",
  // Behavioral DB tests deliberately exercise rejected non-canonical keys.
  "tests/database/payout-idempotency.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry)) continue;
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".mjs") || full.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

test("payout idempotency keys are only constructed through the canonical helper", () => {
  const offenders: string[] = [];
  for (const file of walk("apps").concat(walk("packages"))) {
    if (ALLOWED_MANUAL_KEY_FILES.has(file)) continue;
    const source = readFileSync(file, "utf8");
    if (source.includes("payout:")) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `manual "payout:" key construction outside the helper: ${offenders.join(", ")}`);
});

test("canonical payout key helper round-trips through the shape check", () => {
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const settlementId = "22222222-2222-2222-2222-222222222222";
  const key = buildPayoutIdempotencyKey({ workspaceId, settlementId, version: 1 });
  assert.equal(key, `payout:${workspaceId}:${settlementId}:v1`);
  assert.equal(isCanonicalPayoutIdempotencyKey(key), true);
  assert.equal(isCanonicalPayoutIdempotencyKey(`payout:${settlementId}:v1`), false);
});
