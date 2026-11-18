import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { api, type CourseNotice } from '../../services/api';
import { dueLabel } from '../../server/lib/courseNotices';
import { KINDS, todayIst } from './NoticeBoard';

/** Dashboard card: course notices for today and the next two days. Hidden when there are none. */
export function UpcomingNoticesCard() {
  const [notices, setNotices] = useState<CourseNotice[] | null>(null);
  useEffect(() => { api.getUpcomingNotices().then(setNotices).catch(() => setNotices([])); }, []);
  if (!notices || notices.length === 0) return null;
  const today = todayIst();
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm" aria-labelledby="coming-up">
      <h2 id="coming-up" className="flex items-center gap-2 px-6 pb-2 pt-5 text-lg font-bold text-slate-900">
        <Megaphone className="h-5 w-5 text-indigo-600" /> Coming up in your courses
      </h2>
      <ul className="divide-y divide-slate-100">
        {notices.slice(0, 6).map(n => {
          const k = KINDS.find(x => x.kind === n.kind) ?? KINDS[0];
          const when = dueLabel(n.due_date, today);
          return (
            <li key={n.id}>
              <Link to={`/courses/${n.course_id}`} className="flex items-start gap-3 px-6 py-3 hover:bg-slate-50">
                <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${k.tone}`}>
                  <k.icon className="h-3.5 w-3.5" /> {k.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{n.title}</span>
                  <span className="block text-xs text-slate-500">
                    {when ? <b className="font-semibold text-slate-700">{when[0].toUpperCase() + when.slice(1)}</b> : null}
                    {n.course_code ? ` · ${n.course_code}` : ''}{n.course_name ? ` ${n.course_name}` : ''}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
