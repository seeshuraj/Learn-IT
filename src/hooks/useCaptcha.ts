/**
 * useCaptcha.ts — hCaptcha integration hook.
 *
 * STATUS: DISABLED — captcha is fully bypassed.
 *
 * Root cause of the `captcha protection: request disallowed (sitekey-secret-mismatch)` error:
 *   hCaptcha is still ENABLED in Supabase Dashboard with a mismatched secret key.
 *   Supabase rejects ALL signInWithPassword calls at the server side, even when
 *   the frontend sends no captchaToken, if the Dashboard toggle is ON.
 *
 * REQUIRED ACTION (dashboard only — no code change):
 *   Supabase Dashboard → Authentication → Bot and Abuse Protection → DISABLE hCaptcha.
 *
 * To re-enable captcha later:
 *   1. Go to dashboard.hcaptcha.com → create/select a site → copy the Site Key.
 *   2. Set VITE_HCAPTCHA_SITE_KEY=<site-key> in Vercel → Environment Variables.
 *   3. In Supabase Dashboard → Authentication → Bot and Abuse Protection,
 *      enable hCaptcha and paste the SECRET KEY from the SAME hCaptcha site.
 *   4. Both keys MUST come from the same hCaptcha site entry — never mix.
 *   5. Replace the body of useCaptcha() below with the real SDK integration.
 */

import { useRef, useState, useCallback } from 'react';

export interface UseCaptchaReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  token: string | null;
  reset: () => void;
  ready: boolean;
  /** True when captcha is not configured — login proceeds without a token. */
  disabled: boolean;
}

export function useCaptcha(): UseCaptchaReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const [token]      = useState<string | null>(null);
  const reset        = useCallback(() => {}, []);

  // Disabled: no captchaToken is ever sent to supabase.auth.signInWithPassword.
  // The Supabase Dashboard hCaptcha toggle MUST also be OFF for logins to succeed.
  return { containerRef, token, reset, ready: true, disabled: true };
}
