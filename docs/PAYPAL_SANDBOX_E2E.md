# PayPal Sandbox End-to-End Test

This is the definitive test for the RoyaltyOS payment rail.

## PayPal configuration

Create/use a PayPal Sandbox REST app with a Business sandbox account. Put its Client ID and Secret in `.env`.

Register this webhook URL after the RoyaltyOS API has a public HTTPS address:

```text
https://YOUR_HOST/api/v1/webhooks/paypal
```

Subscribe to invoice and payout lifecycle events, especially:

```text
INVOICING.INVOICE.CREATED
INVOICING.INVOICE.UPDATED
INVOICING.INVOICE.PAID
INVOICING.INVOICE.CANCELLED
INVOICING.INVOICE.REFUNDED
PAYMENT.PAYOUTSBATCH.PROCESSING
PAYMENT.PAYOUTSBATCH.SUCCESS
PAYMENT.PAYOUTSBATCH.DENIED
PAYMENT.PAYOUTS-ITEM.SUCCEEDED
PAYMENT.PAYOUTS-ITEM.FAILED
PAYMENT.PAYOUTS-ITEM.UNCLAIMED
PAYMENT.PAYOUTS-ITEM.RETURNED
PAYMENT.PAYOUTS-ITEM.REFUNDED
PAYMENT.PAYOUTS-ITEM.BLOCKED
PAYMENT.PAYOUTS-ITEM.HELD
PAYMENT.PAYOUTS-ITEM.CANCELED
```

Save the generated Webhook ID as `PAYPAL_WEBHOOK_ID`.

## Test accounts

Create/identify:

- 1 Sandbox Business account attached to the REST app
- 1 Sandbox Personal buyer account for invoices
- at least 2 Sandbox Personal recipient accounts for payout recipients

Do not use real money or live credentials.

## Full user test

1. Start the API and worker.
2. Register the first RoyaltyOS user. The first workspace member becomes OWNER through bootstrap.
3. Open **Recipients** and create/update Artist, Producer, Manager and Featured Creator with valid Sandbox recipient emails.
4. Open **Contracts**, create `Northstar Creator Campaign`, upload `fixtures/demo/royaltyos-demo-agreement-v1.pdf`, and analyze it.
5. Review every candidate. Resolve anything marked `REVIEW_REQUIRED`, approve supported rules, then activate the RuleSet.
6. Upload `fixtures/demo/royaltyos-demo-amendment-v2.pdf` as the next immutable version. Analyze it. Confirm the AI flags the 20% -> 15% Producer post-recoupment change and that you must resolve it manually.
7. Activate the amended RuleSet.
8. Open **Simulator**, enter `$10,000` and category `VIDEO`. Check deterministic output and source evidence before proceeding.
9. Open **Invoices**. Create a small real Sandbox test invoice first (for example `$10.00`) to your Sandbox buyer email; send it.
10. Log into the Sandbox buyer and pay the invoice.
11. Confirm PayPal calls `/api/v1/webhooks/paypal`. The API should verify the signature, store/dedupe the event and enqueue it. The worker must fetch the authoritative invoice and only then create a revenue event.
12. Open **Settlements**. A deterministic settlement should be created automatically after verified revenue; otherwise use Calculate on the revenue event.
13. Review settlement line sum, RuleSet hash, algorithm version, payout emails and warnings.
14. Click Approve. If step-up has expired, re-enter your password.
15. Execute the PayPal payout.
16. Open **Payouts**. Wait for item/batch webhook or poll reconciliation. Each item should move independently to its PayPal result state.
17. Open **Royalties** and confirm the contributor amount traces to contract evidence, rule, revenue event, settlement and PayPal transaction.
18. Open **Audit** and **Insights** and verify there are no settlement/ledger mismatches.

## Expected financial demo math

The synthetic contract scenario is:

- Campaign revenue: $10,000.00 VIDEO
- Producer remaining advance before event: $600.00
- $600.00 is first allocated as recoupment
- Remaining percentage base: $9,400.00
- Artist 60% = $5,640.00
- Producer post-recoupment 15% = $1,410.00
- Manager 10% = $940.00
- Featured Creator VIDEO 5% = $470.00
- Reserve/remainder = $940.00
- Total allocations = exactly $10,000.00
- Payable recipient total = $8,460.00; the $600 recoupment is a non-payable recovery line and the $940 reserve stays non-payable.

The unit suite asserts this exact scenario.

## Failure tests to perform manually

- Re-send the same PayPal webhook/event ID: no duplicate revenue or settlement may appear.
- Double-click payout execution: only one frozen settlement payout version may be reserved.
- Send a fake webhook signature: request must be rejected.
- Change a beneficiary payout email after settlement approval: the approved settlement snapshot must not change.
- Refund/cancel an invoice after a revenue event exists: RoyaltyOS must open a reconciliation issue instead of rewriting immutable history.
- Temporarily use an invalid recipient Sandbox email: item failure must be visible and retry must target only failed items.
