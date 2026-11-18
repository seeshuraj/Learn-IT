import React, { useEffect, useState } from "react";
import { CalendarRange, Cpu, Loader2 } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";

/**
 * College settings an admin controls. Only settings the system actually acts
 * on are shown here.
 *
 * AI features: when off, every AI call for the college (tutor, analytics
 * summaries, study plans, grading help, timetable reading) is refused with a
 * clear message. Takes effect within a minute.
 *
 * Current semester: decides which semester's courses each year's students
 * get (year 2 → semester 3 or 4). Automatic follows the calendar.
 */

type Term = "auto" | "odd" | "even";
const TERM_OPTIONS: { value: Term; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Odd semesters July–December, even semesters January–June" },
  { value: "odd",  label: "Odd semester", hint: "Semesters 1, 3, 5, 7" },
  { value: "even", label: "Even semester", hint: "Semesters 2, 4, 6, 8" },
];

interface Usage { month: { used: number; budget: number | null; remaining: number | null } }

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const AdminSettings: React.FC = () => {
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saving, setSaving] = useState(false);
  const [term, setTerm] = useState<Term | null>(null);
  const [termSaving, setTermSaving] = useState(false);

  useEffect(() => {
    api.getAdminSettings()
      .then((data: any) => {
        const rows = Array.isArray(data) ? data : [];
        setAiOn(rows.find((s: any) => s.key === "ai_enabled")?.value !== "false");
        const t = rows.find((s: any) => s.key === "current_term")?.value;
        setTerm(t === "odd" || t === "even" ? t : "auto");
      })
      .catch(() => { setAiOn(true); setTerm("auto"); });
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

  const changeTerm = async (next: Term) => {
    if (next === term) return;
    setTermSaving(true);
    try {
      const r: any = await api.saveAdminSetting("current_term", next);
      setTerm(next);
      const e = r?.enrolments;
      toast.success(e && (e.added || e.removed)
        ? `Saved. ${e.added} class enrolments added, ${e.removed} withdrawn.`
        : "Saved. Class enrolments are up to date.");
    } catch (e: any) {
      toast.error(e.message || "Could not change the semester");
    } finally {
      setTermSaving(false);
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

      <section className="space-y-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="term-title">
        <div className="flex items-center gap-3">
          <CalendarRange className="h-5 w-5 text-indigo-500" />
          <h2 id="term-title" className="text-lg font-bold text-slate-900">Current semester</h2>
        </div>
        <p className="text-sm text-slate-500">
          Students get their department's courses for their year's current semester: a 2nd-year student gets semester 3 or 4 courses,
          including students who join mid-way. Courses an admin enrolled by hand are never removed.
        </p>
        <div role="radiogroup" aria-labelledby="term-title" className="grid gap-2 sm:grid-cols-3">
          {TERM_OPTIONS.map(o => (
            <button
              key={o.value}
              role="radio"
              aria-checked={term === o.value}
              disabled={term === null || termSaving}
              onClick={() => void changeTerm(o.value)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${term === o.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{o.hint}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
