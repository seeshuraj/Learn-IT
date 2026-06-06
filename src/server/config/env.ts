/**
 * env.ts — Startup environment validation
 *
 * Call validateEnv() once at the top of startServer().
 * Exits the process immediately if a required variable is missing
 * so misconfigured deployments fail fast rather than at request time.
 *
 * Required env vars must be set in Render → Environment (not in .env, which is git-ignored):
 *   DATABASE_URL             — Supabase Postgres connection string
 *   SUPABASE_URL             — https://pyjynvgsrlxypkiiopei.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase Dashboard → Settings → API → service_role key
 *   NODE_ENV                 — production
 *   NVIDIA_API_KEY           — optional; AI features return mock responses if unset
 */

interface EnvConfig {
  DATABASE_URL:              string;
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NVIDIA_API_KEY?:           string;
  PORT?:                     string;
  NODE_ENV?:                 string;
}

export function validateEnv(): EnvConfig {
  const required: (keyof EnvConfig)[] = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[env] FATAL — server cannot start.');
    console.error('[env] The following required environment variables are missing:');
    missing.forEach(k => console.error(`  ✗  ${k}`));
    console.error('[env] → Set them in Render Dashboard → Your Service → Environment');
    console.error('[env] → Then trigger a new deploy.');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  }

  if (!process.env.NVIDIA_API_KEY) {
    console.warn('[env] NVIDIA_API_KEY not set — AI features will return mock responses');
  }

  return process.env as unknown as EnvConfig;
}
