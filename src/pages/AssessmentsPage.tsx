/**
 * AssessmentsPage — professors create assessments (unit test / CIA, model,
 * end-semester, quiz, lab), enter marks in a grid or import a sheet, and
 * publish results to students. Results stay a draft until published.
 *
 * Route: /assessments (instructor; admins reach the same API)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ClipboardList, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type Assessment, type AssessmentType } from '../services/api';
import { AssessmentForm } from '../components/assessments/AssessmentForm';
import { MarksGrid } from '../components/assessments/MarksGrid';
import { AnalyticsView, PaperUpload } from '../components/assessments/AssessmentAnalytics';
import { StatusPill, TYPE_LABELS, TYPE_ORDER, fmtDate, fmtNum, isSplit } from '../components/assessments/shared';

interface Props { user: any }
interface Course { id: number; name: string; code?: string | null }

export default function AssessmentsPage(_props: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [exams, setExams] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [courseFilter, setCourseFilter] = useState<number | ''>('');
  const [typeFilter, setTypeFilter] = useState<AssessmentType | ''>('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get('assessment'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });

  const load = useCallback(() => {
    setErr('');
    return Promise.all([api.getInstructorCourses(), api.listUnitExams()])
      .then(([c, e]) => { setCourses(Array.isArray(c) ? c : []); setExams(e); })
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keep the open assessment in the URL so refresh and back work.
  const open = (id: number | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('assessment', String(id)); else url.searchParams.delete('assessment');
    window.history.pushState(null, '', url);
  };
  useEffect(() => {
    const onPop = () => {
      const id = Number(new URLSearchParams(window.location.search).get('assessment'));
      setOpenId(Number.isInteger(id) && id > 0 ? id : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const shown = useMemo(() => exams.filter(e =>
    (courseFilter === '' || e.course_id === courseFilter) && (typeFilter === '' || e.assessment_type === typeFilter)
  ), [exams, courseFilter, typeFilter]);

  const current = openId ? exams.find(e => e.id === openId) : undefined;
  const replace = (a: Assessment) =>
    setExams(prev => prev.some(e => e.id === a.id)
      ? prev.map(e => e.id === a.id ? { ...e, ...a } : e)
      : [{ ...a, result_count: 0, absent_count: 0 }, ...prev]);

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-500"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading…</div>
  );

  if (err) return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        <button onClick={() => { setLoading(true); void load(); }} className="ml-auto font-semibold underline">Try again</button>
      </div>
    </div>
  );

  if (openId && current) {
    return (
      <AssessmentDetail
        exam={current} courses={courses}
        onBack={() => { open(null); void load(); }}
        onChange={replace}
        onDeleted={() => { setExams(prev => prev.filter(e => e.id !== current.id)); open(null); }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ClipboardList className="h-6 w-6 text-teal-600" /> Assessments
          </h1>
          <p className="mt-1 text-sm text-slate-600">Unit tests, model exams and end-semester results for your courses.</p>
        </div>
        <button onClick={() => setCreating(true)} disabled={courses.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> New assessment
        </button>
      </div>

      {courses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
          You aren't assigned to any course yet. Your college admin assigns courses under Course Management.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <select value={courseFilter} onChange={e => setCourseFilter(Number(e.target.value) || '')} aria-label="Course"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">All courses</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code}: ${c.name}` : c.name}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as AssessmentType | '')} aria-label="Type"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">All types</option>
              {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <p className="text-sm text-slate-600">
                {exams.length === 0 ? 'No assessments yet. Create one to start entering marks.' : 'No assessments match these filters.'}
              </p>
              {exams.length === 0 && (
                <button onClick={() => setCreating(true)} className="mt-4 text-sm font-semibold text-teal-700 underline underline-offset-2">
                  New assessment
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {shown.map(e => (
                <li key={e.id}>
                  <button onClick={() => open(e.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{e.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {e.course_code ?? e.course_name} · {TYPE_LABELS[e.assessment_type] ?? e.assessment_type} · {fmtDate(e.exam_date)} · out of {fmtNum(e.max_marks)}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-slate-600">
                      {e.result_count ?? 0}/{e.enrolled_count ?? '—'} entered
                    </span>
                    <StatusPill published={!!e.published_at} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {creating && (
        <AssessmentForm
          courses={courses}
          defaultCourseId={courseFilter === '' ? undefined : courseFilter}
          onClose={() => setCreating(false)}
          onSaved={a => { replace(a); setCreating(false); open(a.id); }}
        />
      )}
    </div>
  );
}

type Tab = 'marks' | 'analysis' | 'paper';

function AssessmentDetail({ exam, courses, onBack, onChange, onDeleted }: {
  exam: Assessment;
  courses: Course[];
  onBack: () => void;
  onChange: (a: Assessment) => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<Tab>('marks');
  const [editing, setEditing] = useState(false);
  const [entered, setEntered] = useState(exam.result_count ?? 0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState<'publish' | 'delete' | null>(null);
  const [gridKey, setGridKey] = useState(0);
  const published = !!exam.published_at;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setActionError('');
    try { await fn(); } catch (e: any) { setActionError(e.message); } finally { setBusy(false); setConfirm(null); }
  };

  const publish = () => run(async () => onChange(await api.publishUnitExam(exam.id)));
  const unpublish = () => run(async () => onChange(await api.unpublishUnitExam(exam.id)));
  const remove = () => run(async () => { await api.deleteUnitExam(exam.id); onDeleted(); });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> All assessments
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{exam.title}</h1>
            <StatusPill published={published} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {exam.course_code ? `${exam.course_code}: ${exam.course_name}` : exam.course_name} · {TYPE_LABELS[exam.assessment_type]} · {fmtDate(exam.exam_date)}
          </p>
          <p className="text-sm text-slate-600">
            Out of {fmtNum(exam.max_marks)}
            {isSplit(exam) && ` (internal ${fmtNum(exam.internal_max)} + external ${fmtNum(exam.external_max)})`}
            {exam.counted_out_of != null && ` · counts as ${fmtNum(exam.counted_out_of)}`}
            {exam.question_pattern && ` · question-wise (${exam.question_pattern.parts.map(p => p.key).join(', ')})`}
            {exam.credits != null && ` · ${fmtNum(exam.credits)} credits`}
            {exam.semester != null && ` · semester ${exam.semester}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
            <Pencil className="h-4 w-4" /> Edit
          </button>
          {!published && (
            <button onClick={() => setConfirm('delete')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-red-700 hover:border-red-200">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          {published ? (
            <button onClick={unpublish} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              Unpublish
            </button>
          ) : (
            <button onClick={() => setConfirm('publish')} disabled={busy || entered === 0}
              title={entered === 0 ? 'Enter marks first' : undefined}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
              Publish results
            </button>
          )}
        </div>
      </div>

      {actionError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

      {confirm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="alertdialog" aria-labelledby="confirm-text">
          <p id="confirm-text">
            {confirm === 'publish'
              ? `Publish results for ${entered} student${entered === 1 ? '' : 's'}? They'll see their marks and get a notification. You can unpublish later.`
              : `Delete “${exam.title}” and the ${entered} mark${entered === 1 ? '' : 's'} entered? This can't be undone.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={confirm === 'publish' ? publish : remove} disabled={busy}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60 ${confirm === 'publish' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirm === 'publish' ? 'Publish' : 'Delete'}
            </button>
            <button onClick={() => setConfirm(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium">Cancel</button>
          </div>
        </div>
      )}

      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {([['marks', 'Marks'], ['analysis', 'Class analysis'], ['paper', 'Question paper']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? 'border-teal-600 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {/* Kept mounted so unsaved edits survive switching tabs. */}
        <div hidden={tab !== 'marks'}><MarksGrid key={gridKey} exam={exam} onCountsChange={setEntered} /></div>
        {tab === 'analysis' && <AnalyticsView exam={exam} />}
        {tab === 'paper' && <PaperUpload exam={exam} onUploaded={status => onChange({ ...exam, paper_storage_path: 'uploaded', analysis_status: status })} />}
      </div>

      {editing && (
        <AssessmentForm
          courses={courses}
          existing={{ ...exam, result_count: entered }}
          onClose={() => setEditing(false)}
          onSaved={a => { onChange(a); setEditing(false); setGridKey(k => k + 1); }}
        />
      )}
    </div>
  );
}
