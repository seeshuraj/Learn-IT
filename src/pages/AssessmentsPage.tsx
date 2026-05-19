/**
 * AssessmentsPage.tsx
 * Instructor-only page for managing unit exams:
 *   Step 1 — Create exam (course, title, date, max marks, grading bands)
 *   Step 2 — Upload marks CSV / XLSX with drag-drop + preview
 *   Step 3 — Upload exam paper PDF
 *   Step 4 — Review analytics (band distribution, weakest topics, student table)
 *
 * Route: /assessments  (instructor role only)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronRight, ClipboardList,
  FileSpreadsheet, FileText, Loader2, TrendingDown, TrendingUp,
  Upload, Users, X, BookOpen, BarChart3, ArrowLeft,
} from 'lucide-react';
import { api } from '../services/api';

interface Props { user: any; }

type Step = 1 | 2 | 3 | 4;

interface Course { id: number; name: string; code: string; }
interface Exam {
  id: number; course_id: number; title: string; exam_date: string | null;
  max_marks: number; grading_schema: { strong: number; moderate: number };
  analysis_status: string; paper_storage_path: string | null;
}
interface ImportResult {
  import_id: number; rows_total: number; rows_matched: number;
  rows_failed: number; errors: any[]; preview: any[];
}
interface Analytics {
  exam: Exam;
  stats: {
    total: number; avg: number; avg_pct: number; max_marks: number;
    min_marks: number; median_pct: number; pass_rate: number;
    bands: { strong: number; moderate: number; weak: number };
    weakest_topics: string[]; strongest_topics: string[];
  } | null;
  results: any[];
  topics: any[];
}

const BAND_COLORS: Record<string, string> = {
  strong:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  moderate: 'bg-amber-100   text-amber-700   border-amber-200',
  weak:     'bg-red-100     text-red-700     border-red-200',
};

const BAND_ICONS: Record<string, React.ReactNode> = {
  strong:   <TrendingUp  className="w-3 h-3" />,
  moderate: <BarChart3   className="w-3 h-3" />,
  weak:     <TrendingDown className="w-3 h-3" />,
};

function BandBadge({ band }: { band: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${BAND_COLORS[band] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {BAND_ICONS[band]}
      {band.charAt(0).toUpperCase() + band.slice(1)}
    </span>
  );
}

function StepDot({ step, current }: { step: number; current: number }) {
  const done   = current > step;
  const active = current === step;
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
      done   ? 'bg-teal-600 border-teal-600 text-white' :
      active ? 'bg-white border-teal-600 text-teal-700' :
               'bg-white border-slate-300 text-slate-400'
    }`}>
      {done ? <CheckCircle2 className="w-4 h-4" /> : step}
    </div>
  );
}

const STEP_LABELS = ['Create Exam', 'Upload Marks', 'Upload Paper', 'Review'];

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1">
            <StepDot step={i + 1} current={current} />
            <span className={`text-xs font-medium whitespace-nowrap ${
              current === i + 1 ? 'text-teal-700' : current > i + 1 ? 'text-teal-500' : 'text-slate-400'
            }`}>{label}</span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 mx-1 ${
              current > i + 1 ? 'bg-teal-500' : 'bg-slate-200'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Drop zone ──────────────────────────────────────────────────────────────────
function DropZone({
  accept, label, hint, onFile, loading,
}: { accept: string; label: string; hint: string; onFile: (f: File) => void; loading: boolean; }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handle = (f: File | null) => { if (f) onFile(f); };

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 hover:border-teal-400 bg-slate-50 hover:bg-teal-50'
      }`}
      onClick={() => !loading && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0] ?? null); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => handle(e.target.files?.[0] ?? null)}
      />
      {loading
        ? <Loader2 className="w-8 h-8 text-teal-500 animate-spin mx-auto mb-2" />
        : <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />}
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-400 mt-1">{hint}</p>
    </div>
  );
}

// ── Step 1 — Create Exam ───────────────────────────────────────────────────────
function Step1({
  courses, onCreate,
}: {
  courses: Course[];
  onCreate: (exam: Exam) => void;
}) {
  const [courseId,  setCourseId]  = useState<number | ''>('');
  const [title,     setTitle]     = useState('');
  const [date,      setDate]      = useState('');
  const [maxMarks,  setMaxMarks]  = useState('100');
  const [strong,    setStrong]    = useState('75');
  const [moderate,  setModerate]  = useState('50');
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  const submit = async () => {
    if (!courseId || !title.trim()) { setErr('Course and title are required.'); return; }
    setSaving(true); setErr('');
    try {
      const res: any = await api.createUnitExam({
        course_id:      Number(courseId),
        title:          title.trim(),
        exam_date:      date || undefined,
        max_marks:      parseFloat(maxMarks) || 100,
        grading_schema: { strong: parseFloat(strong) || 75, moderate: parseFloat(moderate) || 50 },
      });
      const exam: Exam = await api.getUnitExam(res.id);
      onCreate(exam);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Course <span className="text-red-500">*</span>
        </label>
        <select
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          value={courseId}
          onChange={e => setCourseId(Number(e.target.value) || '')}
        >
          <option value="">Select a course…</option>
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Exam Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text" placeholder="e.g. Unit Test 1 — Data Structures"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          value={title} onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Exam Date</label>
          <input
            type="date"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={date} onChange={e => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Max Marks</label>
          <input
            type="number" min="1" placeholder="100"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={maxMarks} onChange={e => setMaxMarks(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Performance Band Thresholds (%)
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Strong ≥</label>
            <input
              type="number" min="1" max="100"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={strong} onChange={e => setStrong(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Moderate ≥</label>
            <input
              type="number" min="1" max="100"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={moderate} onChange={e => setModerate(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Below <strong>{moderate}%</strong> = Weak &nbsp;·&nbsp;
          {moderate}–{strong}% = Moderate &nbsp;·&nbsp;
          ≥{strong}% = Strong
        </p>
      </div>

      {err && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={saving || !courseId || !title.trim()}
        className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
        {saving ? 'Creating…' : 'Next: Upload Marks'}
      </button>
    </div>
  );
}

// ── Step 2 — Upload Marks ──────────────────────────────────────────────────────
function Step2({
  exam, onDone,
}: { exam: Exam; onDone: (r: ImportResult) => void; }) {
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');
  const [committed, setCommitted] = useState(false);

  const handleFile = async (file: File) => {
    setLoading(true); setErr(''); setResult(null);
    try {
      const data: ImportResult = await api.previewExamMarks(exam.id, file);
      setResult(data);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const commit = async () => {
    if (!result) return;
    setLoading(true); setErr('');
    try {
      await api.commitExamMarks(exam.id, result.import_id);
      setCommitted(true);
      onDone(result);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600">
        <span className="font-semibold text-slate-800">{exam.title}</span>
        &nbsp;·&nbsp; Max marks: {exam.max_marks}
        &nbsp;·&nbsp; Required columns:&nbsp;
        <code className="bg-slate-200 px-1 rounded">student_email</code>,&nbsp;
        <code className="bg-slate-200 px-1 rounded">marks_obtained</code>
      </div>

      {!committed && (
        <DropZone
          accept=".csv,.xlsx"
          label="Drop CSV or XLSX here, or click to browse"
          hint="Required: student_email, marks_obtained  ·  Optional: topic columns"
          onFile={handleFile}
          loading={loading}
        />
      )}

      {err && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {result && !committed && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Rows',   value: result.rows_total,   color: 'text-slate-700' },
              { label: 'Matched',      value: result.rows_matched,  color: 'text-emerald-600' },
              { label: 'Errors',       value: result.rows_failed,   color: result.rows_failed ? 'text-red-600' : 'text-slate-400' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Error list */}
          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1 max-h-40 overflow-y-auto">
              <p className="text-xs font-semibold text-red-700 mb-2">Parse errors (these rows will be skipped)</p>
              {result.errors.map((e: any, i: number) => (
                <p key={i} className="text-xs text-red-600">Row {e.row}: {e.field} — {e.reason}</p>
              ))}
            </div>
          )}

          {/* Preview table */}
          {result.preview.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-right">Marks</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-center">Band</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((row: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">{row.student_email ?? row.student_id}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.marks_obtained}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(row.percentage).toFixed(1)}</td>
                      <td className="px-3 py-2 text-center"><BandBadge band={row.band} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={commit}
              disabled={loading || result.rows_matched === 0}
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm &amp; Save {result.rows_matched} rows
            </button>
            <button
              onClick={() => { setResult(null); setErr(''); }}
              className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
            >
              Re-upload
            </button>
          </div>
        </div>
      )}

      {committed && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          {result?.rows_matched} student marks saved successfully.
        </div>
      )}
    </div>
  );
}

