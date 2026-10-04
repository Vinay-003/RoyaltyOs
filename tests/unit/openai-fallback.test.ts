import test from "node:test";
import assert from "node:assert/strict";
import { openaiFetch } from "../../packages/ai/openai-client.ts";
import { testConfig } from "../helpers.ts";

function mockFetch(statuses: number[]) {
  const seen: string[] = [];
  let calls = 0;
  const fetchImpl = (async (_url: any, init: any) => {
    calls++;
    seen.push(String(init.headers?.Authorization ?? ""));
    const status = statuses[Math.min(calls - 1, statuses.length - 1)] ?? 500;
    return new Response(JSON.stringify({ status }), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
  return { fetchImpl, seen, calls: () => calls };
}

const keys = () => testConfig({
  OPENAI_API_KEY: "key-primary",
  OPENAI_API_KEY_FALLBACK_1: "key-fallback-1",
  OPENAI_API_KEY_FALLBACK_2: "key-fallback-2",
});

test("a 401 rotates to the next key immediately", async () => {
  const { fetchImpl, seen, calls } = mockFetch([401, 200]);
  const response = await openaiFetch(keys(), fetchImpl, "https://x.test/v1/responses", { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["Bearer key-primary", "Bearer key-fallback-1"]);
  assert.equal(calls(), 2);
});

test("a 429 rotates instead of waiting out the quota", async () => {
  const { fetchImpl, seen, calls } = mockFetch([429, 429, 200]);
  const response = await openaiFetch(keys(), fetchImpl, "https://x.test/v1/responses", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(calls(), 3);
  assert.equal(seen[2], "Bearer key-fallback-2");
});

test("a 400 returns immediately without burning fallback keys", async () => {
  const { fetchImpl, seen, calls } = mockFetch([400]);
  const response = await openaiFetch(keys(), fetchImpl, "https://x.test/v1/responses", { method: "POST" });
  assert.equal(response.status, 400);
  assert.equal(calls(), 1);
  assert.deepEqual(seen, ["Bearer key-primary"]);
});

test("exhausted keys fail loud with the key count", async () => {
  const { fetchImpl } = mockFetch([401, 429, 401]);
  await assert.rejects(
    () => openaiFetch(keys(), fetchImpl, "https://x.test/v1/responses", { method: "POST" }),
    /all 3 API keys/,
  );
});

test("single-key configs behave exactly like before", async () => {
  const { fetchImpl, seen } = mockFetch([200]);
  const response = await openaiFetch(testConfig(), fetchImpl, "https://x.test/v1/responses", { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["Bearer openai-test-key"]);
});
