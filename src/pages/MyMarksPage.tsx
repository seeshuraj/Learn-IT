/**
 * MyMarksPage — a student's published results: university grades with SGPA
 * and CGPA, and every unit test / model / lab mark grouped by course.
 * Only published assessments come back from the API.
 *
 * Route: /marks (student)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, GraduationCap, Loader2 } from 'lucide-react';
import { api, type StudentMarks, type StudentResult } from '../services/api';
import { TYPE_LABELS, fmtDate, fmtNum } from '../components/assessments/shared';

interface Props { user: { id: number } }

const BAND_TEXT: Record<string, string> = {
  strong: 'text-emerald-700',
  moderate: 'text-amber-700',
  weak: 'text-red-700',
};

const FAIL_GRADES = new Set(['RA', 'AB', 'W', 'U']);

function scoreText(r: StudentResult) {
  if (r.is_absent) return 'Absent';
  return `${fmtNum(r.marks_obtained)}/${fmtNum(r.max_marks)}`;
}

export default function MyMarksPage({ user }: Props) {
  const [data, setData] = useState<StudentMarks | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    api.getStudentExamInsights(user.id)
      .then(setData)
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const semesters = useMemo(() => {
    if (!data) return [];
    const endSem = data.results.filter(r => r.assessment_type === 'end_semester');
    const bySem = new Map<string, StudentResult[]>();
    for (const r of endSem) {
      const k = r.semester != null ? String(r.semester) : '';
      bySem.set(k, [...(bySem.get(k) ?? []), r]);
    }
    return [...bySem.entries()]
      .sort((a, b) => (Number(b[0]) || 0) - (Number(a[0]) || 0))
      .map(([sem, rows]) => ({
        semester: sem ? Number(sem) : null,
        rows: rows.sort((a, b) => (a.course_code ?? a.course_name).localeCompare(b.course_code ?? b.course_name)),
        gpa: data.gpa.semesters.find(s => String(s.semester) === sem) ?? null,
      }));
  }, [data]);

  const courses = useMemo(() => {
    if (!data) return [];
    const internal = data.results.filter(r => r.assessment_type !== 'end_semester');
    const byCourse = new Map<number, StudentResult[]>();
    for (const r of internal) byCourse.set(r.course_id, [...(byCourse.get(r.course_id) ?? []), r]);
    return [...byCourse.values()].sort((a, b) =>
      (a[0].course_code ?? a[0].course_name).localeCompare(b[0].course_code ?? b[0].course_name));
  }, [data]);

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-500"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading your marks…</div>
  );

  if (err) return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        <button onClick={load} className="ml-auto font-semibold underline">Try again</button>
      </div>
    </div>
  );

  const empty = !data || data.results.length === 0;
  const latestSgpa = data?.gpa.semesters.filter(s => s.sgpa !== null).slice(-1)[0];

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <GraduationCap className="h-6 w-6 text-teal-600" /> My marks
        </h1>
        <p className="mt-1 text-sm text-slate-600">Results your professors have published.</p>
      </div>

      {empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
          No results published yet. You'll get a notification when a professor publishes marks.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data!.gpa.cgpa !== null && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="text-sm text-slate-600">CGPA</dt>
                <dd className="text-3xl font-bold tabular-nums text-slate-900">{data!.gpa.cgpa.toFixed(2)}</dd>
              </div>
            )}
            {latestSgpa && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="text-sm text-slate-600">SGPA, semester {latestSgpa.semester}</dt>
                <dd className="text-3xl font-bold tabular-nums text-slate-900">{latestSgpa.sgpa!.toFixed(2)}</dd>
              </div>
            )}
            {data!.overall_avg !== null && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="text-sm text-slate-600">Average across assessments</dt>
                <dd className="text-3xl font-bold tabular-nums text-slate-900">{data!.overall_avg}%</dd>
              </div>
            )}
          </dl>

          {semesters.length > 0 && (
            <section aria-labelledby="grades-heading" className="space-y-4">
              <h2 id="grades-heading" className="text-lg font-bold text-slate-900">University grades</h2>
              {semesters.map(s => (
                <div key={s.semester ?? 'none'} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <h3 className="font-semibold text-slate-900">{s.semester ? `Semester ${s.semester}` : 'Semester not set'}</h3>
                    {s.gpa?.sgpa != null && (
                      <p className="text-sm text-slate-600">SGPA <b className="tabular-nums text-slate-900">{s.gpa.sgpa.toFixed(2)}</b></p>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                        <tr>
                          <th scope="col" className="px-4 py-2">Course</th>
                          <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Internal</th>
                          <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">External</th>
                          <th scope="col" className="px-3 py-2 text-right">Total</th>
                          <th scope="col" className="px-3 py-2 text-right">Credits</th>
                          <th scope="col" className="px-4 py-2 text-center">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.rows.map(r => (
                          <tr key={r.exam_id} className="border-t border-slate-100">
                            <th scope="row" className="px-4 py-2.5 text-left font-normal">
                              <span className="block font-medium text-slate-900">{r.course_code ?? r.course_name}</span>
                              {r.course_code && <span className="block text-xs text-slate-500">{r.course_name}</span>}
                            </th>
                            <td className="hidden px-3 py-2.5 text-right tabular-nums text-slate-700 sm:table-cell">{r.is_absent ? '' : fmtNum(r.internal_marks)}</td>
                            <td className="hidden px-3 py-2.5 text-right tabular-nums text-slate-700 sm:table-cell">{r.is_absent ? '' : fmtNum(r.external_marks)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{scoreText(r)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtNum(r.credits) || '—'}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`font-bold ${r.grade && FAIL_GRADES.has(r.grade) ? 'text-red-700' : 'text-slate-900'}`}>{r.grade ?? '—'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                SGPA and CGPA count courses with credits and a passing grade; RA and AB are left out until cleared.
              </p>
            </section>
          )}

          {courses.length > 0 && (
            <section aria-labelledby="internal-heading" className="space-y-4">
              <h2 id="internal-heading" className="text-lg font-bold text-slate-900">Tests and internal assessments</h2>
              {courses.map(rows => (
                <div key={rows[0].course_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <h3 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">
                    {rows[0].course_code ? `${rows[0].course_code}: ${rows[0].course_name}` : rows[0].course_name}
                  </h3>
                  <ul className="divide-y divide-slate-100">
                    {rows.map(r => (
                      <li key={r.exam_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900">{r.exam_title}</p>
                          <p className="text-xs text-slate-500">{TYPE_LABELS[r.assessment_type] ?? r.assessment_type} · {fmtDate(r.exam_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold tabular-nums ${r.is_absent ? 'text-slate-500' : BAND_TEXT[r.performance_band ?? ''] ?? 'text-slate-900'}`}>
                            {scoreText(r)}
                            {!r.is_absent && r.percentage !== null && <span className="ml-2 text-sm font-normal text-slate-600">{Number(r.percentage).toFixed(0)}%</span>}
                          </p>
                          {r.class_avg_pct !== null && (
                            <p className="text-xs text-slate-500">Class average {Number(r.class_avg_pct).toFixed(0)}%</p>
                          )}
                        </div>
                        {r.remarks && <p className="w-full text-sm text-slate-600">{r.remarks}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {data!.weak_topics.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Topics to work on</h2>
              <p className="mt-1 text-sm text-slate-600">From tests where you scored in the weak band.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data!.weak_topics.map(t => (
                  <span key={t} className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-800">{t}</span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
