/**
 * supabaseClient.ts — browser-side Supabase Auth client (public anon key only).
 *
 * The anon key is safe to ship in the browser: it only grants access to
 * Supabase Auth (signIn / signOut / getSession). All data operations still go
 * through our Express API which uses the service-role key server-side.
 *
 * Singleton guard: window.__learnit_supabase__ prevents multiple GoTrueClient
 * instances from being created when the module is evaluated more than once
 * in the same browser context (e.g. HMR, code-splitting edge cases).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set. ' +
    'Auth will not work until these env vars are provided to the Vite build.'
  );
}

declare global {
  interface Window { __learnit_supabase__?: SupabaseClient; }
}

export const supabase: SupabaseClient =
  window.__learnit_supabase__ ??
  (window.__learnit_supabase__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      // Persist the session in sessionStorage so it survives page refreshes
      // but is cleared when the tab/browser is closed.
      storage:          window.sessionStorage as any,
      persistSession:   true,
      autoRefreshToken: true,
    },
  }));

/** Returns the current Supabase access token, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * waitForSession — polls until Supabase has written the session to storage.
 *
 * After supabase.auth.signInWithPassword() resolves, the session is already
 * available on the returned data object. But if caller code calls getSession()
 * in a separate async chain (e.g. from a different module) there is a tiny
 * race where sessionStorage hasn't been written yet.
 *
 * Pass the access_token you already have from signInWithPassword so we can
 * return immediately without polling in the happy path.
 */
export async function waitForSession(
  knownToken: string,
  timeoutMs = 5000
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
