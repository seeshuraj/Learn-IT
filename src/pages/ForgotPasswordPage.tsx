import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import { AuthShell, FormError } from "../components/brand/AuthShell";

/**
 * Requests a Supabase recovery email. The confirmation is the same whether or
 * not the address has an account, so the page can't be used to discover who
 * is registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return setError("Enter your college email address.");

    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Only rate limiting is surfaced; anything else shows the neutral confirmation.
      if (err && (err.status === 429 || /security purposes|rate limit/i.test(err.message))) {
        setError("A reset email was requested recently. Wait a minute, then try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't reach LearnIT. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={<>If <strong className="font-semibold text-ink">{email.trim()}</strong> has a LearnIT account, a reset link is on its way. It works once and expires in an hour.</>}
      >
        <p className="text-[14px] leading-[1.55] text-muted">
          Nothing after a few minutes? Check spam, or ask your college's LearnIT administrator.
        </p>
        <Link to="/login" className="lp-focus lp-btn-ghost lp-btn-lg mt-8 w-full">Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your college email and we'll send you a link to set a new password.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[14px] font-medium">College email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@college.edu.in"
            className="lp-input"
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={loading} className="lp-focus lp-btn lp-btn-lg w-full">
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-6 text-[14px] text-muted">
        Remembered it?{" "}
        <Link to="/login" className="lp-focus rounded font-medium text-brand underline underline-offset-4 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
