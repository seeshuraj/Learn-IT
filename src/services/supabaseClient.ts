/**
 * supabaseClient.ts — browser-side Supabase Auth singleton.
 *
 * v8 (2026-05-21)
 *
 * Fixes:
 *   - Suppresses console.debug in production (was logging on every chunk load)
 *   - Singleton still stored on globalThis to prevent double GoTrueClient instances
 *     across Vite async chunk boundaries
 *   - captchaToken is NEVER forwarded while hCaptcha is disabled in useCaptcha.ts
 *
 * NOTE — sitekey-secret-mismatch 400s:
 *   These come from Supabase Auth server rejecting the signInWithPassword call
 *   because hCaptcha is still ENABLED in the Supabase Dashboard with a mismatched
 *   secret key — even though the frontend no longer sends a captchaToken.
 *   Fix: Supabase Dashboard → Authentication → Bot and Abuse Protection → DISABLE hCaptcha.
 *   No code change required once that toggle is off.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  ?? '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const IS_DEV        = import.meta.env.DEV === true;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
    'Ensure both are listed in vite.config.ts `define` AND set in Vercel env vars.',
  );
}

// ── Cross-chunk singleton via globalThis ──────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __learnit_supabase_client__: SupabaseClient | undefined;
}

function getInstance(): SupabaseClient {
  if (globalThis.__learnit_supabase_client__) {
    if (IS_DEV) console.debug('[supabaseClient] reusing existing singleton');
    return globalThis.__learnit_supabase_client__;
  }

  if (IS_DEV) console.debug('[supabaseClient] creating singleton — URL:', SUPABASE_URL.slice(0, 40));

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
