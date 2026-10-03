import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createAppContext, type AppContext } from "./context.ts";
import { handleApi } from "./router.ts";
import { json, text } from "./http.ts";

const sourcePublicDir = path.resolve("apps/web/public");
const compiledPublicDir = path.resolve("dist/apps/web/public");
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function activePublicDir() {
  // In source/test mode, always serve source assets even if an old dist/ build exists.
  // In compiled production mode, import.meta.url points under dist/, so serve the copied build assets.
  const currentFile = fileURLToPath(import.meta.url);
  const runningCompiled = currentFile.split(path.sep).includes("dist");
  return runningCompiled ? compiledPublicDir : sourcePublicDir;
}

function staticFile(urlPath: string) {
  const publicDir = activePublicDir();
  const clean = decodeURIComponent(urlPath).replace(/\.\./g, "");
  const requested = path.join(publicDir, clean === "/" ? "index.html" : clean);
  if (requested.startsWith(publicDir) && existsSync(requested) && statSync(requested).isFile()) return requested;
  return path.join(publicDir, "index.html");
}

export function createRoyaltyServer(ctx: AppContext = createAppContext()) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co https://api-m.sandbox.paypal.com https://api-m.paypal.com https://api.openai.com https://mcp.sandbox.paypal.com https://mcp.paypal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url ?? "/", ctx.config.appBaseUrl);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(ctx, req, res, url, requestId);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "Method not allowed");
      const file = staticFile(url.pathname);
      const ext = path.extname(file);
      const body = readFileSync(file);
      res.writeHead(200, {
        "Content-Type": contentTypes[ext] ?? "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end(); else res.end(body);
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      const status = e.status ?? (e.message.includes("JWT") || e.message.toLowerCase().includes("auth") ? 401 : 500);
      if (status >= 500) console.error(JSON.stringify({ level: "error", requestId, message: e.message, stack: e.stack }));
      if (!res.headersSent) json(res, status, { error: e.message, code: e.code ?? null, requestId });
      else res.end();
    }
  });
}

export function startRoyaltyServer(ctx: AppContext = createAppContext()) {
  const server = createRoyaltyServer(ctx);
  server.listen(ctx.config.port, "0.0.0.0", () => {
    console.log(JSON.stringify({ level: "info", message: "RoyaltyOS API listening", port: ctx.config.port, version: ctx.config.appVersion }));
  });
  return server;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (entry && path.resolve(self) === entry) startRoyaltyServer();
