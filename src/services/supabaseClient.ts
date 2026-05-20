/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * v4 (2026-05-20, DEFINITIVE) — Proxy removed.
 *
 * Root cause of all prior :1/:2 GoTrueClient warnings:
 *   GoTrueClient has a lazy `_initSupabaseAuthClient` that runs on the
 *   FIRST access of `.auth`. React 18 concurrent rendering causes two
 *   components to access `supabase.auth` in the same microtask tick,
 *   before the lazy init on the first access has written back to the
 *   instance. The GoTrueClient constructor sees two concurrent init
 *   requests and warns.
 *
 *   The Proxy *amplified* this by deferring createClient() to the first
 *   property access — exactly the wrong time.
 *
 * Fix:
 *   1. Call getInstance() ONCE at module evaluation time (eager init).
 *      GoTrueClient fully constructs before any React render touches .auth.
 *   2. Keep the globalThis guard so a second Vite chunk importing this
 *      module still gets the same instance (no second createClient call).
 *   3. No Proxy. The exported `supabase` is the real SupabaseClient.
 *
 * The anon key is safe to ship in the browser — it only grants access to
 * Supabase Auth. All data operations go through our Express API (which
 * holds the service-role key server-side only).
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

// ── globalThis-backed singleton ───────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __learnit_supabase__: SupabaseClient | undefined;
}

function getInstance(): SupabaseClient {
  if (globalThis.__learnit_supabase__) return globalThis.__learnit_supabase__;

  globalThis.__learnit_supabase__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      // sessionStorage instead of localStorage: scoped per-tab,
      // cleared on tab close, safer for shared computers.
      storage:            typeof window !== 'undefined' ? window.sessionStorage as any : undefined,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });

  return globalThis.__learnit_supabase__;
}

/**
 * `supabase` — the real SupabaseClient instance, initialised eagerly at
 * module load time so GoTrueClient fully constructs before any React
 * component render touches `.auth`.
 *
 * The globalThis guard ensures a second Vite chunk importing this module
 * reuses the already-constructed instance rather than calling createClient
 * again.
 */
export const supabase: SupabaseClient = getInstance();

/** Returns the current Supabase access token, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * waitForSession — returns the known token immediately if provided,
 * otherwise polls sessionStorage until Supabase persists the session
 * (max 5 s).
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
