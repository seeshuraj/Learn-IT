import React, { useEffect, useState } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";

/**
 * College settings an admin controls. Only settings the system actually acts
 * on are shown here.
 *
 * AI features: when off, every AI call for the college (tutor, analytics
 * summaries, study plans, grading help, timetable reading) is refused with a
 * clear message. Takes effect within a minute.
 */

interface Usage { month: { used: number; budget: number | null; remaining: number | null } }

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const AdminSettings: React.FC = () => {
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAdminSettings()
      .then((data: any) => {
        const row = (Array.isArray(data) ? data : []).find((s: any) => s.key === "ai_enabled");
        setAiOn(row?.value !== "false");
      })
      .catch(() => setAiOn(true));
    api.getAiUsage(30).then((u: any) => setUsage(u)).catch(() => setUsage(null));
  }, []);

  const toggleAi = async () => {
    if (aiOn === null) return;
    const next = !aiOn;
    setSaving(true);
    try {
      await api.saveAdminSetting("ai_enabled", next ? "true" : "false");
      setAiOn(next);
      toast.success(next ? "AI features turned on" : "AI features turned off");
    } catch (e: any) {
      toast.error(e.message || "Could not change the setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <Toaster position="top-right" />
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-slate-500">Settings for your college.</p>
      </div>

      <section className="space-y-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="ai-title">
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-purple-500" />
          <h2 id="ai-title" className="text-lg font-bold text-slate-900">AI features</h2>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-slate-900" id="ai-switch-label">AI for students and professors</p>
            <p className="mt-0.5 text-sm text-slate-500">
              The AI tutor, analytics summaries, study plans, grading help and timetable reading.
              When off, these are unavailable for everyone in your college. Takes effect within a minute.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={!!aiOn}
            aria-labelledby="ai-switch-label"
            disabled={aiOn === null || saving}
            onClick={() => void toggleAi()}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${aiOn ? "bg-indigo-600" : "bg-slate-300"}`}
          >
            {saving
              ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-white" />
              : <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${aiOn ? "translate-x-6" : "translate-x-1"}`} />}
          </button>
        </div>

        {usage && (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            This month: <b>{fmt(usage.month.used)}</b> tokens used
            {usage.month.budget != null
              ? <> of your <b>{fmt(usage.month.budget)}</b> allowance ({fmt(usage.month.remaining ?? 0)} left).</>
              : <>, no monthly limit.</>}
            <span className="mt-1 block text-xs text-slate-500">To change the allowance, contact LearnIT.</span>
          </div>
        )}
      </section>
    </div>
  );
};
