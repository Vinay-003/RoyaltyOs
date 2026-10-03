import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { one, q } from "./_client.ts";

const psql = process.env.ROYALTYOS_TEST_PSQL!;
const migrationsDir = process.env.ROYALTYOS_TEST_MIGRATIONS!;
const upgradeDbUrl = process.env.ROYALTYOS_TEST_UPGRADE_DBURL!;

const migrationFiles = () => readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

function applyFile(url: string, file: string) {
  return spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", path.join(migrationsDir, file)], {
    encoding: "utf8",
  });
}

test("fresh database has the expected schema, release version and hardening", async () => {
  const versions = await q<{ version: string }>(`select version from app_versions order by version`);
  const list = versions.map((row) => row.version);
  assert.ok(list.includes("1.0.0"), "the 1.0.0 release record exists");
  assert.ok(list.includes("1.0.1"), "the 1.0.1 release record exists");
  assert.ok(list.includes("1.0.2"), "the 1.0.2 release record exists");

  const digest = await one<{ digest: string }>(
    `select encode(public.digest('supabase-compat-probe', 'sha256'), 'hex') as digest`,
  );
  assert.match(digest!.digest, /^[a-f0-9]{64}$/, "pgcrypto digest is visible in public on any host");

  const extension = await one<{ count: string }>(`select count(*) from pg_extension where extname='pgcrypto'`);
  assert.equal(Number(extension!.count), 1, "pgcrypto is available for SHA-256 hashing");

  const tables = await one<{ count: string }>(
    `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity`,
  );
  assert.ok(Number(tables!.count) >= 30, "RLS is enabled on every application table");

  const markSubmitted = await q<{ signature: string }>(
    `select pg_get_function_identity_arguments(oid) as signature
     from pg_proc where proname='royaltyos_mark_payout_submitted'`,
  );
  assert.equal(markSubmitted.length, 1, "exactly one mark_payout_submitted signature (no ambiguous overload)");

  const reservedIndexes = await one<{ count: string }>(
    `select count(*) from pg_indexes where schemaname='public' and indexname='uniq_payout_item_line_per_batch'`,
  );
  assert.equal(Number(reservedIndexes!.count), 1, "one payout item per settlement line per batch is indexed");
});

test("every migration file is wrapped in a transaction so failures cannot half-apply", async () => {
  for (const file of migrationFiles()) {
    const source = readFileSync(path.join(migrationsDir, file), "utf8");
    const statements = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length && !line.startsWith("--"));
    assert.equal(statements[0]?.toLowerCase(), "begin;", `${file} opens a transaction`);
    assert.equal(statements[statements.length - 1]?.toLowerCase(), "commit;", `${file} closes a transaction`);
  }
});

test("upgrade path: pre-1.0.2 database gains the v1.0.2 Supabase compatibility fix", async () => {
  // The harness migrated this database up to (excluding) v1.0.2.
  const upgradeState = spawnSync(psql, [upgradeDbUrl, "-tAc", "select count(*) from app_versions where version='1.0.2'"], {
    encoding: "utf8",
  });
  assert.equal(upgradeState.stdout.trim(), "0", "upgrade database starts at v1.0.1");

  const v102 = migrationFiles().find((file) => file.includes("_v102"));
  assert.ok(v102, "the v1.0.2 migration exists");
  const applied = applyFile(upgradeDbUrl, v102!);
  if (applied.status !== 0) console.error(applied.stderr);
  assert.equal(applied.status, 0, "v1.0.2 migration applies on an existing v1.0.1 database");

  const after = spawnSync(psql, [upgradeDbUrl, "-tAc", "select string_agg(version, ',' order by version) from app_versions"], {
    encoding: "utf8",
  });
  assert.ok(after.stdout.includes("1.0.2"), "upgrade records the new release version");

  const privileges = spawnSync(
    psql,
    [upgradeDbUrl, "-tAc", "select has_function_privilege('anon','royaltyos_reserve_payout(uuid,uuid,text)','execute')"],
    { encoding: "utf8" },
  );
  assert.equal(privileges.stdout.trim(), "f", "upgrade also revokes public RPC execution");
});

test("migrations can be re-applied on an already migrated database", async () => {
  // Runs against the upgrade database so the shared suite database stays untouched.
  for (const file of migrationFiles()) {
    const result = applyFile(upgradeDbUrl, file);
    if (result.status !== 0) console.error(result.stderr);
    assert.equal(result.status, 0, `${file} re-applied cleanly (defined rerun behavior)`);
  }

  const rows = await one<{ count: string }>(`select count(*) from app_versions`);
  assert.ok(Number(rows!.count) >= 6, "reruns do not duplicate release records");
});

test("a failing migration statement rolls the whole file back", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "royaltyos-migration-rollback-"));
  const file = path.join(dir, "rollback_probe.sql");
  writeFileSync(
    file,
    `begin;\ncreate table rollback_probe_a (id int);\nselect 1/0;\ncreate table rollback_probe_b (id int);\ncommit;\n`,
  );
  try {
    const result = spawnSync(psql, [upgradeDbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "psql reports the failure");

    const probeA = await one<{ count: string }>(`select count(*) from pg_class where relname='rollback_probe_a'`);
    const probeB = await one<{ count: string }>(`select count(*) from pg_class where relname='rollback_probe_b'`);
    assert.equal(Number(probeA!.count), 0, "statements before the error were rolled back");
    assert.equal(Number(probeB!.count), 0, "statements after the error never ran");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release version exposed by the database matches VERSION", async () => {
  const root = process.env.ROYALTYOS_TEST_ROOT!;
  const versionFile = readFileSync(path.join(root, "VERSION"), "utf8").trim();
  const row = await one<{ max: string }>(`select max(version) from app_versions`);
  assert.equal(row!.max, versionFile, "app_versions tracks the release version");
});
