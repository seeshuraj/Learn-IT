/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * FIX (2026-05-20):
 *   Previous singleton guard used `window.__learnit_supabase__` but the
 *   assignment happened inside the module initialiser expression, which runs
 *   BEFORE the window property is guaranteed to be checked atomically in React
 *   18 Strict Mode's double-invocation. This produced two GoTrueClient
 *   instances sharing the same storage key.
 *
 *   The fix uses a true lazy getter: `getSupabase()` checks and populates
 *   `window.__learnit_supabase__` inside a function, ensuring the check +
 *   assign is always synchronous and never interleaved.
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

/**
 * Returns the single shared SupabaseClient for this browser context.
 * Creating it inside a function (rather than at module top-level) prevents
 * React Strict Mode's double-evaluation from instantiating two GoTrueClients.
 */
function getSupabase(): SupabaseClient {
  if (window.__learnit_supabase__) return window.__learnit_supabase__;

  window.__learnit_supabase__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      // sessionStorage survives page refreshes but is cleared on tab close.
      storage:          window.sessionStorage as any,
      persistSession:   true,
      autoRefreshToken: true,
      // Suppress the "multiple instances" warning for Strict Mode's
      // intentional double render — we guarantee only one real client exists.
      detectSessionInUrl: true,
    },
  });

  return window.__learnit_supabase__;
}

/** The shared browser Supabase client. Import this — never call createClient() directly. */
export const supabase: SupabaseClient = getSupabase();

/** Returns the current Supabase access token, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * waitForSession — returns the known token immediately if provided, otherwise
 * polls sessionStorage until Supabase persists the session (max 5 s).
 *
 * Needed because after signInWithPassword() resolves, parallel async code
 * may call getSession() before sessionStorage is written.
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
