import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../../apps/api/router.ts";
import { testConfig } from "../helpers.ts";

test("canonical app origin may mutate, unknown origins are blocked", () => {
  const config = testConfig();
  assert.equal(isAllowedOrigin(config, "http://localhost:3000"), true);
  assert.equal(isAllowedOrigin(config, "https://evil.example.com"), false);
});

test("CORS_ORIGINS allowlists extra frontends such as a custom domain", () => {
  const config = testConfig({
    APP_BASE_URL: "https://royaltyos.vinaybuilds.me/",
    CORS_ORIGINS: "https://royaltyos-api.onrender.com/, not-a-url",
  });
  assert.equal(isAllowedOrigin(config, "https://royaltyos.vinaybuilds.me"), true);
  assert.equal(isAllowedOrigin(config, "https://royaltyos-api.onrender.com"), true);
  assert.equal(isAllowedOrigin(config, "https://evil.example.com"), false);
});
