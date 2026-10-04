import { createCipheriv, createDecipheriv } from "node:crypto";

const PREFIX = "v1";

function keyBytes(keyB64: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, "base64");
  } catch {
    throw new Error("PayPal credential encryption key is not valid base64");
  }
  if (key.length !== 32) throw new Error("PayPal credential encryption key must decode to 32 bytes");
  return key;
}

/**
 * Encrypts a PayPal client secret for storage. Returns
 * `v1:<base64 nonce>:<base64 ciphertext+tag>`. Fails closed on empty input.
 */
export function encryptSecret(plaintext: string, keyB64: string): string {
  if (typeof plaintext !== "string" || !plaintext) throw new Error("Nothing to encrypt");
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyB64), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}:${nonce.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Inverse of encryptSecret. Any format, key, or tamper problem throws. */
export function decryptSecret(blob: unknown, keyB64: string): string {
  if (typeof blob !== "string") throw new Error("Encrypted PayPal secret must be a string");
  const parts = blob.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
    throw new Error("Encrypted PayPal secret has an unknown format");
  }
  const nonce = Buffer.from(parts[1], "base64");
  const combined = Buffer.from(parts[2], "base64");
  if (nonce.length !== 12 || combined.length < 17) throw new Error("Encrypted PayPal secret is malformed");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyB64), nonce);
  const ciphertext = combined.subarray(0, combined.length - 16);
  decipher.setAuthTag(combined.subarray(combined.length - 16));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
