#!/usr/bin/env node
/**
 * Ephemeral PostgreSQL behavioral test harness.
 *
 * Boots a throwaway PostgreSQL cluster (no Docker required), creates the
 * Supabase-compatible roles/schemas the migrations expect, applies every
 * migration from scratch to `royaltyos_test` and the pre-1.0.1 migrations to
 * `royaltyos_test_upgrade` (so the upgrade path can be exercised), runs
 * `tests/database/*.test.ts`, then destroys the cluster again.
 *
 * Environment overrides:
 *   ROYALTYOS_TEST_DATABASE_URL  use an existing *disposable* PostgreSQL server
 *                                (databases named in the URL are recreated)
 *   ROYALTYOS_DB_KEEP=1          keep the temporary cluster for debugging
 *   PG_BIN                       directory containing initdb/pg_ctl/psql
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const TEST_DB = process.env.ROYALTYOS_TEST_DB || "royaltyos_test";
const UPGRADE_DB = `${TEST_DB}_upgrade`;

let pgLogPath = null;

function fail(message) {
  console.error(`\n[db-harness] ${message}`);
  if (pgLogPath && existsSync(pgLogPath)) {
    console.error(`\n[db-harness] postgres log (${pgLogPath}):`);
    console.error(readFileSync(pgLogPath, "utf8").split("\n").slice(-40).join("\n"));
  }
  process.exit(1);
}

function findBinDir() {
  if (process.env.PG_BIN && existsSync(path.join(process.env.PG_BIN, "initdb"))) return process.env.PG_BIN;
  const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (pgConfig.status === 0) {
    const dir = pgConfig.stdout.trim();
    if (dir && existsSync(path.join(dir, "initdb"))) return dir;
  }
  const candidates = [
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/local/pgsql/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql/bin",
  ];
  for (const dir of candidates) if (existsSync(path.join(dir, "initdb"))) return dir;
  const local = path.join(root, "node_modules", ".pg");
  if (existsSync(local)) {
    for (const entry of readdirSync(local)) {
      const dir = path.join(local, entry, "bin");
      if (existsSync(path.join(dir, "initdb"))) return dir;
    }
  }
  return null;
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: "utf8", ...options });
  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fail(`${path.basename(bin)} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReady(psql, conn) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = spawnSync(psql, [...conn, "-w", "-tAc", "select 1"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.includes("1")) return true;
    await sleep(250);
  }
  fail(`PostgreSQL did not become ready (${conn.join(" ")})`);
  return false;
}

function migrationFiles() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) fail("no migrations found in supabase/migrations");
  return files;
}

function applyMigrations(psql, conn, files, label) {
  for (const file of files) {
    const result = spawnSync(psql, [...conn, "-v", "ON_ERROR_STOP=1", "-q", "-f", path.join(migrationsDir, file)], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr ?? "");
      fail(`${label}: migration ${file} failed (transaction rolled back)`);
    }
  }
}

/** Supabase-compatible roles + auth/storage schema stubs, applied per database. */
function bootstrapDatabase(psql, conn) {
  const sql = `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[],
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `;
  run(psql, [...conn, "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
}

function urlWithDatabase(baseUrl, database) {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main() {
  const externalUrl = process.env.ROYALTYOS_TEST_DATABASE_URL;
  let binDir = null;
  let dataDir = null;
  let port = null;
  let stop = null;
  const env = { ...process.env };
  let serverUrl;

  if (externalUrl) {
    console.warn(
      `[db-harness] using ROYALTYOS_TEST_DATABASE_URL; databases ${TEST_DB} and ${UPGRADE_DB} will be RECREATED on that server`,
    );
    serverUrl = urlWithDatabase(externalUrl, "postgres");
  } else {
    binDir = findBinDir();
    if (!binDir) {
      fail(
        "PostgreSQL binaries not found. Install PostgreSQL 15+ (apt install postgresql) or set PG_BIN to the directory containing initdb/pg_ctl/psql.",
      );
    }
    dataDir = mkdtempSync(path.join(tmpdir(), "royaltyos-pg-"));
    const socketDir = path.join(dataDir, "sock");
    pgLogPath = path.join(dataDir, "pg.log");
    port = await freePort();
    run(path.join(binDir, "initdb"), ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"], {
      encoding: "utf8",
    });
    mkdirSync(socketDir, { recursive: true });
    const started = spawnSync(
      path.join(binDir, "pg_ctl"),
      [
        "-D",
        dataDir,
        "-o",
        `-p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1 -c fsync=off -c unix_socket_directories=${socketDir}`,
        "-l",
        pgLogPath,
        "start",
      ],
      { encoding: "utf8" },
    );
    if (started.status !== 0) fail(`pg_ctl start failed with status ${started.status}`);
    stop = () => {
      spawnSync(path.join(binDir, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], { encoding: "utf8" });
    };
    serverUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    console.log(`[db-harness] ephemeral PostgreSQL cluster ready on 127.0.0.1:${port} (${dataDir})`);
  }

  const psql = binDir ? path.join(binDir, "psql") : process.env.PSQL || "psql";
  const adminConn = [serverUrl];
  await waitForReady(psql, adminConn);

  // Test databases are always recreated so the suite runs from a known state.
  for (const database of [TEST_DB, UPGRADE_DB]) {
    run(psql, [serverUrl, "-c", `drop database if exists ${database} with (force)`], {
      encoding: "utf8",
      allowFailure: true,
    });
    run(psql, [serverUrl, "-c", `create database ${database}`], { encoding: "utf8" });
  }
  console.log(`[db-harness] created ${TEST_DB} and ${UPGRADE_DB}`);

  const files = migrationFiles();
  const preV101 = files.filter((file) => !file.includes("_v101"));

  // Supabase-compatible roles are cluster-wide; schema stubs and grants are per database.
  bootstrapDatabase(psql, [urlWithDatabase(serverUrl, "postgres")]);
  for (const database of [TEST_DB, UPGRADE_DB]) bootstrapDatabase(psql, [urlWithDatabase(serverUrl, database)]);

  applyMigrations(psql, [urlWithDatabase(serverUrl, UPGRADE_DB)], preV101, "upgrade database (pre-1.0.1)");
  applyMigrations(psql, [urlWithDatabase(serverUrl, TEST_DB)], files, "fresh database");
  console.log(`[db-harness] applied ${files.length} migrations to ${TEST_DB} (${preV101.length} to ${UPGRADE_DB})`);

  env.ROYALTYOS_TEST_DBURL = urlWithDatabase(serverUrl, TEST_DB);
  env.ROYALTYOS_TEST_UPGRADE_DBURL = urlWithDatabase(serverUrl, UPGRADE_DB);
  env.ROYALTYOS_TEST_ADMIN_URL = serverUrl;
  env.ROYALTYOS_TEST_ROOT = root;
  env.ROYALTYOS_TEST_MIGRATIONS = migrationsDir;
  env.ROYALTYOS_TEST_PSQL = psql;

  const databaseDir = path.join(root, "tests", "database");
  const testFiles = readdirSync(databaseDir)
    .filter((f) => f.endsWith(".test.ts"))
    .sort()
    .map((f) => path.join(databaseDir, f));
  if (!testFiles.length) fail("no tests found in tests/database");

  // `--security` selects only the security-relevant DB suites (used by `npm run test:security`).
  const selected = process.argv.includes("--security")
    ? testFiles.filter((f) => /rls|immutable|payout-idempotency|audit|settlement/.test(path.basename(f)))
    : testFiles;
  console.log(`[db-harness] running ${selected.length} database test file(s)`);

  // Files run one at a time: migration/DDL tests must not race domain tests.
  const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", ...selected], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => child.on("exit", (value) => resolve(value ?? 1)));

  if (stop) stop();
  if (dataDir && process.env.ROYALTYOS_DB_KEEP !== "1") rmSync(dataDir, { recursive: true, force: true });
  else if (dataDir) console.log(`[db-harness] kept cluster at ${dataDir}`);
  process.exit(code);
}

await main();
