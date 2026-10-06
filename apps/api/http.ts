import type { IncomingMessage, ServerResponse } from "node:http";

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  requestId: string;
};

export async function readBody(req: IncomingMessage, maxBytes = 16 * 1024 * 1024): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    size += bytes.length;
    if (size > maxBytes) throw statusError(413, "Request body too large");
    chunks.push(bytes);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export async function readJson<T = any>(req: IncomingMessage, maxBytes?: number): Promise<T> {
  const bytes = await readBody(req, maxBytes);
  if (!bytes.length) return {} as T;
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw statusError(400, "Invalid JSON body"); }
}

export function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string | string[]> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function text(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

export function statusError(status: number, message: string, code?: string) {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code !== undefined) error.code = code;
  return error;
}

export function cookieValue(req: IncomingMessage, name: string) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { return part.slice(idx + 1).trim(); }
  }
  return null;
}

export type SessionTtl = { absoluteSeconds?: number; idleSeconds?: number };

/** Default absolute session lifetime: seven days from sign-in. */
export const SESSION_ABSOLUTE_TTL_SECONDS = 7 * 24 * 3600;
/** Default idle window: a quiet session must sign in again after one day. */
export const SESSION_IDLE_TTL_SECONDS = 24 * 3600;
/**
 * Browser lifetime of the expiry cookies. Deliberately longer than the
 * server-enforced windows so the server can still read an expired value and
 * answer SESSION_EXPIRED instead of failing with a generic 401.
 */
const EXPIRY_COOKIE_MAX_AGE = 30 * 24 * 3600;

function expiryCookies(nodeEnv: string, ttl: SessionTtl, now: number) {
  const secure = nodeEnv === "production" ? "; Secure" : "";
  const common = `Path=/; HttpOnly; SameSite=Strict${secure}`;
  const absolute = Math.max(60, ttl.absoluteSeconds ?? SESSION_ABSOLUTE_TTL_SECONDS);
  const idle = Math.max(60, ttl.idleSeconds ?? SESSION_IDLE_TTL_SECONDS);
  const maxAge = Math.max(EXPIRY_COOKIE_MAX_AGE, absolute * 2, idle * 2);
  const at = (seconds: number) => Math.floor((now + seconds * 1000) / 1000);
  return {
    session: `royaltyos_session_exp=${at(absolute)}; Max-Age=${maxAge}; ${common}`,
    idle: `royaltyos_idle_exp=${at(idle)}; Max-Age=${maxAge}; ${common}`,
  };
}

export function bearerToken(req: IncomingMessage) {
  const value = req.headers.authorization;
  if (value?.startsWith("Bearer ")) return value.slice(7).trim();
  const cookie = cookieValue(req, "royaltyos_access");
  if (cookie) return cookie;
  throw statusError(401, "Authentication required");
}

/**
 * Rejects requests whose session has hit its absolute lifetime or idle window.
 * Requests with no expiry cookies at all (Bearer/CLI clients, sessions created
 * before expiry cookies existed) are allowed through; those sessions pick up
 * expiry cookies on their next refresh.
 */
export function assertSessionFresh(req: IncomingMessage) {
  const session = cookieValue(req, "royaltyos_session_exp");
  const idle = cookieValue(req, "royaltyos_idle_exp");
  if (session === null && idle === null) return;
  const now = Math.floor(Date.now() / 1000);
  const stale = (value: string | null) =>
    value === null || !Number.isFinite(Number(value)) || Number(value) <= now;
  if (stale(session) || stale(idle)) {
    throw statusError(401, "Session expired. Please sign in again.", "SESSION_EXPIRED");
  }
}

export function authCookieHeaders(
  auth: { access_token: string; refresh_token: string; expires_in?: number },
  nodeEnv: string,
  ttl: SessionTtl = {},
  opts: { issueSession?: boolean } = {},
) {
  const secure = nodeEnv === "production" ? "; Secure" : "";
  const accessMaxAge = Math.max(60, Number(auth.expires_in ?? 3600) - 30);
  const common = `Path=/; HttpOnly; SameSite=Strict${secure}`;
  const expiry = expiryCookies(nodeEnv, ttl, Date.now());
  const cookies = [
    `royaltyos_access=${encodeURIComponent(auth.access_token)}; Max-Age=${accessMaxAge}; ${common}`,
    `royaltyos_refresh=${encodeURIComponent(auth.refresh_token)}; Max-Age=${60 * 60 * 24 * 30}; ${common}`,
  ];
  // Refresh keeps the absolute deadline issued at sign-in and only slides the
  // idle window, so a session cannot extend itself indefinitely.
  if (opts.issueSession !== false) cookies.push(expiry.session);
  cookies.push(expiry.idle);
  return { "Set-Cookie": cookies };
}

export function clearAuthCookieHeaders(nodeEnv: string) {
  const secure = nodeEnv === "production" ? "; Secure" : "";
  const common = `Path=/; HttpOnly; SameSite=Strict${secure}`;
  return {
    "Set-Cookie": [
      `royaltyos_access=; Max-Age=0; ${common}`,
      `royaltyos_refresh=; Max-Age=0; ${common}`,
      `royaltyos_session_exp=; Max-Age=0; ${common}`,
      `royaltyos_idle_exp=; Max-Age=0; ${common}`,
    ],
  };
}

export function routeMatch(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export function parseBase64Data(input: string) {
  const stripped = input.replace(/^data:[^;]+;base64,/, "");
  try { return new Uint8Array(Buffer.from(stripped, "base64")); }
  catch { throw statusError(400, "Invalid base64 file data"); }
}

export function requireString(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw statusError(400, `${field} is required`);
  return value.trim();
}

export function requireEmail(value: unknown, field = "email") {
  const email = requireString(value, field, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw statusError(400, `${field} must be a valid email`);
  return email;
}

export function requireMinor(value: unknown, field: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw statusError(400, `${field} must be positive integer minor units`);
  return n;
}
