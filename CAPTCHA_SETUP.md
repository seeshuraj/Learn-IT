# hCaptcha Setup & Current Status

## Current Status: DISABLED

Captcha is intentionally disabled. The frontend (`useCaptcha.ts`) returns `disabled: true` and never sends a `captchaToken` to Supabase.

## Why logins return 400 (`sitekey-secret-mismatch`)

Supabase Auth enforces captcha **server-side**. If the hCaptcha toggle is ON in the Supabase Dashboard — even with no token sent from the frontend — Supabase rejects every `signInWithPassword` call with:

```
captcha protection: request disallowed (sitekey-secret-mismatch)
```

## Fix (required — dashboard only)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. **Authentication** → **Bot and Abuse Protection**
3. Set hCaptcha to **OFF / Disabled**
4. Save

No code changes or redeployment needed.

---

## Re-enabling captcha in future

1. [dashboard.hcaptcha.com](https://dashboard.hcaptcha.com) → create or select a site
2. Copy the **Site Key** (public)
3. Vercel → Environment Variables → `VITE_HCAPTCHA_SITE_KEY=<site-key>` → Redeploy
4. Copy the **Secret Key** from the same hCaptcha site
5. Supabase Dashboard → Authentication → Bot and Abuse Protection → Enable hCaptcha → paste the **Secret Key**
6. Update `useCaptcha.ts` to load the hCaptcha JS SDK and return real tokens

> Both keys MUST come from the **same hCaptcha site entry**. Mixing site/secret from different sites causes the mismatch.
