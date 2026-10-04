import type { AppConfig } from "../core/config.ts";
import { fetchWithRetry } from "../core/http-retry.ts";

/** Reads an invoice id off PayPal link objects (self href shapes vary by endpoint). */
export function invoiceIdFromLinks(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const href = typeof (link as { href?: unknown })?.href === "string" ? String((link as { href: string }).href) : null;
    const id = href?.match(/\/v2\/invoicing\/invoices\/([A-Za-z0-9-]+)\/?$/)?.[1];
    if (id) return id;
  }
  return null;
}

export type PayoutItemRequest = {
  recipientEmail: string;
  amountMinor: number;
  currency: string;
  note: string;
  senderItemId: string;
};

function moneyString(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("PayPal amount must be non-negative minor units");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export interface PayPalCredentialOverride {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  webhookId?: string | undefined;
  environment?: "sandbox" | "live";
}

export class PayPalGateway {
  private token: { accessToken: string; expiresAt: number } | null = null;
  private readonly config: AppConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials: { clientId: string; clientSecret: string; webhookId: string; environment: "sandbox" | "live" };
  readonly baseUrl: string;

  constructor(config: AppConfig, fetchImpl: typeof fetch = fetch, override?: PayPalCredentialOverride) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.credentials = {
      clientId: override?.clientId ?? config.paypal.clientId,
      clientSecret: override?.clientSecret ?? config.paypal.clientSecret,
      webhookId: override?.webhookId ?? config.paypal.webhookId,
      environment: override?.environment ?? config.paypal.environment,
    };
    this.baseUrl = this.credentials.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }

  async getAccessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.accessToken;
    const auth = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString("base64");
    const response = await fetchWithRetry(this.fetchImpl, `${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }, { maxRetries: this.config.paypal.maxRetries, timeoutMs: this.config.paypal.timeoutMs, baseDelayMs: this.config.paypal.retryBaseMs });
    const body = await response.json();
    if (!response.ok || typeof body.access_token !== "string") {
      throw new Error(`PayPal OAuth failed (${response.status}): ${JSON.stringify(body)}`);
    }
    this.token = { accessToken: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 300)) * 1000 };
    return body.access_token as string;
  }

  private async json(path: string, options: { method?: string; body?: unknown; requestId?: string } = {}) {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };
    if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);
    const response = await fetchWithRetry(this.fetchImpl, `${this.baseUrl}${path}`, requestInit, {
      maxRetries: this.config.paypal.maxRetries,
      timeoutMs: this.config.paypal.timeoutMs,
      baseDelayMs: this.config.paypal.retryBaseMs,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`PayPal ${path} failed (${response.status}): ${text}`);
    return body;
  }

  async createInvoice(input: {
    requestId: string;
    currency: string;
    recipientEmail: string;
    itemName: string;
    amountMinor: number;
    note?: string;
    reference?: string;
  }) {
    const body = await this.json("/v2/invoicing/invoices", {
      method: "POST",
      requestId: input.requestId,
      body: {
        detail: {
          currency_code: input.currency,
          note: input.note ?? "RoyaltyOS collaboration revenue invoice",
          reference: input.reference,
        },
        primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
        items: [{
          name: input.itemName,
          quantity: "1",
          unit_amount: { currency_code: input.currency, value: moneyString(input.amountMinor) },
        }],
      },
    }) as Record<string, any>;
    // PayPal answers creation with a bare self link (rel self, href ending in
    // /v2/invoicing/invoices/INV2-xxx) rather than the full invoice object,
    // so the id must be read off the href.
    const id = typeof body?.id === "string" && body.id
      ? body.id
      : invoiceIdFromLinks(body?.links ?? (typeof body?.href === "string" ? [body] : []));
    if (!id) throw new Error(`PayPal did not return an invoice id: ${JSON.stringify(body)?.slice(0, 300)}`);
    return { ...body, id } as Record<string, any>;
  }

  async sendInvoice(invoiceId: string, requestId: string) {
    return await this.json(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
      method: "POST",
      requestId,
      body: { send_to_recipient: true, send_to_invoicer: false },
    });
  }

  async getInvoice(invoiceId: string) {
    return await this.json(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async createPayout(requestId: string, batchId: string, items: PayoutItemRequest[]) {
    return await this.json("/v1/payments/payouts", {
      method: "POST",
      requestId,
      body: {
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: this.config.paypal.payoutEmailSubject,
          email_message: this.config.paypal.payoutNote,
        },
        items: items.map((item) => ({
          recipient_type: "EMAIL",
          amount: { value: moneyString(item.amountMinor), currency: item.currency },
          receiver: item.recipientEmail,
          note: item.note,
          sender_item_id: item.senderItemId,
        })),
      },
    });
  }

  async getPayoutBatch(batchId: string) {
    return await this.json(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page=1&page_size=100&total_required=true`);
  }

  async getPayoutItem(itemId: string) {
    return await this.json(`/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
  }

  async verifyWebhook(headers: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
  }, webhookEvent: unknown) {
    const body = await this.json("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: this.credentials.webhookId,
        webhook_event: webhookEvent,
      },
    });
    return body?.verification_status === "SUCCESS";
  }

  async health() {
    const token = await this.getAccessToken();
    return { oauthOk: Boolean(token), environment: this.credentials.environment };
  }
}
