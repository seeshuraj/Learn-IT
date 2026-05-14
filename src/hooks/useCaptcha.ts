/**
 * useCaptcha.ts — hCaptcha integration hook.
 *
 * Dynamically loads the hCaptcha script once, renders the widget into a given
 * container ref, and exposes the current verified token + a reset function.
 *
 * Usage:
 *   const { containerRef, token, reset, ready } = useCaptcha();
 *   // Mount <div ref={containerRef} /> in your JSX.
 *   // Pass `token` to supabaseSignIn when submitting.
 *
 * If VITE_HCAPTCHA_SITE_KEY is not set (local dev without captcha configured),
 * the hook is a no-op: token is always null, ready is true immediately.
 * The login form must allow null token in that case.
 *
 * hCaptcha docs: https://docs.hcaptcha.com/
 */

import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    hcaptcha: {
      render: (container: HTMLElement, params: object) => string;
      reset:  (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SITE_KEY = (import.meta as any).env?.VITE_HCAPTCHA_SITE_KEY as string | undefined;
const SCRIPT_SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit';
const SCRIPT_ID  = 'hcaptcha-script';

let scriptLoadPromise: Promise<void> | null = null;

function loadHCaptchaScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  if (document.getElementById(SCRIPT_ID)) {
    scriptLoadPromise = Promise.resolve();
    return scriptLoadPromise;
  }
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id    = SCRIPT_ID;
    script.src   = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load hCaptcha script'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface UseCaptchaReturn {
  /** Attach to the container div that hCaptcha will render into. */
  containerRef: React.RefObject<HTMLDivElement>;
  /** The verified captcha token. null until the user solves the challenge. */
  token: string | null;
  /** Reset the widget (call after a failed login attempt). */
  reset: () => void;
  /** True once the widget is rendered and ready for interaction. */
  ready: boolean;
  /** True if VITE_HCAPTCHA_SITE_KEY is not configured (dev / test mode). */
  disabled: boolean;
}

export function useCaptcha(): UseCaptchaReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef  = useRef<string | null>(null);
  const [token, setToken]   = useState<string | null>(null);
  const [ready, setReady]   = useState(!SITE_KEY); // immediately ready if disabled

  const disabled = !SITE_KEY;

  const reset = useCallback(() => {
    setToken(null);
    if (widgetIdRef.current && window.hcaptcha) {
      window.hcaptcha.reset(widgetIdRef.current);
    }
  }, []);

  useEffect(() => {
    if (disabled || !containerRef.current) return;

    let unmounted = false;

    loadHCaptchaScript()
      .then(() => {
        if (unmounted || !containerRef.current || widgetIdRef.current) return;
        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey:  SITE_KEY,
          theme:    'light',
          size:     'normal',
          callback: (tk: string) => { if (!unmounted) setToken(tk); },
          'expired-callback':    () => { if (!unmounted) setToken(null); },
          'error-callback':      () => { if (!unmounted) setToken(null); },
        });
        if (!unmounted) setReady(true);
      })
      .catch(err => {
        console.error('[useCaptcha] script load error:', err);
        // Fail open in dev — production should have a valid SITE_KEY
        if (!unmounted) setReady(true);
      });

    return () => {
      unmounted = true;
      if (widgetIdRef.current && window.hcaptcha) {
        try { window.hcaptcha.remove(widgetIdRef.current); } catch (_) {}
        widgetIdRef.current = null;
      }
    };
  }, [disabled]);

  return { containerRef, token, reset, ready, disabled };
}
