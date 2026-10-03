# Provider and SDK Choices

Release: RoyaltyOS v1.0.1

## PayPal payment rail

RoyaltyOS uses **PayPal REST APIs directly from the backend** through `packages/paypal/gateway.ts`:

- OAuth 2 client-credentials token exchange
- Invoicing v2 create/send/get
- Webhook signature verification
- Payouts v1 create/get batch/get item

There is intentionally no browser-side payment credential and no LLM-accessible payout function. The central gateway is the only module allowed to issue provider payment HTTP requests.

## PayPal AI integration

RoyaltyOS uses PayPal's **official hosted Remote MCP server** as its PayPal AI/sponsor-tool integration.

Sandbox transport configured by default:

```text
https://mcp.sandbox.paypal.com/http
```

Production counterpart:

```text
https://mcp.paypal.com/http
```

The runtime calls the remote MCP server from the OpenAI Responses API and restricts discovery to explicitly configured read-only tools:

```text
list_invoices,get_invoice,list_transactions
```

A local PayPal MCP package (`@paypal/mcp`) and PayPal Agent Toolkit (`@paypal/agent-toolkit`) exist, but **RoyaltyOS v1.0.1 does not depend on those npm packages at runtime**. It uses PayPal's hosted MCP endpoint instead. This makes the exact answer to "which PayPal AI/SDK is used?":

- **PayPal AI tool:** official PayPal Remote MCP server.
- **Payment SDK:** no PayPal SDK dependency; a typed server-side REST gateway is used.
- **Why:** PayPal AI remains visible/central for merchant intelligence, while money movement stays deterministic and outside model control.

## General AI provider

**OpenAI** is the current AI provider.

Contract intelligence:

- OpenAI Responses API (or an OpenAI-compatible gateway via `OPENAI_BASE_URL`, default `https://api.openai.com/v1`)
- native PDF `input_file`
- strict JSON-schema Structured Outputs
- default model: `gpt-6-astra` (configurable with `OPENAI_MODEL`)
- current + prior contract versions can be provided to expose amendment/conflict context

PayPal AI:

- OpenAI Responses API remote MCP tool
- PayPal OAuth access token supplied server-side to the MCP connection
- `allowed_tools` limits the visible tool surface
- RoyaltyOS rejects money-moving natural-language requests before any model/MCP call

## Supabase

Supabase supplies:

- PostgreSQL system of record
- Auth
- private Storage for contract PDFs

RoyaltyOS uses a small server-side fetch adapter rather than the Supabase JavaScript SDK, keeping runtime dependencies minimal and preventing service-role keys from reaching the browser.

## Render

Render is the deployment target for:

- web/API service
- background outbox worker
- private ClamAV service

Supabase remains the managed database/auth/storage platform.
