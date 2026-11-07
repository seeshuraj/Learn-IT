import React, { useState } from "react";
import { FormError } from "./AuthShell";

const MIN_LENGTH = 8;

interface NewPasswordFormProps {
  submitLabel: string;
  /** Persists the password; throw to show the error message under the form. */
  onSubmit: (password: string) => Promise<void>;
}

/** New-password + confirm fields with client-side checks, used by reset and first-login pages. */
export const NewPasswordForm: React.FC<NewPasswordFormProps> = ({ submitLabel, onSubmit }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");

    setLoading(true);
    try {
      await onSubmit(password);
    } catch (err: any) {
      setError(err?.message || "Could not update your password. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="new-password" className="mb-1.5 block text-[14px] font-medium">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="lp-input"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1.5 text-[13px] text-muted">At least {MIN_LENGTH} characters.</p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="mb-1.5 block text-[14px] font-medium">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="lp-input"
        />
      </div>

      {error && <FormError>{error}</FormError>}

      <button type="submit" disabled={loading} className="lp-focus lp-btn lp-btn-lg w-full">
        {loading ? "Saving…" : submitLabel}
      </button>
    </form>
  );
};
