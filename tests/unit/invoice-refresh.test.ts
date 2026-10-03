import test from "node:test";
import assert from "node:assert/strict";
import { parsePayPalInvoiceAmount, reconcileInvoiceState } from "../../apps/api/services.ts";

const local = { amountMinor: 10000, currency: "USD", viewUrl: "https://paypal.test/old" };

test("paid authoritative state reconciles to PAID with match", () => {
  const out = reconcileInvoiceState(local, {
    status: "PAID",
    amount: { value: "100.00", currency_code: "USD" },
    detail: { metadata: { recipient_view_url: "https://paypal.test/new" } },
  });
  assert.equal(out.status, "PAID");
  assert.equal(out.matched, true);
  assert.equal(out.viewUrl, "https://paypal.test/new");
});

test("amount drift reports mismatch without losing the authoritative status", () => {
  const out = reconcileInvoiceState(local, {
    status: "PAID",
    amount: { value: "99.00", currency_code: "USD" },
  });
  assert.equal(out.status, "PAID");
  assert.equal(out.matched, false);
  assert.equal(out.viewUrl, "https://paypal.test/old");
});

test("malformed PayPal amounts fail loud instead of reconciling", () => {
  assert.throws(() => parsePayPalInvoiceAmount({ amount: { value: "9.999", currency_code: "USD" } }), /malformed/);
  assert.throws(() => parsePayPalInvoiceAmount({}), /malformed/);
});
