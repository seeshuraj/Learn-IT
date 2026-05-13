/**
 * env.ts — Startup environment validation (P1-6)
 *
 * Call validateEnv() once at the top of startServer().
 * Exits the process immediately if a required variable is missing
 * so misconfigured deployments fail fast rather than at request time.
 */

interface EnvConfig {
  DATABASE_URL:             string;
  SUPABASE_URL:             string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NVIDIA_API_KEY?:          string;
  PORT?:                    string;
  NODE_ENV?:                string;
}

export function validateEnv(): EnvConfig {
  const required: (keyof EnvConfig)[] = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error(
      `[env] FATAL — missing required environment variables:\n  ${missing.join('\n  ')}`
    );
    process.exit(1);
  }

  if (!process.env.NVIDIA_API_KEY) {
    console.warn('[env] NVIDIA_API_KEY not set — AI features will return mock responses');
  }

  return process.env as unknown as EnvConfig;
}
