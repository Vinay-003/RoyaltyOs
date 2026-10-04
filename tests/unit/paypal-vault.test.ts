import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../../packages/security/paypal-vault.ts";

// Fixed 32-byte keys (base64): deterministic tests; freshness comes from the
// per-encryption nonce, asserted below.
const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const otherKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

test("vault round-trips a client secret", () => {
  const blob = encryptSecret("EAv8jNyC-secret-value", key);
  assert.match(blob, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(decryptSecret(blob, key), "EAv8jNyC-secret-value");
  assert.notEqual(encryptSecret("same", key), encryptSecret("same", key), "fresh nonce per encryption");
});

test("wrong key, tampered cipher and bad formats fail closed", () => {
  const blob = encryptSecret("secret", key);
  assert.throws(() => decryptSecret(blob, otherKey), /unable to authenticate|Unsupported state/i);
  const tampered = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decryptSecret(tampered, key), /unable to authenticate|Unsupported state/i);
  assert.throws(() => decryptSecret("not-a-blob", key), /unknown format/);
  assert.throws(() => decryptSecret(42 as any, key), /must be a string/);
  assert.throws(() => decryptSecret(blob, "short"), /32 bytes/);
  assert.throws(() => encryptSecret("", key), /Nothing to encrypt/);
});
