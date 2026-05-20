/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * FIX (2026-05-20 v3 — definitive):
 *
 * Root-cause of the :1 / :2 GoTrueClient warning:
 *   Vite code-splits the app into several async chunks. When the browser
 *   loads chunk A and chunk B in parallel (both import supabaseClient),
 *   the module-level `let _instance` variable is NOT shared across chunk
 *   boundaries — only `globalThis` is. Even the window-based guard races
 *   when two chunks evaluate this module before either has written the key.
 *
 * Definitive fix:
 *   Use `globalThis.__learnit_supabase__` as the authoritative singleton
 *   store. globalThis is shared across ALL Vite chunks in the same browser
 *   context, so `getInstance()` checking it first guarantees createClient
 *   is called at most once per page lifetime.
 *
 * The anon key is safe to ship in the browser — it only grants access to
 * Supabase Auth. All data operations go through our Express API.
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
// globalThis is shared across ALL Vite chunks in the same browser context.
// This is the only reliable cross-chunk singleton mechanism.

declare global {
  // eslint-disable-next-line no-var
  var __learnit_supabase__: SupabaseClient | undefined;
}

function getInstance(): SupabaseClient {
  if (globalThis.__learnit_supabase__) return globalThis.__learnit_supabase__;

  globalThis.__learnit_supabase__ = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      storage:            typeof window !== 'undefined' ? window.sessionStorage as any : undefined,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });

  return globalThis.__learnit_supabase__;
}

/**
 * `supabase` — lazily-resolved Proxy backed by a globalThis singleton.
 *
 * - Lazy: createClient is NOT called at module parse/evaluation time.
 * - Safe across Vite chunk boundaries: globalThis is shared by all chunks.
 * - Safe in React 18 Strict Mode: double-eval still hits the globalThis
 *   guard on the second pass and reuses the existing instance.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return (getInstance() as any)[prop];
  },
  set(_target, prop: string | symbol, value: any) {
    (getInstance() as any)[prop as string] = value;
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
