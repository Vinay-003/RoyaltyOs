import type { AppConfig } from "../core/config.ts";
import { fetchWithRetry } from "../core/http-retry.ts";

export type NotificationMessage = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

export class NotificationGateway {
  private readonly config: AppConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AppConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async send(message: NotificationMessage) {
    if (this.config.notifications.provider === "disabled") {
      return { status: "SKIPPED" as const, providerMessageId: null };
    }
    if (this.config.notifications.provider !== "resend") {
      throw new Error(`Unsupported notification provider ${this.config.notifications.provider}`);
    }
    if (!this.config.notifications.resendApiKey) throw new Error("RESEND_API_KEY is required when NOTIFICATION_PROVIDER=resend");
    const response = await fetchWithRetry(this.fetchImpl, "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.notifications.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.config.notifications.fromEmail,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    }, {
      maxRetries: this.config.ai.maxRetries,
      timeoutMs: 15_000,
      baseDelayMs: 500,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Notification delivery failed (${response.status})`);
    return { status: "SENT" as const, providerMessageId: typeof body?.id === "string" ? body.id : null };
  }
}
