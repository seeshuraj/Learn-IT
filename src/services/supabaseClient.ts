/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * FIX (2026-05-20 v2):
 *   The previous fix used a `getSupabase()` function but still called it at
 *   module evaluation time (`export const supabase = getSupabase()`). In React
 *   18 Strict Mode, modules are evaluated twice in development, which meant
 *   the window guard was not yet set on the first evaluation pass — producing
 *   two GoTrueClient instances sharing the same storage key.
 *
 *   This version uses a Proxy-based lazy singleton: `supabase.auth` (or any
 *   property access) triggers creation on first use, long after module eval.
 *   `window.__learnit_supabase__` remains as the cross-module guard.
 *
 * The anon key is safe to ship in the browser — it only grants access to
 * Supabase Auth. All data operations go through our Express API (service-role
 * key is server-side only).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
    'Auth will not work until these env vars are provided to the Vite build.',
  );
}

declare global {
  interface Window { __learnit_supabase__?: SupabaseClient; }
}

/** Returns the single shared SupabaseClient, creating it on first call. */
function getInstance(): SupabaseClient {
  if (window.__learnit_supabase__) return window.__learnit_supabase__;
  window.__learnit_supabase__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      storage:            window.sessionStorage as any,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });
  return window.__learnit_supabase__;
}

/**
 * `supabase` — lazily-created singleton via Proxy.
 *
 * Property access (e.g. `supabase.auth`) triggers `getInstance()` at call
 * time, not at module evaluation time. This prevents React Strict Mode's
 * double-evaluation from creating two GoTrueClients.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return (getInstance() as any)[prop];
  },
  set(_target, prop: string | symbol, value: any) {
    (getInstance() as any)[prop] = value;
    return true;
  },
});

/** Returns the current Supabase access token, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * waitForSession — returns the known token immediately if provided, otherwise
 * polls sessionStorage until Supabase persists the session (max 5 s).
 */
export async function waitForSession(
  knownToken: string,
  timeoutMs = 5000,
): Promise<string> {
  if (knownToken) return knownToken;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for Supabase session to persist.');
}
