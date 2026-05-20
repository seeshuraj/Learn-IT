/**
 * useCaptcha.ts — hCaptcha integration hook.
 *
 * FIX (2026-05-20):
 *   - Previous version loaded the script with `render=explicit` but called
 *     hcaptcha.render() in `.onload`, which fires BEFORE hCaptcha's own
 *     internal SDK is ready. This caused repeated 403 checksiteconfig requests.
 *   - Correct approach: use the `onload` URL param so hCaptcha calls OUR
 *     callback (window.__hcaptchaOnLoad) once it is fully ready, THEN render.
 *   - Script singleton prevents duplicate <script> injection across HMR.
 *
 * If VITE_HCAPTCHA_SITE_KEY is not set the hook is a no-op: token is always
 * null, disabled = true, ready = true immediately so login never blocks.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    hcaptcha: {
      render: (container: HTMLElement | string, params: object) => string;
      reset:  (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    // Callback invoked by hCaptcha SDK once it is fully initialised.
    __hcaptchaOnLoad?: () => void;
  }
}

const SITE_KEY  = (import.meta as any).env?.VITE_HCAPTCHA_SITE_KEY as string | undefined;
const SCRIPT_ID = 'hcaptcha-script';

// Module-level promise shared across all hook instances.
let _sdkReady: Promise<void> | null = null;

/**
 * Injects the hCaptcha script exactly once and resolves when the SDK fires
 * its `onload` callback. Safe to call multiple times — always returns the
 * same promise.
 */
function loadHCaptchaSDK(): Promise<void> {
  if (_sdkReady) return _sdkReady;

  // If the script tag is already present (e.g. injected elsewhere), wait for
  // the window callback or resolve immediately if hcaptcha already exists.
  if (typeof window.hcaptcha !== 'undefined') {
    _sdkReady = Promise.resolve();
    return _sdkReady;
  }

  _sdkReady = new Promise<void>((resolve, reject) => {
    // hCaptcha will call window.__hcaptchaOnLoad when it is fully ready.
    window.__hcaptchaOnLoad = resolve;

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id    = SCRIPT_ID;
      // `onload=__hcaptchaOnLoad` tells hCaptcha to invoke our callback
      // after its internal init, not just when the <script> tag executes.
      // `render=explicit` prevents auto-rendering of .h-captcha divs.
      script.src   = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__hcaptchaOnLoad';
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        _sdkReady = null; // allow retry on next mount
        reject(new Error('[useCaptcha] Failed to load hCaptcha script'));
      };
      document.head.appendChild(script);
    }
    // If the tag exists but hcaptcha is not defined yet, the onload param
    // will still fire when the script finishes executing.
  });

  return _sdkReady;
}

export interface UseCaptchaReturn {
  /** Attach to the container div that hCaptcha will render into. */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Verified token. null until user solves the challenge. */
  token: string | null;
  /** Reset the widget after a failed attempt. */
  reset: () => void;
  /** True once the widget is rendered and interactive. */
  ready: boolean;
  /** True when VITE_HCAPTCHA_SITE_KEY is not configured. */
  disabled: boolean;
}

export function useCaptcha(): UseCaptchaReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef  = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(!SITE_KEY);

  const disabled = !SITE_KEY;

  const reset = useCallback(() => {
    setToken(null);
    if (widgetIdRef.current != null && window.hcaptcha) {
      try { window.hcaptcha.reset(widgetIdRef.current); } catch (_) {}
    }
  }, []);

  useEffect(() => {
    if (disabled || !containerRef.current) return;

    let unmounted = false;

    loadHCaptchaSDK()
      .then(() => {
        // Guard: component may have unmounted while SDK was loading.
        if (unmounted || !containerRef.current) return;
        // Guard: avoid double-rendering on React Strict Mode double-invoke.
        if (widgetIdRef.current != null) return;

        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey:           SITE_KEY,
          theme:             'light',
          size:              'normal',
          callback:          (tk: string) => { if (!unmounted) setToken(tk); },
          'expired-callback':            () => { if (!unmounted) setToken(null); },
          'error-callback':              () => { if (!unmounted) setToken(null); },
        });

        if (!unmounted) setReady(true);
      })
      .catch(err => {
        console.error('[useCaptcha] SDK load error — captcha disabled for this session:', err);
        // Fail open so login is not permanently broken if CDN is unreachable.
        if (!unmounted) setReady(true);
      });

    return () => {
      unmounted = true;
      if (widgetIdRef.current != null && window.hcaptcha) {
        try { window.hcaptcha.remove(widgetIdRef.current); } catch (_) {}
        widgetIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return { containerRef, token, reset, ready, disabled };
}
