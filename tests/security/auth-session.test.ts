import test from "node:test";
import assert from "node:assert/strict";
import { authCookieHeaders, bearerToken, clearAuthCookieHeaders } from "../../apps/api/http.ts";

test("session cookies are HttpOnly SameSite=Strict and Secure in production", () => {
  const headers = authCookieHeaders({ access_token: "access.jwt", refresh_token: "refresh-token", expires_in: 3600 }, "production");
  const cookies = headers["Set-Cookie"];
  assert.equal(Array.isArray(cookies), true);
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\//);
  }
  assert.match(cookies[0]!, /royaltyos_access=/);
  assert.match(cookies[1]!, /royaltyos_refresh=/);
});

test("bearerToken accepts cookie sessions without exposing them to browser JavaScript", () => {
  const req = { headers: { cookie: "x=1; royaltyos_access=abc.jwt.token; y=2" } } as any;
  assert.equal(bearerToken(req), "abc.jwt.token");
});

test("Authorization bearer remains supported for CLI integration tests", () => {
  const req = { headers: { authorization: "Bearer external-token" } } as any;
  assert.equal(bearerToken(req), "external-token");
});

test("logout clears both auth cookies", () => {
  const cookies = clearAuthCookieHeaders("production")["Set-Cookie"];
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((cookie) => cookie.includes("Max-Age=0")));
});
