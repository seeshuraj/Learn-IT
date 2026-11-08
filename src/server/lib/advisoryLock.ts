/** Postgres advisory-lock helper for work that must run on one instance at a time. */

interface LockClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}
interface LockPool {
  connect(): Promise<LockClient>;
}

/**
 * Runs `work` only if this instance wins the advisory lock; otherwise returns
 * false without running it. The lock is released when the transaction ends.
 */
export async function runExclusive(pool: LockPool, key: number, work: () => Promise<void>): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [key]);
    if (!rows[0]?.locked) {
      await client.query('ROLLBACK');
      return false;
    }
    try {
      await work();
    } finally {
      await client.query('COMMIT');
    }
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

