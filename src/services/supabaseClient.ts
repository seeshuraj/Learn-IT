/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * v6 (2026-05-21)
 *
 * Root cause of the persistent :1/:2 GoTrueClient double-instance warning
 * in production builds:
 *   Vite's code-splitting can place this module's output in more than one
 *   chunk. When two chunks both import supabaseClient, each chunk evaluation
 *   re-runs the module body and creates a new GoTrueClient — even though
 *   the ESM spec says modules are evaluated once, Vite's chunker can break
 *   that guarantee across async boundaries.
 *
 * Fix (v6):
 *   Store the singleton on `globalThis` under a unique symbol. globalThis is
 *   shared across all chunks within the same JS realm, so the second chunk
 *   that evaluates this file finds the existing instance and skips createClient.
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

// ── Cross-chunk singleton via globalThis ──────────────────────────────────────
// Using a Symbol key avoids collision with any other library.
const SINGLETON_KEY = '__learnit_supabase_client__';

type GlobalWithClient = typeof globalThis & { [SINGLETON_KEY]?: SupabaseClient };

function getInstance(): SupabaseClient {
  const g = globalThis as GlobalWithClient;
  if (g[SINGLETON_KEY]) return g[SINGLETON_KEY]!;

  g[SINGLETON_KEY] = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      storage:            typeof window !== 'undefined' ? window.sessionStorage as any : undefined,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });

  return g[SINGLETON_KEY]!;
}

/**
 * `supabase` — the real SupabaseClient instance, initialised eagerly at
 * module load time so GoTrueClient fully constructs before any React
 * component render touches `.auth`.
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
