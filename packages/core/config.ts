export type AppConfig = ReturnType<typeof loadConfig>;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optionalInt(name: string, fallback: number, env: NodeJS.ProcessEnv) {
  const value = env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return Math.trunc(parsed);
}

function optionalNonNegativeInt(name: string, fallback: number, env: NodeJS.ProcessEnv) {
  const value = env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.trunc(parsed);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    port: optionalInt("PORT", 3000, env),
    appBaseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    appVersion: env.APP_VERSION ?? "1.0.2",
    logLevel: env.LOG_LEVEL ?? "info",
    supabase: {
      url: required("SUPABASE_URL", env).replace(/\/$/, ""),
      anonKey: required("SUPABASE_ANON_KEY", env),
      serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", env),
      storageBucket: env.SUPABASE_STORAGE_BUCKET ?? "royaltyos-contracts",
    },
    paypal: {
      environment: (env.PAYPAL_ENVIRONMENT ?? "sandbox") as "sandbox" | "live",
      clientId: required("PAYPAL_CLIENT_ID", env),
      clientSecret: required("PAYPAL_CLIENT_SECRET", env),
      webhookId: required("PAYPAL_WEBHOOK_ID", env),
      currency: env.PAYPAL_DEFAULT_CURRENCY ?? "USD",
      payoutEmailSubject: env.PAYPAL_PAYOUT_EMAIL_SUBJECT ?? "RoyaltyOS royalty payout",
      payoutNote: env.PAYPAL_PAYOUT_NOTE ?? "RoyaltyOS settlement payout",
      timeoutMs: optionalInt("PAYPAL_TIMEOUT_MS", 15000, env),
      maxRetries: optionalNonNegativeInt("PAYPAL_MAX_RETRIES", 3, env),
      retryBaseMs: optionalInt("PAYPAL_RETRY_BASE_MS", 250, env),
    },
    ai: {
      provider: env.AI_PROVIDER ?? "openai",
      openaiApiKey: required("OPENAI_API_KEY", env),
      openaiApiKeys: [
        required("OPENAI_API_KEY", env),
        ...(typeof env.OPENAI_API_KEY_FALLBACK_1 === "string" && env.OPENAI_API_KEY_FALLBACK_1 ? [env.OPENAI_API_KEY_FALLBACK_1] : []),
        ...(typeof env.OPENAI_API_KEY_FALLBACK_2 === "string" && env.OPENAI_API_KEY_FALLBACK_2 ? [env.OPENAI_API_KEY_FALLBACK_2] : []),
      ],
      baseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      sendPdfFile: (env.OPENAI_SEND_PDF_FILE ?? "false") === "true",
      extractionMode: env.AI_EXTRACTION_MODE === "vision" ? "vision" : "text",
      visionMaxPages: optionalInt("AI_VISION_MAX_PAGES", 10, env),
      model: env.OPENAI_MODEL ?? "gpt-6-astra",
      pdfDetail: (env.OPENAI_PDF_DETAIL ?? "low") as "low" | "auto" | "high",
      maxPdfBytes: optionalInt("AI_MAX_PDF_BYTES", 10 * 1024 * 1024, env),
      maxPdfPages: optionalInt("AI_MAX_PDF_PAGES", 100, env),
      timeoutMs: optionalInt("AI_TIMEOUT_MS", 120000, env),
      maxRetries: optionalNonNegativeInt("AI_MAX_RETRIES", 2, env),
      retryBaseMs: optionalInt("AI_RETRY_BASE_MS", 500, env),
    },
    paypalAi: {
      enabled: (env.PAYPAL_AI_ENABLED ?? "true") === "true",
      serverUrl: env.PAYPAL_MCP_SERVER_URL ?? ((env.PAYPAL_ENVIRONMENT ?? "sandbox") === "live" ? "https://mcp.paypal.com/http" : "https://mcp.sandbox.paypal.com/http"),
      model: env.PAYPAL_MCP_MODEL ?? env.OPENAI_MODEL ?? "gpt-6-astra",
      allowedTools: (env.PAYPAL_MCP_ALLOWED_TOOLS ?? "list_invoices,get_invoice,list_transactions")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    security: {
      stepUpTtlSeconds: optionalInt("STEP_UP_TTL_SECONDS", 900, env),
      maxUploadBytes: optionalInt("MAX_UPLOAD_BYTES", 10 * 1024 * 1024, env),
      maxPdfPages: optionalInt("MAX_PDF_PAGES", 100, env),
      malwareScanMode: env.MALWARE_SCAN_MODE ?? "disabled",
      clamavHost: env.CLAMAV_HOST ?? "127.0.0.1",
      clamavPort: optionalInt("CLAMAV_PORT", 3310, env),
      corsOrigins: (env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean),
      paypalCredentialsKey: typeof env.PAYPAL_CREDENTIALS_KEY === "string" && env.PAYPAL_CREDENTIALS_KEY.trim()
        ? env.PAYPAL_CREDENTIALS_KEY.trim()
        : null,
    },
    notifications: {
      provider: (env.NOTIFICATION_PROVIDER ?? "disabled") as "disabled" | "resend",
      resendApiKey: env.RESEND_API_KEY ?? "",
      fromEmail: env.NOTIFICATION_FROM_EMAIL ?? "RoyaltyOS <notifications@example.com>",
    },
    worker: {
      pollIntervalMs: optionalInt("WORKER_POLL_INTERVAL_MS", 3000, env),
      batchSize: optionalInt("WORKER_BATCH_SIZE", 20, env),
      maxAttempts: optionalInt("WORKER_MAX_ATTEMPTS", 8, env),
    },
  };
}
