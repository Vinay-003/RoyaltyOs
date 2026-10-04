import test from "node:test";
import assert from "node:assert/strict";
import { toSafeAccount } from "../../apps/api/routes/profile.ts";

const row = {
  paypal_client_id: "AZ46U_STOtrZ9a-6nNOJjHRPw1tx",
  paypal_client_secret_enc: "v1:nonce:cipher",
  paypal_webhook_id: "6DC87975LX600144Y",
  environment: "sandbox",
  updated_at: "2026-10-04T00:00:00Z",
};

test("connected accounts serialize masked identifiers only", () => {
  const safe = toSafeAccount(row);
  const serialized = JSON.stringify(safe);
  assert.equal(safe.connected, true);
  assert.equal(safe.clientIdMasked, "••••w1tx");
  assert.equal(safe.webhookConfigured, true);
  assert.equal(safe.secretConfigured, true);
  assert.ok(!serialized.includes("AZ46U_STOtrZ9a"), "full client id never serializes");
  assert.ok(!serialized.includes("6DC87975LX600144Y"), "webhook id never serializes");
  assert.ok(!serialized.includes("v1:nonce:cipher"), "secret blob never serializes");
  assert.ok(!("clientId" in safe) && !("webhookId" in safe), "unmasked fields do not exist");
});

test("disconnected accounts serialize empty", () => {
  assert.deepEqual(toSafeAccount(undefined), {
    connected: false,
    environment: null,
    clientIdMasked: null,
    webhookConfigured: false,
    secretConfigured: false,
    updatedAt: null,
  });
});
