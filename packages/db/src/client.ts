import pg from "pg";

import { requireEnv } from "./env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: requireEnv("DATABASE_URL"),
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  let client: pg.PoolClient | undefined;

  try {
    client = await pool.connect();
  } catch (connectError) {
    const error = new Error("Database connection unavailable");
    error.name = "DB_UNAVAILABLE";
    (error as NodeJS.ErrnoException).cause = connectError;
    throw error;
  }

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ROLLBACK failed — connection is broken; release and re-throw the original error
    }
    throw error;
  } finally {
    client.release();
  }
}
