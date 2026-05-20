/**
 * useCaptcha.ts — hCaptcha integration hook.
 *
 * DISABLED (2026-05-20):
 *   hCaptcha is currently disabled because the site-key set in
 *   VITE_HCAPTCHA_SITE_KEY does not match the secret-key configured in
 *   Supabase Auth → Bot Protection. This mismatch produces:
 *
 *     captcha protection: request disallowed (sitekey-secret-mismatch)
 *
 *   and causes HTTP 400 on every signInWithPassword call.
 *
 *   To re-enable:
 *     1. In hCaptcha dashboard (dashboard.hcaptcha.com), open your site.
 *     2. Copy the Site Key  → set as VITE_HCAPTCHA_SITE_KEY in Vercel env vars.
 *     3. Copy the Secret Key → paste into Supabase Dashboard:
 *        Authentication → Bot and Abuse Protection → Enable hCaptcha.
 *     4. Both keys MUST come from the same hCaptcha site entry.
 *     5. Remove the early-return below and restore the SDK loading logic.
 */

import { useRef, useState, useCallback } from 'react';

export interface UseCaptchaReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  token: string | null;
  reset: () => void;
  ready: boolean;
  /** True when captcha is not configured / disabled. */
  disabled: boolean;
}

export function useCaptcha(): UseCaptchaReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const [token]      = useState<string | null>(null);
  const reset        = useCallback(() => {}, []);

  // Captcha is globally disabled until the sitekey/secret-key mismatch is
  // resolved. Login proceeds without a captcha token.
  return { containerRef, token, reset, ready: true, disabled: true };
}
