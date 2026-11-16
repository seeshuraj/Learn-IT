import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Check, Copy, Loader2, MapPin } from 'lucide-react';
import { api, type UpcomingExam } from '../../services/api';

/** "Wed 2 Dec" in Indian English. */
export const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function timeLabel(e: Pick<UpcomingExam, 'session' | 'start_time' | 'end_time'>) {
  const t = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  };
  if (e.start_time) return `${t(e.start_time)}${e.end_time ? `–${t(e.end_time)}` : ''}`;
  return e.session === 'FN' ? 'Forenoon (FN)' : e.session === 'AN' ? 'Afternoon (AN)' : 'Time not given';
}

/** Days from today (IST) to the exam: 0 today, 1 tomorrow. */
export function daysUntil(d: string, now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

const when = (n: number) => n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;

export function ExamRow({ e, showDate = true }: { e: UpcomingExam; showDate?: boolean }) {
  const n = daysUntil(e.exam_date);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      {showDate && (
        <div className="w-20 shrink-0">
          <p className="text-sm font-semibold text-slate-900">{dayLabel(e.exam_date)}</p>
          <p className={`text-xs ${n <= 1 ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{when(n)}</p>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{e.course_code ? `${e.course_code}: ` : ''}{e.course_name ?? 'Exam'}</p>
        <p className="text-xs text-slate-500">
          {e.title} · {timeLabel(e)}
          {e.venue && <> · <MapPin className="-mt-0.5 inline h-3 w-3" /> {e.venue}</>}
        </p>
      </div>
    </li>
  );
}

/** Dashboard card: the next few exams. Hidden when there are none. */
export function UpcomingExamsCard({ limit = 4 }: { limit?: number }) {
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  useEffect(() => { api.getUpcomingExams(60).then(setExams).catch(() => setExams([])); }, []);
  if (!exams || exams.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm" aria-labelledby="upcoming-exams">
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 id="upcoming-exams" className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <CalendarDays className="h-5 w-5 text-indigo-600" /> Upcoming exams
        </h2>
        <Link to="/exams" className="flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-700">
          All exams <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {exams.slice(0, limit).map(e => <ExamRow key={e.id} e={e} />)}
      </ul>
    </section>
  );
}

/** Private subscribe link for Google/Apple/Outlook calendars. */
export function CalendarLinkCard() {
  const [state, setState] = useState<{ exists: boolean } | null>(null);
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.getCalendarLink().then(setState).catch(() => setState({ exists: false })); }, []);

  const make = async () => {
    if (state?.exists && !window.confirm('Make a new link? The old link stops working; calendars using it need the new one.')) return;
    setBusy(true); setError('');
    try { setLink(await api.createCalendarLink()); setState({ exists: true }); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const off = async () => {
    if (!window.confirm('Turn the calendar link off? Calendars using it stop updating.')) return;
    await api.deleteCalendarLink().catch(() => {});
    setLink(null); setState({ exists: false });
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="cal-link">
      <h2 id="cal-link" className="font-semibold text-slate-900">Add exams to your phone calendar</h2>
      <p className="mt-1 text-sm text-slate-600">
        Your exams appear in Google, Apple or Outlook Calendar with a reminder the day before, and update when the timetable changes.
        The link is private to you: don't share it.
      </p>
      {link ? (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <input readOnly value={link.url} aria-label="Calendar link" onFocus={e => e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs" />
            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal)}`} target="_blank" rel="noopener noreferrer"
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Add to Google Calendar</a>
            <a href={link.webcal} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Apple / Outlook</a>
          </div>
          <p className="text-xs text-slate-500">This link is shown once. If you lose it, make a new one.</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={make} disabled={busy || !state}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {state?.exists ? 'Make a new link' : 'Get my calendar link'}
          </button>
          {state?.exists && <button onClick={off} className="text-sm font-medium text-slate-600 underline underline-offset-2">Turn off</button>}
          {state?.exists && <span className="text-xs text-slate-500">You already have a link in use.</span>}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

