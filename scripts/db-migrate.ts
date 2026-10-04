#!/usr/bin/env node
/**
 * Manual migration runner: `npm run db:migrate` (needs DATABASE_URL).
 * The same routine runs automatically inside startRoyaltyServer/worker boot.
 */
import path from "node:path";
import { ensureDatabaseMigrations } from "../packages/db/migrate.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set; nothing to migrate.");
  process.exit(2);
}
try {
  const result = await ensureDatabaseMigrations({
    databaseUrl,
    migrationsDir: path.resolve("supabase/migrations"),
    log: (message) => console.log(message),
  });
  console.log(`[migrate] done: ${result.applied.length} applied, ${result.skipped.length} already recorded`);
} catch (error) {
  console.error(`[migrate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
