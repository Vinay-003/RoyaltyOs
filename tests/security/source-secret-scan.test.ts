import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function frontendSources(): string[] {
  const files: string[] = ["apps/web/public/app.js", "apps/web/public/index.html"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".js")) files.push(full);
    }
  };
  walk("apps/web/public/js");
  return files;
}

function readAll(files: string[]): string {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

test("browser bundle source does not contain backend secret variable names or obvious secret placeholders", () => {
  const combined = readAll(frontendSources());
  for (const secret of ["PAYPAL_CLIENT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "PAYPAL_WEBHOOK_ID"]) {
    assert.equal(combined.includes(secret), false, `${secret} leaked into browser source`);
  }
});

test("browser authentication uses HttpOnly server cookies rather than token localStorage", () => {
  const combined = readAll(frontendSources());
  assert.equal(combined.includes("royaltyos_access_token"), false);
  assert.equal(combined.includes("royaltyos_refresh_token"), false);
  assert.match(combined, /credentials:"same-origin"/);
});
