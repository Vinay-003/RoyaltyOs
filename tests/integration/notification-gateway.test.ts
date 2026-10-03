import test from "node:test";
import assert from "node:assert/strict";
import { NotificationGateway } from "../../packages/notifications/resend.ts";
import { testConfig } from "../helpers.ts";

test("disabled notification provider records a non-blocking skipped delivery", async () => {
  const gateway = new NotificationGateway(testConfig({ NOTIFICATION_PROVIDER: "disabled" }));
  assert.deepEqual(await gateway.send({ to: "x@example.com", subject: "s", text: "t", idempotencyKey: "n1" }), {
    status: "SKIPPED",
    providerMessageId: null,
  });
});

test("Resend delivery uses backend key and an idempotency key", async () => {
  let request: any = null;
  const fetchImpl = async (url: any, init: any) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ id: "email_123" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const gateway = new NotificationGateway(testConfig({
    NOTIFICATION_PROVIDER: "resend",
    RESEND_API_KEY: "resend-secret",
    NOTIFICATION_FROM_EMAIL: "RoyaltyOS <royalties@example.com>",
  }), fetchImpl as any);
  const result = await gateway.send({ to: "payee@example.com", subject: "Paid", text: "Done", idempotencyKey: "notification:123" });
  assert.equal(result.status, "SENT");
  assert.equal(result.providerMessageId, "email_123");
  assert.equal(request?.url, "https://api.resend.com/emails");
  const headers = request?.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer resend-secret");
  assert.equal(headers["Idempotency-Key"], "notification:123");
});
