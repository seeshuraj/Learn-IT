import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { api, type TodayStep } from '../../services/api';
import { daysUntil } from '../exams/UpcomingExams';

/**
 * Student dashboard: what the study plans say to do today (and anything
 * overdue), across courses. Ticking a step marks it done. Hidden when empty.
 */
export function TodayPlanCard() {
  const [steps, setSteps] = useState<TodayStep[] | null>(null);
  useEffect(() => { api.getTodayPlan().then(r => setSteps(r.items)).catch(() => setSteps([])); }, []);

  const toggle = async (s: TodayStep) => {
    const status = s.status === 'completed' ? 'pending' : 'completed';
    setSteps(list => list && list.map(x => x.id === s.id ? { ...x, status } : x));
    try { await api.updateMilestoneStatus(s.id, status); }
    catch { setSteps(list => list && list.map(x => x.id === s.id ? { ...x, status: s.status } : x)); }
  };

  if (!steps || steps.length === 0) return null;
  const minutes = steps.filter(s => s.status !== 'completed').reduce((t, s) => t + (s.est_minutes ?? 0), 0);
  const stale = steps.find(s => s.stale_reason);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm" aria-labelledby="today-plan">
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 id="today-plan" className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <ListChecks className="h-5 w-5 text-indigo-600" /> Today's study plan
        </h2>
        <Link to="/roadmap" className="flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-700">
          Full plan <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {minutes > 0 && <p className="px-6 text-xs text-slate-500">About {Math.round(minutes / 15) * 15} minutes left today.</p>}
      {stale && (
        <p className="mx-6 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {stale.course_code}: {stale.stale_reason}. <Link to={`/roadmap?course=${stale.course_id}`} className="font-semibold underline">Update the plan</Link>
        </p>
      )}
      <ul className="mt-2 divide-y divide-slate-100">
        {steps.slice(0, 6).map(s => {
          const n = daysUntil(s.due_date);
          const examIn = s.exam_date ? daysUntil(s.exam_date) : null;
          return (
            <li key={s.id} className="flex items-start gap-3 px-6 py-2.5">
              <button onClick={() => toggle(s)} className="mt-0.5 shrink-0 rounded-full p-0.5 hover:bg-slate-100"
                aria-label={`${s.title}: ${s.status === 'completed' ? 'done, mark not done' : 'mark done'}`}>
                {s.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-400" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${s.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{s.title}</p>
                <p className="text-xs text-slate-500">
                  {s.course_code}
                  {s.est_minutes ? ` · ${s.est_minutes} min` : ''}
                  {n < 0 ? <span className="font-semibold text-red-700"> · overdue</span> : n === 1 ? ' · tomorrow' : ''}
                  {examIn !== null && examIn >= 0 && examIn <= 14 ? ` · exam in ${examIn} ${examIn === 1 ? 'day' : 'days'}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
