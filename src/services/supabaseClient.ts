/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * v7 (2026-05-21)
 *
 * Root cause of the persistent :1/:2 GoTrueClient double-instance warning
 * in production builds:
 *
 *   Vite's code-splitting can place this module's output in more than one
 *   chunk. When two chunks both import supabaseClient, each chunk evaluation
 *   can re-run the module body and create a new GoTrueClient — even though
 *   the ESM spec says modules are evaluated once, Vite's chunker can break
 *   that guarantee across async chunk boundaries.
 *
 *   ADDITIONALLY (fixed in v7): if VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *   are not listed in vite.config.ts `define`, Vite bakes them as `undefined`
 *   in the production bundle, causing createClient to be called with an empty
 *   URL, which then triggers a second createClient when the page hydrates with
 *   the real values — producing the double-instance warning AND HTTP 400s.
 *
 * Fix (v7):
 *   1. vite.config.ts now forwards ALL VITE_* vars via Object.fromEntries so
 *      no var is ever silently undefined in the production bundle.
 *   2. Store the singleton on `globalThis` under a unique string key.
 *      globalThis is shared across all chunks within the same JS realm, so the
 *      second chunk that evaluates this file finds the existing instance and
 *      skips createClient entirely.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
    'Ensure both are listed in vite.config.ts `define` AND set in Vercel env vars.',
  );
}

// ── Cross-chunk singleton via globalThis ──────────────────────────────────────
const SINGLETON_KEY = '__learnit_supabase_client__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __learnit_supabase_client__: SupabaseClient | undefined;
}

function getInstance(): SupabaseClient {
  if (globalThis.__learnit_supabase_client__) {
    console.debug('[supabaseClient] reusing existing singleton');
    return globalThis.__learnit_supabase_client__;
  }

  console.debug('[supabaseClient] creating singleton — URL:', SUPABASE_URL.slice(0, 40));

  globalThis.__learnit_supabase_client__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      storage:            typeof window !== 'undefined' ? window.sessionStorage : undefined,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });

  return globalThis.__learnit_supabase_client__;
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
