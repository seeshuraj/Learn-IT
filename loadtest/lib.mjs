// Shared helpers for the load test. See loadtest/README.md.
import pkg from 'pg';
import { createClient } from '@supabase/supabase-js';

export const SLUG_PREFIX = 'learnit-load-test-';
export const EMAIL_DOMAIN = 'loadtest.learnitanalytics.com';

export function env(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

export function pool() {
  return new pkg.Pool({ connectionString: env('DATABASE_URL'), ssl: { rejectUnauthorized: false }, max: 3 });
}

export function admin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function anon() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run fn on items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
