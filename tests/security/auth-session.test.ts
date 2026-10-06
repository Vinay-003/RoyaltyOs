import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSessionFresh,
  authCookieHeaders,
  bearerToken,
  clearAuthCookieHeaders,
} from "../../apps/api/http.ts";

const auth = { access_token: "access.jwt", refresh_token: "refresh-token", expires_in: 3600 };

function reqWith(cookie: string | undefined) {
  return { headers: cookie === undefined ? {} : { cookie } } as any;
}

function cookieMap(setCookie: string[]) {
  const out = new Map<string, string>();
  for (const entry of setCookie) {
    const [pair] = entry.split(";");
    const idx = pair!.indexOf("=");
    out.set(pair!.slice(0, idx), pair!.slice(idx + 1));
  }
  return out;
}

function future(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds;
}

test("session cookies are HttpOnly SameSite=Strict and Secure in production", () => {
  const headers = authCookieHeaders(auth, "production");
  const cookies = headers["Set-Cookie"];
  assert.equal(Array.isArray(cookies), true);
  assert.equal(cookies.length, 4);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\//);
  }
  assert.match(cookies[0]!, /royaltyos_access=/);
  assert.match(cookies[1]!, /royaltyos_refresh=/);
  assert.match(cookies[2]!, /royaltyos_session_exp=/);
  assert.match(cookies[3]!, /royaltyos_idle_exp=/);
});

test("sign-in issues an absolute deadline and an idle deadline", () => {
  const cookies = cookieMap(authCookieHeaders(auth, "test", { absoluteSeconds: 600, idleSeconds: 120 })["Set-Cookie"]);
  const now = Math.floor(Date.now() / 1000);
  const session = Number(cookies.get("royaltyos_session_exp"));
  const idle = Number(cookies.get("royaltyos_idle_exp"));
  assert.ok(session > now + 590 && session <= now + 600, `session deadline ${session}`);
  assert.ok(idle > now + 110 && idle <= now + 120, `idle deadline ${idle}`);
});

test("refresh slides the idle window but never the absolute deadline", () => {
  const cookies = authCookieHeaders(auth, "test", {}, { issueSession: false })["Set-Cookie"];
  assert.equal(cookies.length, 3);
  assert.ok(cookies.every((cookie) => !cookie.startsWith("royaltyos_session_exp=")));
  assert.ok(cookies.some((cookie) => cookie.startsWith("royaltyos_idle_exp=")));
});

test("bearerToken accepts cookie sessions without exposing them to browser JavaScript", () => {
  const req = { headers: { cookie: "x=1; royaltyos_access=abc.jwt.token; y=2" } } as any;
  assert.equal(bearerToken(req), "abc.jwt.token");
});

test("Authorization bearer remains supported for CLI integration tests", () => {
  const req = { headers: { authorization: "Bearer external-token" } } as any;
  assert.equal(bearerToken(req), "external-token");
});

test("logout clears all four auth cookies", () => {
  const cookies = clearAuthCookieHeaders("production")["Set-Cookie"];
  assert.equal(cookies.length, 4);
  assert.ok(cookies.every((cookie) => cookie.includes("Max-Age=0")));
});

test("requests without expiry cookies are allowed (Bearer clients and pre-upgrade sessions)", () => {
  assertSessionFresh(reqWith(undefined));
  assertSessionFresh(reqWith("royaltyos_access=abc"));
});

test("fresh expiry cookies pass", () => {
  const cookie = `royaltyos_session_exp=${future(600)}; royaltyos_idle_exp=${future(600)}`;
  assertSessionFresh(reqWith(cookie));
});

test("an expired idle window ends the session", () => {
  const cookie = `royaltyos_session_exp=${future(600)}; royaltyos_idle_exp=${future(-1)}`;
  assert.throws(() => assertSessionFresh(reqWith(cookie)), (err: any) => err.status === 401 && err.code === "SESSION_EXPIRED");
});

test("an expired absolute deadline ends the session", () => {
  const cookie = `royaltyos_session_exp=${future(-1)}; royaltyos_idle_exp=${future(600)}`;
  assert.throws(() => assertSessionFresh(reqWith(cookie)), (err: any) => err.status === 401 && err.code === "SESSION_EXPIRED");
});

test("a half-set expiry cookie is treated as expired", () => {
  const cookie = `royaltyos_session_exp=${future(600)}`;
  assert.throws(() => assertSessionFresh(reqWith(cookie)), (err: any) => err.status === 401 && err.code === "SESSION_EXPIRED");
});

test("a corrupted expiry value is treated as expired", () => {
  const cookie = `royaltyos_session_exp=soon; royaltyos_idle_exp=${future(600)}`;
  assert.throws(() => assertSessionFresh(reqWith(cookie)), (err: any) => err.status === 401);
});
