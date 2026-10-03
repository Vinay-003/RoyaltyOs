import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "./context.ts";
import { statusError } from "./http.ts";
import { handleAssistantRoutes } from "./routes/assistant.ts";
import { handleAuthRoutes } from "./routes/auth.ts";
import { handleContractRoutes } from "./routes/contracts.ts";
import { handleFinanceRoutes } from "./routes/finance.ts";
import { handleProjectRoutes } from "./routes/projects.ts";
import { handleSystemRoutes } from "./routes/system.ts";

/**
 * HTTP router. Order is significant: the first handler that matches a path
 * responds, and anything unmatched falls through to a 404.
 *
 * Every financial invariant lives below this layer (services.ts, the deterministic
 * settlement engine and the database RPCs); routing only authenticates, authorizes
 * and shapes requests/responses.
 */
export async function handleApi(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
) {
  const method = req.method ?? "GET";
  const path = url.pathname;

  // Same-origin browser mutations are required when authentication is carried by
  // HttpOnly cookies. Non-browser API clients may omit Origin and use Bearer auth.
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "/api/v1/webhooks/paypal") {
    const origin = req.headers.origin;
    const originValue = Array.isArray(origin) ? origin[0] : origin;
    if (originValue && originValue !== new URL(ctx.config.appBaseUrl).origin) {
      throw statusError(403, "Cross-origin mutation blocked");
    }
  }

  if (await handleSystemRoutes(ctx, req, res, url)) return;
  if (await handleAuthRoutes(ctx, req, res, url, requestId)) return;
  if (await handleProjectRoutes(ctx, req, res, url, requestId)) return;
  if (await handleContractRoutes(ctx, req, res, url, requestId)) return;
  if (await handleFinanceRoutes(ctx, req, res, url, requestId)) return;
  if (await handleAssistantRoutes(ctx, req, res, url, requestId)) return;

  throw statusError(404, "API route not found");
}
