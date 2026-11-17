import React from 'react';
import type { QuestionMark, QuestionPattern } from '../../services/api';
import { scoreQuestions } from '../../server/lib/questionPattern';
import { fmtNum } from './shared';

/**
 * A student's marks per part and per question, and per unit where the
 * professor tagged questions. Collapsed by default under the result.
 */
export function QuestionBreakdown({ pattern, marks, topics }: {
  pattern: QuestionPattern;
  marks: Record<string, QuestionMark> | null | undefined;
  topics?: Record<string, number> | null;
}) {
  const m = marks ?? {};
  const scored = scoreQuestions(pattern, m);
  const partScore = new Map('error' in scored ? [] : scored.parts.map(p => [p.key, p]));
  const value = (no: string) => {
    const x = m[no];
    return x === undefined ? null : typeof x === 'number' ? { v: x, o: null } : { v: x.m, o: x.o };
  };

  return (
    <details className="group w-full">
      <summary className="cursor-pointer list-none text-sm font-medium text-teal-700 hover:underline">
        <span className="group-open:hidden">Show question-wise marks</span>
        <span className="hidden group-open:inline">Hide question-wise marks</span>
      </summary>
      <div className="mt-3 space-y-3">
        {pattern.parts.map(part => {
          const ps = partScore.get(part.key);
          return (
            <div key={part.key}>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">
                {part.label}{ps ? ` · ${fmtNum(ps.score)}/${fmtNum(ps.max)}` : ''}
                {part.answer_count ? <span className="font-normal text-slate-500"> · best {part.answer_count} of {part.questions.length} counted</span> : null}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {part.questions.map(q => {
                  const got = value(q.no);
                  const pct = got ? got.v / q.marks : 0;
                  const tone = !got ? 'border-slate-200 bg-white text-slate-400'
                    : pct >= 0.75 ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : pct >= 0.5 ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-red-200 bg-red-50 text-red-900';
                  return (
                    <li key={q.no} className={`min-w-[3.25rem] rounded-lg border px-2 py-1 text-center text-xs ${tone}`}>
                      <span className="block font-medium">Q{q.no}{got?.o ? ` (${got.o})` : ''}</span>
                      <span className="block tabular-nums">{got ? fmtNum(got.v) : '—'}/{fmtNum(q.marks)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {topics && Object.keys(topics).length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">By unit</p>
            <ul className="space-y-1.5">
              {Object.entries(topics).sort((a, b) => a[1] - b[1]).map(([t, pct]) => (
                <li key={t} className="text-xs">
                  <div className="flex justify-between gap-3 text-slate-700"><span className="truncate">{t}</span><span className="tabular-nums">{Math.round(pct)}%</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
