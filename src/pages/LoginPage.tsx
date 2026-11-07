import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { User } from '../types';
import { api, supabaseSignIn } from '../services/api';
import { waitForSession } from '../services/supabaseClient';
import { useCaptcha } from '../hooks/useCaptcha';
import { Logo } from '../components/brand/Logo';
import { MarkedSheet } from '../components/brand/MarkedSheet';

const PILOT_MAILTO =
  'mailto:contact@learnitanalytics.com?subject=' + encodeURIComponent('LearnIT pilot for our college');

interface LoginPageProps {
  onLogin: (user: User) => void;
}

/** Turns auth/API failures into a message that says what to do next. */
function signInError(err: any): string {
  const msg: string = err?.message ?? '';
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Check both and try again.";
  if (/email not confirmed/i.test(msg)) return 'This account has not been activated yet. Ask your college administrator.';
  if (/captcha/i.test(msg)) return 'The security check expired. Complete it again, then sign in.';
  if (/no active institution membership|not provisioned/i.test(msg)) {
    return 'Your account is not linked to a college yet. Ask your college administrator.';
  }
  if (/too many/i.test(msg)) return 'Too many attempts. Wait a minute, then try again.';
  return 'Sign-in failed. Check your connection and try again.';
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [justReset] = useState(() => new URLSearchParams(window.location.search).has('reset'));

  // hCaptcha hook: currently returns disabled=true (see useCaptcha.ts for re-enabling).
  const { containerRef, token: captchaToken, reset: resetCaptcha, ready: captchaReady, disabled: captchaDisabled } = useCaptcha();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!captchaDisabled && !captchaToken) {
      setError('Complete the security check, then sign in.');
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      // 1. Authenticate with Supabase Auth (forwarding the captcha token if any).
      const { session } = await supabaseSignIn(
        normalizedEmail,
        password,
        captchaDisabled ? undefined : (captchaToken ?? undefined),
      );
      if (!session?.access_token) throw new Error('No session returned');
      // 2. Wait until the session is persisted so parallel requests find it.
      await waitForSession(session.access_token);
      // 3. Load the LearnIT profile (role and college) from the API.
      const user = await api.login(normalizedEmail);
      onLogin(user);
    } catch (err: any) {
      setError(signInError(err));
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Form column */}
      <div className="flex min-h-screen flex-col px-4 py-6 sm:px-10 lg:px-16">
        <header>
          <Link to="/landing" className="lp-focus inline-block rounded-md" aria-label="LearnIT home">
            <Logo />
          </Link>
        </header>

        <main className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-[24rem]">
            <h1 className="lp-display text-[clamp(2rem,5vw,2.5rem)] font-extrabold leading-[1.05] tracking-[-0.03em]">
              Sign in to LearnIT
            </h1>
            <p className="mt-3 text-[16px] leading-[1.55] text-muted">
              Use the email address your college registered for you.
            </p>

            {justReset && (
              <p role="status" className="mt-6 rounded-[10px] border border-emerald-600/25 bg-emerald-50 px-4 py-3 text-[14px] leading-[1.5] text-emerald-800">
                Password updated. Sign in with your new password.
              </p>
            )}

            <form onSubmit={handleLogin} className="mt-9 space-y-5" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[14px] font-medium">College email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@college.edu.in"
                  className="lp-input"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-[14px] font-medium">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="lp-input pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="lp-focus absolute inset-y-0 right-1 my-1 flex w-10 items-center justify-center rounded-md text-muted hover:text-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              {!captchaDisabled && (
                <div>
                  <div ref={containerRef} className="h-captcha" />
                  {!captchaReady && <p className="mt-1 text-[13px] text-muted">Loading security check…</p>}
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-[10px] border border-pen/25 bg-[#FBEDEF] px-4 py-3 text-[14px] leading-[1.5] text-pen">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || (!captchaDisabled && !captchaReady)}
                className="lp-focus lp-btn lp-btn-lg w-full"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-5 text-[14px] leading-[1.55]">
              <Link to="/forgot-password" className="lp-focus rounded font-medium text-brand underline underline-offset-4 hover:text-brand-700">
                Forgot your password?
              </Link>
            </p>

            <div className="mt-10 border-t border-rule pt-6 text-[14px] leading-[1.55] text-muted">
              Is your college not on LearnIT yet?{' '}
              <a href={PILOT_MAILTO} className="lp-focus rounded font-medium text-brand underline underline-offset-4 hover:text-brand-700">
                Book a pilot
              </a>
            </div>
          </div>
        </main>

        <footer className="text-[13px] text-muted">© {new Date().getFullYear()} LearnIT Analytics Pvt Ltd</footer>
      </div>

      {/* Visual column: the marked sheet, tilting in 3D toward the pointer */}
      <aside
        data-tilt-area
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative mx-auto w-full max-w-[34rem]">
          <p className="lp-display text-[clamp(1.8rem,2.6vw,2.4rem)] font-bold leading-[1.08] tracking-[-0.025em] text-white">
            Every mark, explained.
          </p>
          <p className="mt-3 max-w-[28rem] text-[16px] leading-[1.55] text-white/70">
            After each unit test, students see the topics they lost marks on and a plan for the week.
          </p>
          <MarkedSheet compact className="mt-10" />
        </div>
      </aside>
    </div>
  );
}
