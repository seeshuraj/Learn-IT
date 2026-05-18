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
  const done    = current > step;
  const active  = current === step;
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
function Step1(
  { courses, onCreate }: {
    courses: Course[];
    onCreate: (exam: Exam) => void;
  }
) {
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
      // Fetch full exam object
      const exam: Exam = await api.getUnitExam(res.id);
      onCreate(exam);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Course <span className="text-red-500">*</span></label>
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
        <label className="block text-sm font-medium text-slate-700 mb-1">Exam Title <span className="text-red-500">*</span></label>
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
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Performance Band Thresholds (%)</p>
        <div 