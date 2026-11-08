import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../services/supabaseClient";
import { API_BASE } from "../services/api";
import { AuthShell } from "../components/brand/AuthShell";
import { NewPasswordForm } from "../components/brand/NewPasswordForm";


// Captured at module load: supabase-js strips the URL hash once it has read the recovery tokens.
const initialHash = typeof window !== "undefined" ? window.location.hash : "";

type Status = "checking" | "ready" | "invalid";

/** Landing page for the link in Supabase's recovery email. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>(() =>
    /error_code=|error=/.test(initialHash) ? "invalid" : "checking",
  );

  useEffect(() => {
    if (status !== "checking") return;
    let settled = false;
    const settle = (s: Status) => { if (!settled) { settled = true; setStatus(s); } };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) settle("ready");
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) settle("ready"); });
    const timer = window.setTimeout(() => settle("invalid"), 10000);

    return () => { sub.subscription.unsubscribe(); window.clearTimeout(timer); };
  }, [status]);

  async function savePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (/different from the old/i.test(error.message)) throw new Error("Choose a password you haven't used before.");
      throw new Error(error.message);
    }

    // Clear any pending first-login password change; the new password is already saved.
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ newPassword: password }),
      }).catch(() => undefined);
    }

    await supabase.auth.signOut();
    navigate("/login?reset=1", { replace: true });
  }

  if (status === "invalid") {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work once and expire after an hour. Request a new one and use the latest email."
      >
        <Link to="/forgot-password" className="lp-focus lp-btn lp-btn-lg w-full">Send a new link</Link>
      </AuthShell>
    );
  }

  if (status === "checking") {
    return (
      <AuthShell title="Checking your link…">
        <p className="text-[14px] text-muted" role="status">One moment.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="You'll sign in with it next time.">
      <NewPasswordForm submitLabel="Save password" onSubmit={savePassword} />
    </AuthShell>
  );
}
