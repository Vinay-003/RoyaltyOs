import test from "node:test";
import assert from "node:assert/strict";
import { describeConnectionError, runMigrations } from "../../packages/db/migrate.ts";

test("unreachable hosts explain themselves with the pooler fix", () => {
  const hint = describeConnectionError(new Error("connect ENETUNREACH 2406:da14::123:5432"));
  assert.match(hint, /IPv4 pooler/);
  assert.match(hint, /ENETUNREACH/);
  assert.equal(describeConnectionError(new Error("password authentication failed")), "password authentication failed");
});

function fakeClient(recorded: string[] = [], failOn?: string) {
  const statements: string[] = [];
  const rows = recorded.map((filename) => ({ filename }));
  return {
    statements,
    async query(sql: string, _params?: unknown[]) {
      statements.push(sql);
      if (sql.startsWith("select filename")) return { rows };
      if (sql.startsWith("select pg_advisory_lock")) return { rows: [{ pg_advisory_lock: true }] };
      if (sql.startsWith("select pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
      if (failOn && sql.includes(failOn)) throw new Error(`syntax error near "${failOn}"`);
      return { rows: [] };
    },
    async end() {},
  };
}

const files = ["202610030001_a.sql", "202610030002_b.sql"];

test("pending migrations apply in order and are recorded", async () => {
  const client = fakeClient(["202610030001_a.sql"]);
  const out = await runMigrations(client, {
    migrationsDir: "/migrations",
    listFiles: () => files,
    readFile: (path: string) => `-- ${path}`,
  });
  assert.deepEqual(out.skipped, ["202610030001_a.sql"]);
  assert.deepEqual(out.applied, ["202610030002_b.sql"]);
  const applied = client.statements.filter((s) => s.startsWith("-- /migrations"));
  assert.equal(applied.length, 1, "recorded files are not re-run");
  assert.ok(client.statements.some((s) => s.includes("royaltyos_schema_migrations")));
  assert.ok(client.statements[0]!.includes("pg_advisory_lock"), "serializes concurrent boots first");
});

test("a failing migration aborts with its filename and records nothing", async () => {
  const client = fakeClient([], "202610030001_a.sql");
  await assert.rejects(
    () => runMigrations(client, {
      migrationsDir: "/migrations",
      listFiles: () => files,
      readFile: (path: string) => `-- ${path}`,
    }),
    /migration 202610030001_a\.sql failed/,
  );
  assert.ok(!client.statements.some((s) => s.startsWith("insert into royaltyos_schema_migrations")));
});
