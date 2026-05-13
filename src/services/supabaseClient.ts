/**
 * supabaseClient.ts — browser-side Supabase Auth client (public anon key only).
 *
 * The anon key is safe to ship in the browser: it only grants access to
 * Supabase Auth (signIn / signOut / getSession). All data operations still go
 * through our Express API which uses the service-role key server-side.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set. ' +
    'Auth will not work until these env vars are provided.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    // Persist the session in sessionStorage so it survives page refreshes
    // but is cleared when the tab/browser is closed.
    storage:     window.sessionStorage as any,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Returns the current Supabase access token, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
