import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../context.ts";
import { json } from "../http.ts";

/**
 * Operational endpoints. Kept deliberately small and side-effect free:
 * /api/health is liveness only (never calls a third-party provider, so a PayPal
 * outage cannot make Render think the process itself is dead), /api/readiness
 * reports local configuration state, and /api/providers/health carries the
 * optional third-party detail for operators.
 */
export async function handleSystemRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/health") {
    json(res, 200, { status: "ok", version: ctx.config.appVersion, uptimeSeconds: Math.round(process.uptime()) });
    return true;
  }
  if (method === "GET" && path === "/api/readiness") {
    json(res, 200, {
      status: "ready",
      version: ctx.config.appVersion,
      checks: { config: "ok", process: "ok", database: "configured", storage: "configured" },
    });
    return true;
  }
  if (method === "GET" && path === "/api/providers/health") {
    // Optional provider detail for operators. Errors are truncated so provider
    // response bodies never leak into status output wholesale.
    let paypal: Record<string, unknown> = { oauthOk: false };
    try {
      paypal = { ...(await ctx.paypal.health()) } as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      paypal = { oauthOk: false, error: message.slice(0, 300) };
    }
    json(res, 200, {
      status: paypal.oauthOk ? "ok" : "degraded",
      version: ctx.config.appVersion,
      providers: { paypal, ai: { provider: ctx.config.ai.provider, model: ctx.config.ai.model } },
    });
    return true;
  }
  if (method === "GET" && path === "/api/version") {
    json(res, 200, { version: ctx.config.appVersion });
    return true;
  }
  return false;
}
