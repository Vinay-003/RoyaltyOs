import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export interface MigrationRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface MigrateOptions {
  migrationsDir: string;
  readFile?: (path: string) => string;
  listFiles?: () => string[];
  createClient?: () => MigrationRunner;
  log?: (message: string) => void;
}

/**
 * Explains database connection failures in actionable terms. The common one:
 * Supabase's direct hostname is IPv6-only and some hosts (Render free tier)
 * have no IPv6 egress, which surfaces as ENETUNREACH on port 5432. The fix is
 * the IPv4-compatible pooler string from Supabase dashboard → Project
 * Settings → Database → Connection pooling (a aws-*-pooler.supabase.com
 * hostname), not the direct-connection string.
 */
export function describeConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND/i.test(message)) {
    return `${message} — the database host is unreachable from here. If this is Supabase, the direct hostname is IPv6-only: use the IPv4 pooler connection string from Supabase dashboard → Project Settings → Database → Connection pooling instead of the direct string.`;
  }
  return message;
}

/** Sorted migration filenames (*.sql) in a directory. */
export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/**
 * Applies every migration file not yet recorded in
 * royaltyos_schema_migrations, in filename order, under one advisory lock
 * so concurrent boots cannot double-apply. Each file already wraps itself in
 * begin/commit; files are sent whole. Throws on the first failure so the
 * caller can refuse to boot on a half-migrated database.
 *
 * Already-deployed databases (migrated via the Supabase dashboard, which
 * records nothing) simply re-run every file once: all RoyaltyOS migrations
 * are idempotent, and the repo's re-apply test enforces that for new ones.
 */
export async function runMigrations(
  client: MigrationRunner,
  options: MigrateOptions,
): Promise<{ applied: string[]; skipped: string[] }> {
  const log = options.log ?? (() => {});
  const files = options.listFiles ? options.listFiles().sort() : listMigrationFiles(options.migrationsDir);
  const read = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  await client.query(`select pg_advisory_lock(hashtextextended('royaltyos-schema-migrations', 0))`);
  try {
    await client.query(
      `create table if not exists royaltyos_schema_migrations(
         filename text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const recorded = await client.query(`select filename from royaltyos_schema_migrations`);
    const done = new Set((recorded as { rows?: Array<{ filename: string }> }).rows?.map((row) => row.filename) ?? []);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      log(`[migrate] applying ${file}`);
      try {
        await client.query(read(join(options.migrationsDir, file)));
      } catch (error) {
        throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await client.query(`insert into royaltyos_schema_migrations(filename) values ($1)`, [file]);
      applied.push(file);
    }
    return { applied, skipped };
  } finally {
    await client.query(`select pg_advisory_unlock(hashtextextended('royaltyos-schema-migrations', 0))`);
  }
}

/**
 * Resolves env + paths and runs pending migrations. No-ops (with a log line)
 * when DATABASE_URL is unset or the migrations directory is absent, so local
 * development without a direct database connection is unaffected. Throws on
 * migration failure: callers must refuse to boot on a half-migrated database.
 */
export async function ensureDatabaseMigrations(options: {
  databaseUrl?: string | undefined;
  migrationsDir: string;
  log?: (message: string) => void;
}): Promise<{ applied: string[]; skipped: string[]; status: "migrated" | "skipped" }> {
  const log = options.log ?? (() => {});
  if (!options.databaseUrl) {
    log("[migrate] DATABASE_URL is not set; skipping boot migrations");
    return { applied: [], skipped: [], status: "skipped" };
  }
  const { applied, skipped } = await migrateDatabase(options.databaseUrl, {
    migrationsDir: options.migrationsDir,
    log,
  });
  log(
    JSON.stringify({
      level: "info",
      message: "Database migrations ensured",
      applied: applied.length,
      skipped: skipped.length,
      files: applied,
    }),
  );
  return { applied, skipped, status: "migrated" };
}

/**
 * Connects with DATABASE_URL and runs pending migrations. Throws on failure.
 * SSL is attempted first (Supabase requires it); only when the server
 * explicitly reports no SSL support (local scratch databases) does it retry
 * plaintext, loudly logged. Any other connection error fails closed.
 */
export async function migrateDatabase(
  databaseUrl: string,
  options: Omit<MigrateOptions, "createClient"> & { createClient?: () => MigrationRunner },
): Promise<{ applied: string[]; skipped: string[] }> {
  const log = options.log ?? (() => {});
  if (options.createClient) {
    const runner = options.createClient();
    try {
      return await runMigrations(runner, options);
    } finally {
      await runner.end();
    }
  }
  const attempts: Array<{ ssl: boolean | object; label: string }> = [
    { ssl: true, label: "ssl" },
    { ssl: false, label: "plaintext" },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    const client = new Client({ connectionString: databaseUrl, ssl: attempt.ssl });
    try {
      await client.connect();
      try {
        return await runMigrations(client as unknown as MigrationRunner, options);
      } finally {
        await client.end();
      }
    } catch (error) {
      lastError = error;
      try { await client.end(); } catch { /* already closing */ }
      const message = error instanceof Error ? error.message : String(error);
      if (attempt.label === "ssl" && /does not support SSL/i.test(message)) {
        log("[migrate] server has no SSL support (local database?); retrying plaintext");
        continue;
      }
      throw new Error(describeConnectionError(error));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
