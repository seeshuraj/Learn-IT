/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * v5 (2026-05-21)
 *
 * Root cause of the persistent :1/:2 GoTrueClient double-instance warning:
 *   The globalThis guard used in v4 does NOT survive Vite's production build.
 *   Vite deduplicates ESM modules by file path at bundle time, so there is
 *   only ever ONE copy of this module in the bundle — meaning globalThis
 *   was never pre-populated by a prior import, and getInstance() always ran
 *   createClient() on every module evaluation.
 *
 * Fix (v5):
 *   Use a plain module-level `let` variable. In an ESM module (Vite bundles
 *   as ESM), the module is evaluated exactly once per JS realm. The `let`
 *   survives for the lifetime of the page without any globalThis tricks.
 *
 * NOTE ON hCaptcha:
 *   hCaptcha has been disabled in useCaptcha.ts (disabled: true) because
 *   the Vercel env VITE_HCAPTCHA_SITE_KEY is unset / mismatched.
 *   You MUST ALSO disable hCaptcha in Supabase Dashboard:
 *     Authentication → Bot and Abuse Protection → toggle OFF hCaptcha.
 *   Until that is done, Supabase will reject every signInWithPassword with:
 *     "captcha protection: request disallowed (no captcha_token found)"
 *   even though the frontend sends no token.
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

// ── Module-level singleton (ESM guarantees single evaluation per realm) ───────
let _client: SupabaseClient | null = null;

function getInstance(): SupabaseClient {
  if (_client) return _client;

  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      storage:            typeof window !== 'undefined' ? window.sessionStorage as any : undefined,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  });

  return _client;
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
