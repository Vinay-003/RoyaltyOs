import pg from "pg";

const databaseUrl = process.env.ROYALTYOS_TEST_DBURL;

if (!databaseUrl) {
  throw new Error(
    "ROYALTYOS_TEST_DBURL is not set. Run database tests with `npm run test:db` (scripts/db-harness.mjs boots PostgreSQL for you).",
  );
}

export const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as any[]);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function scalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const row = await one<pg.QueryResultRow>(sql, params);
  if (!row) throw new Error(`query returned no rows: ${sql}`);
  return Object.values(row)[0] as T;
}

export async function maybeScalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const row = await one<pg.QueryResultRow>(sql, params);
  return row ? (Object.values(row)[0] as T) : null;
}

/**
 * Runs `fn` on a dedicated connection switched to `role`, proving what that role can
 * and cannot do. The connection is released afterwards so ROLE never leaks to other tests.
 */
export async function asRole<T>(role: string, fn: (query: QueryFn) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const query: QueryFn = (sql, params = []) => client.query(sql, params as any[]);
  try {
    await query(`set role ${role}`);
    return await fn(query);
  } finally {
    try {
      await query(`reset role`);
    } finally {
      client.release();
    }
  }
}

export type QueryFn = (sql: string, params?: unknown[]) => Promise<pg.QueryResult<any>>;

/** Executes a statement expected to fail and returns the error message. */
export async function expectError(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await pool.query(sql, params as any[]);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected statement to fail, but it succeeded: ${sql}`);
}
