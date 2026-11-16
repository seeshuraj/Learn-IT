/**
 * ExamsPage — the signed-in student's or professor's exams from published
 * timetables, grouped by day, and the phone-calendar link.
 *
 * Route: /exams (student, instructor)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarDays, Loader2 } from 'lucide-react';
import { api, type UpcomingExam } from '../services/api';
import { CalendarLinkCard, ExamRow, dayLabel, daysUntil } from '../components/exams/UpcomingExams';

export default function ExamsPage({ user }: { user: { role: string } }) {
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  const [err, setErr] = useState('');

  const load = () => { setErr(''); api.getUpcomingExams(180).then(setExams).catch(e => setErr(e.message)); };
  useEffect(load, []);

  const byDay = useMemo(() => {
    const m = new Map<string, UpcomingExam[]>();
    for (const e of exams ?? []) m.set(e.exam_date, [...(m.get(e.exam_date) ?? []), e]);
    return [...m.entries()];
  }, [exams]);

  const professor = user.role === 'instructor';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <CalendarDays className="h-6 w-6 text-indigo-600" /> Exams
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {professor ? 'Exams for the courses you teach, from the published timetables.' : 'Your exams from the published timetables.'}
        </p>
      </div>

      {err ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
          <button onClick={load} className="ml-auto font-semibold underline">Try again</button>
        </div>
      ) : !exams ? (
        <div className="flex items-center justify-center py-16 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
      ) : exams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
          No exams scheduled. You'll get a notification when your college publishes a timetable.
        </p>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, list]) => {
            const n = daysUntil(day);
            return (
              <section key={day} className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={dayLabel(day)}>
                <h2 className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
                  <span className="font-semibold text-slate-900">{dayLabel(day)}</span>
                  <span className={`text-xs ${n <= 1 ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                    {n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}
                  </span>
                </h2>
                <ul className="divide-y divide-slate-100">{list.map(e => <ExamRow key={e.id} e={e} showDate={false} />)}</ul>
              </section>
            );
          })}
          {professor && (
            <p className="text-sm text-slate-600">
              Each exam already has an assessment waiting for marks under <Link to="/assessments" className="font-semibold text-indigo-700 underline underline-offset-2">Assessments</Link>.
            </p>
          )}
        </div>
      )}

      <CalendarLinkCard />
    </div>
  );
}
