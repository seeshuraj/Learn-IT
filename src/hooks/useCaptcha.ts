/**
 * useCaptcha.ts — hCaptcha integration hook.
 *
 * Currently DISABLED: captcha is bypassed (disabled: true) because
 * VITE_HCAPTCHA_SITE_KEY is not set in Vercel env vars.
 *
 * To re-enable:
 *   1. Go to dashboard.hcaptcha.com → copy the Site Key for your site.
 *   2. Set VITE_HCAPTCHA_SITE_KEY=<site-key> in Vercel → Environment Variables.
 *   3. In Supabase Dashboard → Authentication → Bot and Abuse Protection,
 *      enable hCaptcha and paste the SECRET KEY from the same hCaptcha site.
 *   4. Both keys MUST come from the same hCaptcha site entry.
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

  // Disabled until VITE_HCAPTCHA_SITE_KEY is set and keys are matched.
  return { containerRef, token, reset, ready: true, disabled: true };
}
