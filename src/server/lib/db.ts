/**
 * db.ts
 *
 * PostgreSQL connection pool factory.
 *
 * Call createPool() once in server.ts and pass the returned pool to
 * all route factories. Keeping pool config here means server.ts stays
 * free of pg-specific connection details.
 *
 * Usage:
 *   import { createPool } from './lib/db.js';
 *   const pool = createPool();
 */

import pkg from 'pg';
const { Pool } = pkg;

export type PgPool = InstanceType<typeof Pool>;

export function createPool(): PgPool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('[db] DATABASE_URL env var is not set');
  }

  const pool = new Pool({
    connectionString,
    // Keep connections alive across Render's idle-timeout window.
    // 10 max is safe for Render free/starter (25 connection limit on Supabase free).
    max: parseInt(process.env.PG_POOL_MAX ?? '10', 10),
    idleTimeoutMillis:    30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pool.on('error', (err) => {
    console.error('[db] unexpected pool error', err.message);
  });

  return pool;
}
