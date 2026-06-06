/**
 * supabaseAdmin.ts
 *
 * Process-wide Supabase service-role client.
 *
 * Import this instead of calling createClient() inside route files.
 * One instance per process — eliminates the GoTrueClient "multiple instances"
 * warning and avoids redundant background refresh timers.
 *
 * Usage:
 *   import { supabaseAdmin } from '../lib/supabaseAdmin.js';
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL) {
  throw new Error('[supabaseAdmin] SUPABASE_URL env var is not set');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY env var is not set');
}

export const supabaseAdmin: SupabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
