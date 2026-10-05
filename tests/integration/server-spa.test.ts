import test from "node:test";
import assert from "node:assert/strict";
import { createRoyaltyServer } from "../../apps/api/server.ts";
import { testConfig } from "../helpers.ts";

test("SPA fallback opens /insights instead of returning a dead route", async () => {
  const server = createRoyaltyServer({ config: testConfig() } as any);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + "/insights");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /RoyaltyOS/);
    assert.match(html, /app\.js/);
    const app = await fetch(base + "/app.js");
    assert.equal(app.status, 200);
    const js = await app.text();
    // The SPA entry point is a thin bootstrap; the router lives in its own module.
    assert.match(js, /from "\.\/js\/router\.js"/);
    const router = await fetch(base + "/js/router.js");
    assert.equal(router.status, 200);
    const routerJs = await router.text();
    assert.match(routerJs, /if\(p==="\/insights"\)return await insights\(\)/);
    assert.match(routerJs, /if\(p==="\/team"\)return await team\(\)/);
    assert.match(routerJs, /if\(p==="\/notifications"\)return await notificationsView\(\)/);
    assert.match(routerJs, /if\(p==="\/profile"\)return await profile\(\)/);
    const profilePage = await fetch(base + "/js/pages/profile.js");
    assert.equal(profilePage.status, 200, "/js/pages/profile.js");
    assert.match(profilePage.headers.get("content-type") ?? "", /javascript/);
    for (const module of ["/js/utils.js", "/js/state.js", "/js/api.js", "/js/nav.js", "/js/pages/dashboard.js"]) {
      const response = await fetch(base + module);
      assert.equal(response.status, 200, module);
      assert.match(response.headers.get("content-type") ?? "", /javascript/, module);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
  }
});


test("public landing lives at / and the app shell lives at /app", async () => {
  const server = createRoyaltyServer({ config: testConfig() } as any);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const landing = await fetch(base + "/");
    const landingHtml = await landing.text();
    assert.equal(landing.status, 200, "/");
    assert.match(landingHtml, /RoyaltyOS/, "/");
    assert.match(landingHtml, /landing\.js/, "/");
    assert.match(landingHtml, /landing\.css/, "/");
    assert.doesNotMatch(landingHtml, /from "\.\/js\/router\.js"/, "/ is not the app shell");
    for (const asset of ["/landing.css", "/landing.js"]) {
      const response = await fetch(base + asset);
      assert.equal(response.status, 200, asset);
    }
    for (const route of ["/app", "/app/insights", "/app/contracts"]) {
      const response = await fetch(base + route, { headers: { Accept: "text/html" } });
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /app\.js/, route);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
  }
});

test("all documented SPA application routes return the shell instead of a server 404", async () => {
  const server = createRoyaltyServer({ config: testConfig() } as any);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const routes = [
      "/app", "/app/insights", "/app/contracts", "/app/rule-graph", "/app/simulator",
      "/app/invoices", "/app/settlements", "/app/payouts", "/app/royalties", "/app/recipients",
      "/app/team", "/app/notifications", "/app/paypal-ai", "/app/audit", "/app/profile",
      // Legacy deep links keep serving the app shell.
      "/insights", "/contracts", "/settlements",
    ];
    for (const route of routes) {
      const response = await fetch(base + route, { headers: { Accept: "text/html" } });
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /RoyaltyOS/, route);
      assert.match(html, /app\.js/, route);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
  }
});

test("version endpoint is reachable without external providers", async () => {
  const ctx = { config: testConfig() } as any;
  const server = createRoyaltyServer(ctx);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/version`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: "1.0.2-test" });
  } finally {
    await new Promise<void>((resolve) => server.close(resolve));
  }
});

test("health, readiness and provider status are separated", async () => {
  const ctx = { config: testConfig(), paypal: { health: async () => ({ oauthOk: true, environment: "sandbox" }) } } as any;
  const server = createRoyaltyServer(ctx);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.version, "1.0.2-test");
    assert.equal(health.paypal, undefined, "liveness never calls a provider");

    const readiness = await (await fetch(`${base}/api/readiness`)).json();
    assert.equal(readiness.status, "ready");

    const providers = await (await fetch(`${base}/api/providers/health`)).json();
    assert.equal(providers.providers.paypal.oauthOk, true);
    assert.equal(providers.providers.ai.provider, "openai");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
  }
});

test("health stays local when the provider is down", async () => {
  const ctx = {
    config: testConfig(),
    paypal: { health: async () => { throw new Error("PayPal OAuth failed (401)"); } },
  } as any;
  const server = createRoyaltyServer(ctx);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, "ok", "a provider outage does not fail liveness");
    const providers = await (await fetch(`${base}/api/providers/health`)).json();
    assert.equal(providers.status, "degraded");
    assert.match(providers.providers.paypal.error, /PayPal OAuth failed/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
  }
});
