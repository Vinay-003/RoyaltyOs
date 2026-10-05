import test from "node:test";
import assert from "node:assert/strict";
import { frameAncestorsDirective } from "../../packages/core/frame-ancestors.ts";

test("frame-ancestors defaults to none", () => {
  assert.equal(frameAncestorsDirective(undefined), "'none'");
  assert.equal(frameAncestorsDirective(""), "'none'");
  assert.equal(frameAncestorsDirective("   "), "'none'");
  assert.equal(frameAncestorsDirective(42 as any), "'none'");
});

test("portfolio origins pass through deduplicated", () => {
  assert.equal(
    frameAncestorsDirective("https://vinaybuilds.me https://www.vinaybuilds.me"),
    "https://vinaybuilds.me https://www.vinaybuilds.me",
  );
  assert.equal(frameAncestorsDirective("https://vinaybuilds.me https://vinaybuilds.me"), "https://vinaybuilds.me");
  assert.equal(frameAncestorsDirective("'self'"), "'self'");
  assert.equal(frameAncestorsDirective("https://app.example.com:8443"), "https://app.example.com:8443");
});

test("anything exotic fails closed to none", () => {
  for (const bad of [
    "http://vinaybuilds.me",
    "https://*",
    "https://vinaybuilds.me https://evil.example.com; script-src 'none'",
    "data:",
    "'unsafe-inline'",
    "'none' https://vinaybuilds.me",
    "https://",
    "javascript:alert(1)",
  ]) {
    assert.equal(frameAncestorsDirective(bad), "'none'", bad);
  }
});