// ── Step 3 — Upload Paper PDF ──────────────────────────────────────────────────
function Step3({
  exam, onDone,
}: { exam: Exam; onDone: () => void; }) {
  const [loading,   setLoading]   = useState(false);
  const [uploaded,  setUploaded]  = useState(false);
  const [err,       setErr]       = useState('');

  const handleFile = async (file: File) => {
    setLoading(true); setErr('');
    try {
      await api.uploadExamPaper(exam.id, file);
      setUploaded(true);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <p className="text-sm text-slate-600">
        Upload the exam paper PDF so the system can extract topics and map question weights
        to student performance. This step is optional — you can skip and view results now.
      </p>

      {!uploaded && (
        <DropZone
          accept=".pdf"
          label="Drop exam paper PDF here, or click to browse"
          hint="AI will extract topics and question weights for deeper analytics"
          onFile={handleFile}
          loading={loading}
        />
      )}

      {err && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {uploaded && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Paper uploaded — topic analysis is running in the background.
        </div>
      )}

      <div className="flex gap-3">
        {uploaded && (
          <button
            onClick={onDone}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <ChevronRight className="w-4 h-4" /> View Analytics
          </button>
        )}
        <button
          onClick={onDone}
          className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
        >
          Skip — go to review
        </button>
      </div>
    </div>
  );
}

// ── Step 4 — Analytics Review ──────────────────────────────────────────────────
function Step4({ exam }: { exam: Exam }) {
  const [data,    setData]    = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    api.getExamAnalytics(exam.id)
      .then((d: Analytics) => setData(d))
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [exam.id]);

  if (loading) return (
    <div className="flex items-center gap-3 text-slate-500 py-12 justify-center">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading analytics…
    </div>
  );

  if (err) return (
    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
      <AlertCircle className="w-4 h-4" /> {err}
    </div>
  );

  if (!data) return null;
  const { stats, results, topics } = data;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* KPI row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Students',   value: stats.total,                      suffix: '' },
            { label: 'Average',    value: stats.avg_pct.toFixed(1),         suffix: '%' },
            { label: 'Pass Rate',  value: stats.pass_rate.toFixed(1),       suffix: '%' },
            { label: 'Median',     value: stats.median_pct.toFixed(1),      suffix: '%' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{k.value}{k.suffix}</p>
              <p className="text-xs text-slate-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Band distribution */}
      {stats && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-slate-700">Performance Band Distribution</p>
          <div className="flex gap-4">
            {(['strong','moderate','weak'] as const).map(band => (
              <div key={band} className="flex-1 text-center">
                <p className={`text-2xl font-bold tabular-nums ${
                  band === 'strong' ? 'text-emerald-600' :
                  band === 'moderate' ? 'text-amber-600' : 'text-red-600'
                }`}>{stats.bands[band]}</p>
                <BandBadge band={band} />
              </div>
            ))}
          </div>
          {/* bar */}
          <div className="h-3 rounded-full overflow-hidden flex gap-0.5 bg-slate-100">
            {(['strong','moderate','weak'] as const).map(band => {
              const pct = stats.total ? (stats.bands[band] / stats.total) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={band}
                  style={{ width: `${pct}%` }}
                  className={`h-full rounded-full ${
                    band === 'strong' ? 'bg-emerald-500' :
                    band === 'moderate' ? 'bg-amber-400' : 'bg-red-400'
                  }`}
                />
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Topic insights */}
      {stats && (stats.weakest_topics.length > 0 || stats.strongest_topics.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.weakest_topics.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Weakest Topics</p>
              <div className="flex flex-wrap gap-2">
                {stats.weakest_topics.map(t => (
                  <span key={t} className="text-xs bg-white border border-red-200 text-red-700 px-2.5 py-1 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
          {stats.strongest_topics.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Strongest Topics</p>
              <div className="flex flex-wrap gap-2">
                {stats.strongest_topics.map(t => (
                  <span key={t} className="text-xs bg-white border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Student results table */}
      {results.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Student Results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left">Student</th>
                  <th className="px-4 py-2.5 text-right">Marks</th>
                  <th className="px-4 py-2.5 text-right">%</th>
                  <th className="px-4 py-2.5 text-center">Band</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{r.student_name ?? r.student_email ?? r.student_id}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.marks_obtained}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{Number(r.percentage).toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-center"><BandBadge band={r.performance_band} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analysis status notice */}
      {exam.analysis_status !== 'done' && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-700 text-sm">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          PDF topic analysis is still running — topic insights will appear automatically when complete.
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AssessmentsPage({ user }: Props) {
  const [courses,  setCourses]  = useState<Course[]>([]);
  const [step,     setStep]     = useState<Step>(1);
  const [exam,     setExam]     = useState<Exam | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');

  // Past exams list
  const [exams,       setExams]       = useState<Exam[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getInstructorCourses(),
      api.listUnitExams(),
    ])
      .then(([c, e]) => { setCourses(c); setExams(e); })
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reset = () => { setStep(1); setExam(null); };

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
    </div>
  );

  if (err) return (
    <div className="p-6">
      <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
        <AlertCircle className="w-4 h-4" /> {err}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {step > 1 && exam && (
            <button onClick={reset} className="text-slate-400 hover:text-slate-600 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-teal-600" /> Assessments
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {step === 1 ? 'Create a new unit exam' :
               step === 2 ? `Upload marks — ${exam?.title}` :
               step === 3 ? `Upload exam paper — ${exam?.title}` :
               `Analytics — ${exam?.title}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowHistory(h => !h)}
          className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
        >
          <BookOpen className="w-4 h-4" />
          {showHistory ? 'Hide' : 'Past exams'}
        </button>
      </div>

      {/* Past exams panel */}
      {showHistory && exams.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">Past Exams</div>
          <div className="divide-y divide-slate-50">
            {exams.map(e => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.title}</p>
                  <p className="text-xs text-slate-400">{e.exam_date ?? 'No date'} · Max {e.max_marks}</p>
                </div>
                <button
                  onClick={() => { setExam(e); setStep(4); setShowHistory(false); }}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
                >
                  View <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wizard */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <StepBar current={step} />

        {step === 1 && (
          <Step1
            courses={courses}
            onCreate={e => { setExam(e); setStep(2); }}
          />
        )}
        {step === 2 && exam && (
          <Step2
            exam={exam}
            onDone={_ => setStep(3)}
          />
        )}
        {step === 3 && exam && (
          <Step3
            exam={exam}
            onDone={() => setStep(4)}
          />
        )}
        {step === 4 && exam && (
          <Step4 exam={exam} />
        )}
      </div>

      {/* Start fresh button when in review */}
      {step === 4 && (
        <div className="text-center">
          <button
            onClick={reset}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium underline underline-offset-2"
          >
            + Create another exam
          </button>
        </div>
      )}
    </div>
  );
}
