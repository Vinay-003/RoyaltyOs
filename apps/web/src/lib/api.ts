const GATEWAY_STATUSES = new Set([502, 503, 504]);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ApiOptions extends RequestInit {
  json?: unknown;
  maxRetries?: number;
}

export type ToastListener = (message: string, type?: "info" | "success" | "error" | "warn") => void;
let toastHandler: ToastListener | null = null;

export function registerToastHandler(handler: ToastListener) {
  toastHandler = handler;
}

export function showToast(message: string, type: "info" | "success" | "error" | "warn" = "info") {
  if (toastHandler) toastHandler(message, type);
  else console.log(`[Toast] ${type.toUpperCase()}: ${message}`);
}

let stepUpHandler: ((resolve: (pwd: string | null) => void) => void) | null = null;
export function registerStepUpHandler(handler: (resolve: (pwd: string | null) => void) => void) {
  stepUpHandler = handler;
}

async function promptStepUpPassword(): Promise<string | null> {
  if (stepUpHandler) {
    return new Promise((resolve) => stepUpHandler!(resolve));
  }
  return prompt("This financial action requires recent password verification. Enter your password:");
}

async function requestWithGatewayRetry(url: string, options: RequestInit, maxRetries = 5): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      last = await fetch(url, { ...options, credentials: "same-origin" });
    } catch (fetchErr) {
      if (attempt === maxRetries - 1) throw fetchErr;
    }
    if (last && !GATEWAY_STATUSES.has(last.status)) {
      window.dispatchEvent(new CustomEvent("royaltyos:server-status", { detail: { status: "online" } }));
      return last;
    }
    window.dispatchEvent(new CustomEvent("royaltyos:server-status", { detail: { status: "waking" } }));
    if (attempt === 0) fetch("/api/health", { cache: "no-store" }).catch(() => {});
    if (maxRetries > 1) {
      showToast("RoyaltyOS is waking server from idle (cold start). Retrying...", "warn");
      await delay(attempt < 2 ? 3000 : 6000);
    }
  }
  return last!;
}

export async function api<T = any>(url: string, options: ApiOptions = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers || {});
  const fetchOptions: RequestInit = { ...options, headers };
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    fetchOptions.body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    fetchOptions.body = options.body;
  }

  const response = await requestWithGatewayRetry(url, fetchOptions, options.maxRetries);
  const contentType = response.headers.get("content-type") || "";
  let data: any;
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = {};
    }
  } else {
    data = await response.text();
  }

  if (response.status === 401 && retry && !url.includes("/auth/")) {
    const refreshRes = await requestWithGatewayRetry("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (refreshRes.ok) {
      return api<T>(url, options, false);
    }
    if (refreshRes.status === 401) {
      window.dispatchEvent(new Event("royaltyos:session-expired"));
    }
  }

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `HTTP ${response.status}`;
    const err = new Error(errorMsg) as Error & { status: number; body: any };
    err.status = response.status;
    err.body = data;
    throw err;
  }

  return data as T;
}

export async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err: any) {
    if (err.status !== 428) throw err;
    const password = await promptStepUpPassword();
    if (!password) throw new Error("Step-up authorization canceled");
    await api("/api/v1/auth/step-up", { method: "POST", json: { password } });
    showToast("Identity verified for sensitive operation", "success");
    return await action();
  }
}
