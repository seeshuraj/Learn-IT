import React from "react";
import { supabase } from "../services/supabaseClient";
import { API_BASE } from "../services/api";
import { AuthShell } from "../components/brand/AuthShell";
import { NewPasswordForm } from "../components/brand/NewPasswordForm";


interface Props {
  onSuccess: () => void;
}

/** First sign-in: accounts created by an admin must set a personal password. */
const ChangePasswordPage: React.FC<Props> = ({ onSuccess }) => {
  async function savePassword(newPassword: string) {
    // 1. Update password in Supabase Auth
    const { error: authErr } = await supabase.auth.updateUser({ password: newPassword });
    if (authErr) throw authErr;

    // 2. Tell backend to clear force_password_change
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`${API_BASE}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to update password");
    }
    onSuccess();
  }

  return (
    <AuthShell
      title="Set your password"
      subtitle="Your college administrator created this account. Choose a personal password to continue."
    >
      <NewPasswordForm submitLabel="Set password and continue" onSubmit={savePassword} />
    </AuthShell>
  );
};

export default ChangePasswordPage;
