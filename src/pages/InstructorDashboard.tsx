import React, { useEffect, useState, useRef } from "react";
import { User, Submission, Course } from "../types";
import { BookOpen, Clock, CheckCircle2, AlertCircle, Brain, Search, BarChart3, Star, Loader2, Sparkles, ThumbsUp, RefreshCw, Plus, X, Upload, Trash2, Map, FileText, ChevronDown, ChevronUp, Zap, Target } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getClassOverviewSummary, ClassOverviewData } from "../services/aiService";
import { toast, Toaster } from "sonner";
import { api, asPage } from "../services/api";
import InstructorRoadmapView from "./InstructorRoadmapView";
import { StudentTopicsPanel } from "../components/StudentTopicsPanel";
import { UpcomingNoticesCard } from "../components/course/UpcomingNotices";
import { UpcomingExamsCard } from "../components/exams/UpcomingExams";

interface InstructorDashboardProps {
  user: User;
}

interface Module {
  id: number;
  name: string;
  course_id: number;
}

interface StudentStat {
  student_id?: number;
  name: string;
  /** Assignment average in percent; null until something is graded. */
  average: number | null;
  missed: number;
  late: number;
  status: string;
  course_id?: number;
  course_name?: string;
}

const STATUS_TONE: Record<string, { pill: string; bar: string }> = {
  'On Track':     { pill: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500' },
  'Needs Review': { pill: 'bg-amber-100 text-amber-800',     bar: 'bg-amber-500' },
  'At Risk':      { pill: 'bg-red-100 text-red-800',         bar: 'bg-red-500' },
  'No grades yet':{ pill: 'bg-slate-100 text-slate-600',     bar: 'bg-slate-300' },
};

interface RubricBreakdown {
  criterion: string;
  score: number;
  max_score: number;
  comment: string;
}

interface AiGradeResult {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  rubric_breakdown?: RubricBreakdown[];
  confidence?: number; // 0-100
  graded_via?: 'pdf' | 'text';
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence == null) return null;
  const level = confidence >= 80 ? 'high' : confidence >= 55 ? 'medium' : 'low';
  const colors: Record<string, string> = {
    high:   'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low:    'bg-red-100 text-red-700 border-red-200',
  };
  const labels: Record<string, string> = { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[level]}`}>
      <Zap className="w-2.5 h-2.5" /> {labels[level]} ({confidence}%)
    </span>
  );
}

// ─── Create Assignment Modal ─────────────────────────────────────────────────────
function CreateAssignmentModal({
  courses,
  onClose,
  onCreated,
}: {
  courses: Course[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [courseId, setCourseId] = useState<number | ''>('');
  const [moduleId, setModuleId] = useState<number | ''>('');
  const [modules, setModules] = useState<Module[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxPoints, setMaxPoints] = useState(100);
  const [briefFile, setBriefFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!courseId) { setModules([]); setModuleId(''); return; }
    api.getCourseModules(courseId as number)
      .then((data: any) => { setModules(Array.isArray(data) ? data : []); setModuleId(''); })
      .catch(() => setModules([]));
  }, [courseId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!moduleId) return setError('Select a module.');
    if (!title.trim()) return setError('Title is required.');
    if (!dueDate) return setError('Due date is required.');
    setSaving(true); setError('');
    try {
      let briefUrl = '';
      if (briefFile) {
        const uploadedNote = await api.uploadNote(moduleId as number, briefFile);
        briefUrl = uploadedNote?.url ?? uploadedNote?.file_url ?? '';
      }
      await api.createAssignment(moduleId as number, {
        title: title.trim(),
        description: description.trim() + (briefUrl ? `\n\n[Assignment Brief PDF](${briefUrl})` : ''),
        due_date: dueDate,
        max_points: maxPoints,
      });
      toast.success('Assignment created!');
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Create Assignment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-7 py-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Course</label>
            <select value={courseId} onChange={e => setCourseId(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" required>
              <option value="">Select a course…</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Module</label>
            <select value={moduleId} onChange={e => setModuleId(Number(e.target.value))}
              disabled={modules.length === 0}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" required>
              <option value="">{modules.length === 0 ? 'Select a course first…' : 'Select a module…'}</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Assignment Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Week 3 — Binary Trees" required />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Description / Instructions</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Describe what students need to do." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Due Date</label>
              <input type="date" value={dueDate} min={minDateStr} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Max Points</label>
              <input type="number" value={maxPoints} min={1} max={1000} onChange={e => setMaxPoints(Number(e.target.value))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Assignment Brief PDF <span className="font-normal text-slate-400">(optional)</span></label>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center hover:border-indigo-300 transition cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              {briefFile ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 truncate">📄 {briefFile.name}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); setBriefFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                    className="text-slate-400 hover:text-red-500 transition shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">Click to upload PDF brief</p>
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => setBriefFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Creating…' : 'Create Assignment'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Upload Notes Modal ─────────────────────────────────────────────────────────
function UploadNotesModal({ courses, onClose, initialCourseId }: { courses: Course[]; onClose: () => void; initialCourseId?: number }) {
  const [courseId, setCourseId] = useState<number | ''>(initialCourseId ?? '');
  const [moduleId, setModuleId] = useState<number | ''>('');
  const [modules, setModules] = useState<Module[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!courseId) { setModules([]); setModuleId(''); return; }
    api.getCourseModules(courseId as number)
      .then((data: any) => { setModules(Array.isArray(data) ? data : []); setModuleId(''); })
      .catch(() => setModules([]));
  }, [courseId]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!moduleId) return setError('Select a module.');
    if (!file) return setError('Select a file to upload.');
    setUploading(true); setError(''); setProgress('Uploading & embedding…');
    try {
      const data = await api.uploadNote(moduleId as number, file);
      setProgress(`Done — ${data?.chunk_count ?? 0} chunks embedded ✓`);
      toast.success('Notes uploaded and embedded!');
      setTimeout(() => onClose(), 1500);
    } catch (e: any) {
      setError(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Upload Module Notes</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleUpload} className="px-7 py-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Course</label>
            <select value={courseId} onChange={e => setCourseId(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" required>
              <option value="">Select a course…</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Module</label>
            <select value={moduleId} onChange={e => setModuleId(Number(e.target.value))}
              disabled={modules.length === 0}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50" required>
              <option value="">{modules.length === 0 ? 'Select a course first…' : 'Select a module…'}</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">File (PDF, DOCX, TXT)</label>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-teal-300 transition cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              {file ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 truncate">📄 {file.name}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }}
                    className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">Click to browse files</p>
                  <p className="text-xs text-slate-400 mt-0.5">PDF, DOCX, TXT · max 20MB</p>
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          {progress && <p className="text-sm text-teal-700 font-medium">{progress}</p>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Cancel</button>
            <button type="submit" disabled={uploading || !file || !moduleId}
              className="flex-1 px-4 py-2.5 bg-teal-700 text-white rounded-xl text-sm font-bold hover:bg-teal-800 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload Notes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Rubric Breakdown Panel ───────────────────────────────────────────────────
function RubricBreakdownPanel({ breakdown }: { breakdown: RubricBreakdown[] }) {
  const [expanded, setExpanded] = useState(true);
  const totalScore = breakdown.reduce((s, r) => s + r.score, 0);
  const totalMax   = breakdown.reduce((s, r) => s + r.max_score, 0);
  return (
    <div className="bg-white rounded-2xl border border-green-100 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 bg-green-50 hover:bg-green-100 transition"
      >
        <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" /> Rubric Breakdown
          <span className="ml-1 bg-green-200 text-green-800 px-1.5 py-0.5 rounded-full">{totalScore}/{totalMax}</span>
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-green-600" /> : <ChevronDown className="w-4 h-4 text-green-600" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-slate-50">
              {breakdown.map((item, i) => {
                const pct = item.max_score > 0 ? Math.round((item.score / item.max_score) * 100) : 0;
                const barColor = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <div key={i} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-700">{item.criterion}</span>
                      <span className="text-xs font-bold text-slate-500 tabular-nums">{item.score}/{item.max_score}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    {item.comment && (
                      <p className="text-[11px] text-slate-500 leading-snug">{item.comment}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Manage Tab ───────────────────────────────────────────────────────────────
function ManageTab({ courses, user }: { courses: Course[]; user: User }) {
  const [courseId, setCourseId] = useState<number | ''>('');
  const [moduleId, setModuleId] = useState<number | ''>('');
  const [modules, setModules] = useState<Module[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<number | null>(null);

  useEffect(() => {
    if (!courseId) { setModules([]); setModuleId(''); setNotes([]); setAssignments([]); return; }
    api.getCourseModules(courseId as number)
      .then((data: any) => { setModules(Array.isArray(data) ? data : []); setModuleId(''); setNotes([]); setAssignments([]); })
      .catch(() => setModules([]));
  }, [courseId]);

  useEffect(() => {
    if (!moduleId) { setNotes([]); setAssignments([]); return; }
    setLoading(true);
    Promise.all([
      api.getModuleNotes(moduleId as number),
      api.getModuleAssignments(moduleId as number),
    ]).then(([n, a]) => {
      setNotes(Array.isArray(n) ? n : []);
      setAssignments(Array.isArray(a) ? a : []);
    }).catch(() => { setNotes([]); setAssignments([]); }).finally(() => setLoading(false));
  }, [moduleId]);

  async function handleDeleteNote(noteId: number, fileName: string) {
    if (!window.confirm(`Delete note "${fileName}"? This is permanent.`)) return;
    setDeletingNoteId(noteId);
    try { await api.deleteNote(noteId); setNotes(prev => prev.filter(n => n.id !== noteId)); toast.success('Note deleted.'); }
    catch (e: any) { toast.error(e.message ?? 'Failed to delete note.'); }
    finally { setDeletingNoteId(null); }
  }

  async function handleDeleteAssignment(assignmentId: number, title: string) {
    if (!window.confirm(`Delete assignment "${title}"? Students will lose access.`)) return;
    setDeletingAssignmentId(assignmentId);
    try { await api.deleteAssignment(assignmentId); setAssignments(prev => prev.filter(a => a.id !== assignmentId)); toast.success('Assignment deleted.'); }
    catch (e: any) { toast.error(e.message ?? 'Failed to delete assignment.'); }
    finally { setDeletingAssignmentId(null); }
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Course</label>
          <select value={courseId} onChange={e => setCourseId(Number(e.target.value))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Select a course…</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Module</label>
          <select value={moduleId} onChange={e => setModuleId(Number(e.target.value))}
            disabled={modules.length === 0}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
            <option value="">{modules.length === 0 ? 'Select a course first…' : 'Select a module…'}</option>
            {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>
      {loading && <div className="flex items-center gap-3 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading module content…</div>}
      {!loading && moduleId !== '' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2"><BookOpen className="w-4 h-4 text-teal-600" /> Notes</h3>
              <span className="text-xs bg-teal-100 text-teal-700 font-bold px-2 py-0.5 rounded-full">{notes.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {notes.length === 0 ? <div className="px-6 py-8 text-center text-sm text-slate-400">No notes uploaded for this module.</div>
                : notes.map(note => {
                  const displayName = note.original_name ?? note.filename ?? `Note #${note.id}`;
                  const uploadedAt = note.uploaded_at ?? note.created_at;
                  return (
                    <div key={note.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">📄 {displayName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {uploadedAt ? new Date(uploadedAt).toLocaleDateString() : ''}
                          {note.chunk_count ? ` · ${note.chunk_count} chunks` : ''}
                        </p>
                      </div>
                      <button onClick={() => handleDeleteNote(note.id, displayName)} disabled={deletingNoteId === note.id}
                        className="ml-4 shrink-0 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition disabled:opacity-40">
                        {deletingNoteId === note.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-600" /> Assignments</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">{assignments.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {assignments.length === 0 ? <div className="px-6 py-8 text-center text-sm text-slate-400">No assignments for this module.</div>
                : assignments.map(assignment => (
                  <div key={assignment.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{assignment.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Due {assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : 'N/A'}
                        {assignment.max_points ? ` · ${assignment.max_points} pts` : ''}
                      </p>
                    </div>
                    <button onClick={() => handleDeleteAssignment(assignment.id, assignment.title)} disabled={deletingAssignmentId === assignment.id}
                      className="ml-4 shrink-0 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition disabled:opacity-40">
                      {deletingAssignmentId === assignment.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
      {!loading && moduleId === '' && courseId !== '' && <div className="text-center text-sm text-slate-400 py-8">Select a module to manage its notes and assignments.</div>}
      {!loading && courseId === '' && <div className="text-center text-sm text-slate-400 py-8">Select a course to get started.</div>}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
const InstructorDashboard: React.FC<InstructorDashboardProps> = ({ user }) => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<StudentStat[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [classAvg, setClassAvg] = useState<number>(0);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [aiResult, setAiResult] = useState<AiGradeResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"submissions" | "students" | "manage">("submissions");
  const [classSummary, setClassSummary] = useState("");
  const [classSummaryLoading, setClassSummaryLoading] = useState(false);
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  // ?upload=notes&course=ID (from a course page or the Notes page) opens the
  // upload dialog with that course chosen.
  const [uploadLink] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('upload') === 'notes' ? { course: Number(p.get('course')) || undefined } : null;
  });
  const [showUploadNotes, setShowUploadNotes] = useState(!!uploadLink);
  const [studentSearch, setStudentSearch] = useState('');
  const [submissionFileCount, setSubmissionFileCount] = useState<Record<number, number>>({});

  const [roadmapPanel, setRoadmapPanel] = useState<{
    studentId: number;
    studentName: string;
    courseId: number;
    courseName: string;
  } | null>(null);
  const [topicsPanel, setTopicsPanel] = useState<typeof roadmapPanel>(null);

  // Grading queue, one page at a time (newest first). File counts come with
  // each row, so there is no per-submission request.
  const [queueTotal, setQueueTotal] = useState(0);
  // "To grade" (pending) or "Graded" (to review and re-grade). The pending
  // count is kept separately for the "Waiting to be graded" figure.
  const [queueStatus, setQueueStatus] = useState<'pending' | 'graded'>('pending');
  const [pendingTotal, setPendingTotal] = useState(0);
  const queueStatusRef = useRef<'pending' | 'graded'>('pending');
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [queueLoadingMore, setQueueLoadingMore] = useState(false);

  function absorbPage(page: { items: any[]; total: number; nextCursor: string | null }, append: boolean) {
    setSubmissions(prev => {
      if (!append) return page.items;
      const seen = new Set(prev.map(s => s.id));
      return [...prev, ...page.items.filter(s => !seen.has(s.id))];
    });
    setSubmissionFileCount(prev => {
      const next = append ? { ...prev } : {};
      for (const s of page.items) if (s.file_count != null) next[s.id] = Number(s.file_count);
      return next;
    });
    setQueueTotal(page.total);
    setQueueCursor(page.nextCursor);
  }

  function loadSubmissions(status: 'pending' | 'graded' = queueStatus) {
    api.getSubmissionQueue({ status })
      .then((d: any) => {
        const page = asPage<any>(d);
        if (status === 'pending') setPendingTotal(page.total);
        if (status !== queueStatusRef.current) return;   // switched views while loading
        absorbPage(page, false);
        // Older backend without file counts: fall back to one request per row.
        page.items.filter(s => s.file_count == null).forEach((s: any) => {
          api.getSubmissionFiles(s.id)
            .then((files: any) => setSubmissionFileCount(prev => ({ ...prev, [s.id]: Array.isArray(files) ? files.length : 0 })))
            .catch(() => {});
        });
      })
      .catch(() => {});
  }

  function loadMoreSubmissions() {
    if (!queueCursor || queueLoadingMore) return;
    setQueueLoadingMore(true);
    api.getSubmissionQueue({ status: queueStatus, cursor: queueCursor })
      .then((d: any) => { if (queueStatusRef.current === queueStatus) absorbPage(asPage<any>(d), true); })
      .catch(() => toast.error('Could not load more submissions.'))
      .finally(() => setQueueLoadingMore(false));
  }

  // One row per student per course: averages are per course, and the
  // roadmap opens for that course.
  function loadStudents() {
    setStudentsLoading(true);
    Promise.all(
      courses.map((c: Course) => api.getCourseAnalytics(c.id).then((r: any) => ({ ...r, _course: c })))
    ).then((results: any[]) => {
      const list: StudentStat[] = [];
      results.forEach((r: any) => {
        if (!Array.isArray(r?.students)) return;
        r.students.forEach((s: any) => {
          const avg = s.avg_grade == null ? null : Math.round(Number(s.avg_grade));
          list.push({
            name: s.name, average: avg, missed: s.missed ?? 0, late: s.late ?? 0,
            status: avg == null ? 'No grades yet' : avg >= 75 ? 'On Track' : avg >= 55 ? 'Needs Review' : 'At Risk',
            student_id: s.student_id, course_id: r._course?.id, course_name: r._course?.code ?? r._course?.name,
          });
        });
      });
      setStudents(list.sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.name.localeCompare(b.name)));
      const graded = list.filter(v => v.average != null);
      setClassAvg(graded.length > 0 ? Math.round(graded.reduce((sum, v) => sum + (v.average ?? 0), 0) / graded.length) : 0);
    }).catch(() => {}).finally(() => setStudentsLoading(false));
  }

  function switchQueue(status: 'pending' | 'graded') {
    if (status === queueStatus) return;
    setQueueStatus(status);
    queueStatusRef.current = status;
    setSelectedSubmission(null); setAiResult(null);
    setSubmissions([]); setQueueCursor(null); setQueueTotal(0);
    loadSubmissions(status);
  }

  /** Open a submission: a graded one shows the saved grade and feedback; otherwise a saved AI draft, if any. */
  function openSubmission(sub: any) {
    setSelectedSubmission(sub);
    const savedAi = sub.ai_score != null ? {
      score: sub.ai_score ?? 0, feedback: sub.ai_feedback ?? '',
      strengths: sub.ai_strengths ?? [], improvements: sub.ai_improvements ?? [], graded_via: 'pdf',
    } as AiGradeResult : null;
    setAiResult(savedAi);
    if (sub.grade != null) {
      setGrade(Number(sub.grade));
      setFeedback(sub.feedback ?? '');
    } else if (savedAi) {
      setGrade(savedAi.score);
      setFeedback(savedAi.feedback);
    } else {
      setGrade(0); setFeedback('');
    }
  }

  useEffect(() => {
    loadSubmissions('pending');
    api.getInstructorCourses()
      .then((d: any) => setCourses(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [user.id]);

  useEffect(() => {
    if (courses.length > 0) loadStudents();
  }, [courses]);

  const fetchClassSummary = async () => {
    // Only students with graded work: there is nothing to summarise otherwise.
    const graded = students.filter((s): s is StudentStat & { average: number } => s.average != null);
    if (graded.length === 0) { toast.info("Nothing has been graded yet."); return; }
    setClassSummaryLoading(true); setClassSummary("");
    try {
      // Student names never go to the AI provider: it sees "Student 1"... and
      // the names are put back here, in the browser.
      const classData: ClassOverviewData = {
        courseName: courses.map(c => c.name).join(', ') || 'All Courses',
        classAverage: classAvg,
        students: graded.map((s, i) => ({ name: `Student ${i + 1}`, average: s.average, missed: s.missed, status: s.status })),
      };
      const summary = await getClassOverviewSummary(classData);
      setClassSummary(summary.replace(/Student (\d+)/g, (m, n) => graded[Number(n) - 1]?.name ?? m));
    } catch { toast.error("Could not generate class summary."); }
    finally { setClassSummaryLoading(false); }
  };


  /**
   * AI Grade handler — uses RAG-enhanced /api/ai/grade-pdf when the submission
   * has files; falls back to text-only /api/ai/grade for text-only submissions.
   *
   * Rubric construction priority:
   *   1. Instructor-defined rubric (a.rubric) — most accurate
   *   2. Assignment description/instructions (a.description)
   *   3. Generic fallback rubric
   * Score scale always uses the real max_points, not a hardcoded 100.
   */
  const handleAiGrade = async () => {
    if (!selectedSubmission) return;
    setIsAiLoading(true); setAiResult(null);

    const sub = selectedSubmission as any;
    const fileCount = submissionFileCount[selectedSubmission.id] ?? 0;
    const maxPts: number = sub.max_points ?? 100;

    // ── Build rubric prompt ──────────────────────────────────────────────────
    const rubricParts: string[] = [];
    if (sub.assignment_title) rubricParts.push(`Assignment: ${sub.assignment_title}`);
    if (sub.assignment_description?.trim()) rubricParts.push(`Instructions:\n${sub.assignment_description.trim()}`);
    if (sub.rubric?.trim()) {
      // Instructor provided a structured rubric — use it verbatim
      rubricParts.push(`Rubric:\n${sub.rubric.trim()}`);
    } else {
      // Fallback: generic criteria
      rubricParts.push(
        'Rubric: Assess understanding of core concepts, clarity of explanation, use of relevant examples, depth of analysis, and conclusion quality.'
      );
    }
    rubricParts.push(`Score out of ${maxPts}. Return your score as a number between 0 and ${maxPts}.`);
    const rubric = rubricParts.join('\n\n');
    // ────────────────────────────────────────────────────────────────────────

    try {
      let result: AiGradeResult;

      if (fileCount > 0) {
        // Full RAG-enhanced PDF grading — reads actual uploaded files from Supabase storage
        const moduleId: number | undefined = sub.module_id ?? undefined;
        const raw = await api.aiGradePdf(selectedSubmission.id, rubric, moduleId);
        result = {
          score:            raw.score ?? 0,
          feedback:         raw.feedback ?? '',
          strengths:        Array.isArray(raw.strengths)    ? raw.strengths    : [],
          improvements:     Array.isArray(raw.improvements) ? raw.improvements : [],
          rubric_breakdown: Array.isArray(raw.rubric_breakdown) ? raw.rubric_breakdown : undefined,
          confidence:       typeof raw.confidence === 'number' ? raw.confidence : estimateConfidence(raw),
          graded_via:       'pdf',
        };
      } else {
        // Text-only fallback (legacy ephemeral route)
        const raw = await api.aiGrade(selectedSubmission.content ?? '', rubric);
        result = {
          score:        raw.score ?? 0,
          feedback:     raw.feedback ?? '',
          strengths:    Array.isArray(raw.strengths)    ? raw.strengths    : [],
          improvements: Array.isArray(raw.improvements) ? raw.improvements : [],
          confidence:   typeof raw.confidence === 'number' ? raw.confidence : estimateConfidence(raw),
          graded_via:   'text',
        };
      }

      setAiResult(result);
      toast.success(fileCount > 0 ? '🧠 RAG-enhanced AI grade ready!' : 'AI grading suggestion ready!');
    } catch (err: any) {
      toast.error(err?.message ?? 'AI grading failed. Please try again.');
    } finally {
      setIsAiLoading(false);
    }
  };

  /** Heuristically estimate confidence from strengths/improvements count */
  function estimateConfidence(raw: any): number {
    const s = (raw.strengths?.length ?? 0);
    const i = (raw.improvements?.length ?? 0);
    const hasBreakdown = Array.isArray(raw.rubric_breakdown) && raw.rubric_breakdown.length > 0;
    if (hasBreakdown && s >= 2 && i >= 1) return 88;
    if (s >= 2 && i >= 1) return 72;
    if (s >= 1) return 58;
    return 45;
  }

  const handleAcceptAiGrade = () => {
    if (!aiResult) return;
    setGrade(aiResult.score);
    setFeedback(
      aiResult.feedback +
      (aiResult.strengths?.length
        ? `\n\nStrengths:\n${aiResult.strengths.map(s => `• ${s}`).join('\n')}`
        : '') +
      (aiResult.improvements?.length
        ? `\n\nSuggested Improvements:\n${aiResult.improvements.map(s => `• ${s}`).join('\n')}`
        : '')
    );
    toast.success('AI grade accepted — edit if needed, then publish.');
  };

  const submitGrade = async () => {
    if (!selectedSubmission) return;
    setIsSubmitting(true);
    try {
      const saved: any = await api.gradeSubmission(selectedSubmission.id, grade, feedback);
      if ((selectedSubmission as any).grade != null) {
        // Re-grade: keep it in the Graded list with the new grade.
        const updated = { ...selectedSubmission, grade, feedback, graded_at: saved?.graded_at ?? new Date().toISOString() } as any;
        setSubmissions(prev => prev.map(s => (s.id === updated.id ? updated : s)));
        setSelectedSubmission(updated);
        toast.success('Grade updated. The student has been told.');
      } else {
        toast.success('Grade published successfully!');
        setSubmissions(prev => prev.filter(s => s.id !== selectedSubmission.id));
        setQueueTotal(t => Math.max(0, t - 1));
        setPendingTotal(t => Math.max(0, t - 1));
        setSelectedSubmission(null); setAiResult(null);
      }
    } catch { toast.error('Failed to save the grade.'); }
    finally { setIsSubmitting(false); }
  };

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(studentSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />

      <AnimatePresence>
        {roadmapPanel && (
          <InstructorRoadmapView
            studentId={roadmapPanel.studentId}
            studentName={roadmapPanel.studentName}
            courseId={roadmapPanel.courseId}
            courseName={roadmapPanel.courseName}
            onClose={() => setRoadmapPanel(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {topicsPanel && (
          <StudentTopicsPanel
            studentId={topicsPanel.studentId}
            studentName={topicsPanel.studentName}
            courseId={topicsPanel.courseId}
            courseName={topicsPanel.courseName}
            onClose={() => setTopicsPanel(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateAssignment && <CreateAssignmentModal courses={courses} onClose={() => setShowCreateAssignment(false)} onCreated={() => loadSubmissions()} />}
        {showUploadNotes && (
          <UploadNotesModal
            courses={courses}
            initialCourseId={uploadLink?.course}
            onClose={() => { setShowUploadNotes(false); if (uploadLink) window.history.replaceState(null, '', '/'); }}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Instructor Dashboard</h1>
          <p className="text-slate-500 mt-1">Manage your courses, grade submissions, and monitor student progress.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setShowUploadNotes(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-50 border border-teal-200 text-teal-700 rounded-2xl text-sm font-bold hover:bg-teal-100 transition">
            <Upload className="w-4 h-4" /> Upload Notes
          </button>
          <button onClick={() => setShowCreateAssignment(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/20">
            <Plus className="w-4 h-4" /> Create Assignment
          </button>
          <div role="tablist" className="flex max-w-full overflow-x-auto bg-white p-1 rounded-2xl border border-slate-100 shadow-sm">
            {([["submissions", "Grading"], ["students", "Students"], ["manage", "Manage"]] as const).map(([tab, label]) => (
              <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}
                className={`shrink-0 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-500 hover:bg-slate-50"
                }`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Waiting to be graded", value: pendingTotal, sub: "Submissions without a grade", icon: Clock, tone: "bg-indigo-100 text-indigo-600" },
          { label: "Assignment average", value: studentsLoading && !students.length ? '…' : classAvg > 0 ? `${classAvg}%` : '—', sub: "Across your courses", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" },
          { label: "Below 55%", value: studentsLoading && !students.length ? '…' : new Set(students.filter(s => s.status === 'At Risk').map(s => s.student_id ?? s.name)).size, sub: "Students under 55% in at least one course", icon: AlertCircle, tone: "bg-red-100 text-red-600" },
        ].map((kpi, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-4 mb-4">
              <div className={`${kpi.tone} p-3 rounded-2xl`}>
                <kpi.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{kpi.label}</p>
                <h3 className="text-2xl font-bold text-slate-900">{kpi.value}</h3>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-medium">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Notices due in the next two days across this professor's courses. */}
      <UpcomingNoticesCard />

      <UpcomingExamsCard limit={3} />

      {activeTab === "submissions" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Queue ── */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Grading Queue</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">{queueTotal}</span>
            </div>
            <div role="tablist" aria-label="Submissions" className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-2xl">
              {([['pending', 'To grade'], ['graded', 'Graded']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={queueStatus === key} onClick={() => switchQueue(key)}
                  className={`py-2 rounded-xl text-sm font-semibold transition-colors ${
                    queueStatus === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {label}{key === 'pending' ? ` (${pendingTotal})` : ''}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {submissions.map(sub => {
                const fileCount = submissionFileCount[sub.id] ?? 0;
                const hasSavedAi = !!(sub as any).ai_score;
                return (
                  <button key={sub.id} onClick={() => openSubmission(sub)}
                    className={`w-full text-left p-6 rounded-3xl border transition-all ${
                      selectedSubmission?.id === sub.id
                        ? "bg-white border-indigo-500 shadow-xl shadow-indigo-600/5 ring-1 ring-indigo-500"
                        : "bg-white border-slate-100 shadow-sm hover:border-indigo-200"
                    }`}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-bold text-xs">
                        {sub.student_name.split(" ").map((n: string) => n[0]).join("")}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{sub.course_name}</span>
                        <div className="flex items-center gap-1">
                          {fileCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                              <FileText className="w-2.5 h-2.5" /> {fileCount}
                            </span>
                          )}
                          {hasSavedAi && (
                            <span className="flex items-center gap-0.5 text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                              <Brain className="w-2.5 h-2.5" /> AI ready
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm mb-1">{sub.student_name}</h4>
                    <p className="text-xs text-slate-500 mb-4">{sub.assignment_title}</p>
                    {(sub as any).grade != null ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {(sub as any).grade}/{(sub as any).max_points ?? 100}
                        </span>
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Review →</span>
                      </div>
                    ) : (
                      <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Grade Now →</div>
                    )}
                  </button>
                );
              })}
              {queueCursor && (
                <button
                  type="button"
                  onClick={loadMoreSubmissions}
                  disabled={queueLoadingMore}
                  className="w-full py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-indigo-600 hover:border-indigo-300 disabled:opacity-60"
                >
                  {queueLoadingMore ? "Loading…" : `Load more (${Math.max(0, queueTotal - submissions.length)} left)`}
                </button>
              )}
              {submissions.length === 0 && (
                <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">{queueStatus === 'graded' ? 'Nothing graded yet.' : 'All caught up!'}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Grading Panel ── */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {selectedSubmission ? (() => {
                const maxPts = (selectedSubmission as any).max_points ?? 100;
                const scoreRingPct = aiResult ? Math.round((aiResult.score / maxPts) * 100) : 0;
                return (
                <motion.div key={selectedSubmission.id}
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">

                  {/* Header */}
                  <div className="p-8 border-b border-slate-50 bg-slate-50/50">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-bold text-slate-900">{selectedSubmission.student_name}</h3>
                        <p className="text-sm text-slate-500">{selectedSubmission.assignment_title}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {(selectedSubmission as any).grade != null && (
                            <span data-testid="graded-badge" className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                              <CheckCircle2 className="w-3 h-3" />
                              Graded {(selectedSubmission as any).grade}/{maxPts}
                              {(selectedSubmission as any).graded_at && <> on {new Date((selectedSubmission as any).graded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>}
                            </span>
                          )}
                          {(submissionFileCount[selectedSubmission.id] ?? 0) > 0 && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                              <FileText className="w-3 h-3" />
                              {submissionFileCount[selectedSubmission.id]} file{submissionFileCount[selectedSubmission.id] > 1 ? 's' : ''} attached
                            </span>
                          )}
                          {(submissionFileCount[selectedSubmission.id] ?? 0) > 0 && (
                            <span className="text-[10px] text-indigo-400 font-medium">RAG-enhanced grading available</span>
                          )}
                          {(selectedSubmission as any).rubric?.trim() && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                              <BarChart3 className="w-3 h-3" /> Custom rubric
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={handleAiGrade} disabled={isAiLoading}
                        className="shrink-0 px-5 py-2.5 bg-green-700 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-green-800 transition-all shadow-lg shadow-green-700/20 disabled:opacity-50">
                        {isAiLoading
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> Grading…</>
                          : <><Brain className="w-4 h-4" /> AI Grade{(submissionFileCount[selectedSubmission.id] ?? 0) > 0 ? ' (RAG)' : ''}</>
                        }
                      </button>
                    </div>
                  </div>

                  <div className="p-8 space-y-6">
                    {/* Submission content */}
                    {selectedSubmission.content && (
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Submission Text</h4>
                        <p className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">{selectedSubmission.content}</p>
                      </div>
                    )}

                    {/* AI Result Panel */}
                    <AnimatePresence>
                      {aiResult && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                          className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 overflow-hidden">

                          {/* AI result header */}
                          <div className="p-5 border-b border-green-100 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="bg-green-700 p-1.5 rounded-lg"><Brain className="w-3.5 h-3.5 text-white" /></div>
                              <span className="text-sm font-bold text-green-900">AI Grading Result</span>
                              <div className="flex items-center gap-1 bg-white/60 px-2 py-0.5 rounded-full border border-green-100">
                                <Sparkles className="w-3 h-3 text-green-600" />
                                <span className="text-xs font-semibold text-green-800">
                                  {aiResult.graded_via === 'pdf' ? 'Draft from the submitted files' : 'Draft'}: check before saving
                                </span>
                              </div>
                              <ConfidenceBadge confidence={aiResult.confidence} />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={handleAcceptAiGrade}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white rounded-xl text-xs font-bold hover:bg-green-800 transition-all">
                                <ThumbsUp className="w-3 h-3" /> Accept & Fill
                              </button>
                              <button onClick={handleAiGrade} disabled={isAiLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-green-700 border border-green-200 rounded-xl text-xs font-bold hover:bg-green-50 transition-all disabled:opacity-50">
                                <RefreshCw className="w-3 h-3" /> Re-run
                              </button>
                            </div>
                          </div>

                          {/* Score + Feedback */}
                          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
                            <div className="text-center">
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-1">Score</p>
                              <p className="text-4xl font-bold text-green-800 tabular-nums">{aiResult.score}</p>
                              <p className="text-xs text-green-600">/{maxPts}</p>
                              {/* Score ring — arc scaled to actual max_points */}
                              <div className="mt-2 mx-auto w-16">
                                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#d1fae5" strokeWidth="3" />
                                  <circle cx="18" cy="18" r="15.9" fill="none"
                                    stroke={scoreRingPct >= 75 ? '#059669' : scoreRingPct >= 55 ? '#d97706' : '#dc2626'}
                                    strokeWidth="3"
                                    strokeDasharray={`${scoreRingPct} 100`}
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </div>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-1">Feedback</p>
                              <p className="text-sm text-green-900 leading-relaxed">{aiResult.feedback}</p>
                            </div>
                          </div>

                          {/* Strengths & Improvements */}
                          <div className="px-5 pb-5 grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-2">Strengths</p>
                              <ul className="space-y-1">
                                {aiResult.strengths.map((s: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-green-800"><span className="text-emerald-500 mt-0.5">✓</span> {s}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-2">Improvements</p>
                              <ul className="space-y-1">
                                {aiResult.improvements.map((s: string, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-green-800"><span className="text-amber-500 mt-0.5">→</span> {s}</li>
                                ))}
                              </ul>
                            </div>
                          </div>

                          {/* Rubric Breakdown (only if returned by grade-pdf) */}
                          {aiResult.rubric_breakdown && aiResult.rubric_breakdown.length > 0 && (
                            <div className="px-5 pb-5">
                              <RubricBreakdownPanel breakdown={aiResult.rubric_breakdown} />
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Manual grade inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Grade (0–{maxPts})</label>
                        <div className="relative">
                          <input type="number" aria-label="Grade" value={grade} onChange={(e) => setGrade(Number(e.target.value))}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-2xl font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 text-center"
                            min="0" max={maxPts} />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">/{maxPts}</span>
                        </div>
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Feedback</label>
                        <textarea aria-label="Feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4}
                          className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                          placeholder="Provide constructive feedback…" />
                      </div>
                    </div>

                    <div className="flex justify-end gap-4">
                      <button onClick={() => { setSelectedSubmission(null); setAiResult(null); }}
                        className="px-8 py-3 text-sm font-bold text-slate-500 hover:text-slate-700">
                        {(selectedSubmission as any).grade != null ? 'Close' : 'Skip for Now'}
                      </button>
                      <button onClick={submitGrade} disabled={isSubmitting}
                        className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50">
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{(selectedSubmission as any).grade != null ? 'Update Grade' : 'Publish Grade'} <CheckCircle2 className="w-4 h-4" /></>}
                      </button>
                    </div>
                  </div>
                </motion.div>
                );
              })() : (
                <div className="h-full flex flex-col items-center justify-center p-12 bg-white rounded-[32px] border border-dashed border-slate-200 text-center min-h-[400px]">
                  <div className="bg-slate-50 p-6 rounded-full mb-4"><Star className="w-12 h-12 text-slate-300" /></div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Select a submission to grade</h3>
                  <p className="text-sm text-slate-500 max-w-xs">Choose a student's work from the list on the left to start grading.</p>
                  <div className="flex gap-3 mt-6">
                    <button onClick={() => setShowCreateAssignment(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition">
                      <Plus className="w-4 h-4" /> New Assignment
                    </button>
                    <button onClick={() => setShowUploadNotes(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-50 border border-teal-200 text-teal-700 rounded-xl text-sm font-bold hover:bg-teal-100 transition">
                      <Upload className="w-4 h-4" /> Upload Notes
                    </button>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {activeTab === "students" && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-[28px] border border-slate-100 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-600 p-2 rounded-xl"><Brain className="w-4 h-4 text-white" /></div>
                <h3 className="text-sm font-bold text-slate-900">Class summary</h3>
              </div>
              {!classSummaryLoading && students.length > 0 && (
                <button onClick={fetchClassSummary} className="text-sm font-semibold text-indigo-700 hover:underline">
                  {classSummary ? 'Summarise again' : 'Summarise the class with AI'}
                </button>
              )}
            </div>
            {classSummaryLoading ? (
              <div className="mt-3 flex items-center gap-3 text-slate-600 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Writing the summary…</div>
            ) : classSummary ? (
              <p className="mt-3 text-sm text-slate-800 leading-relaxed"><BoldText text={classSummary} /></p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">A short read of who is doing well and who needs help. Student names are not sent to the AI.</p>
            )}
          </div>

          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 sm:p-8 border-b border-slate-50 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1">
                <h3 className="text-xl font-bold text-slate-900">Students</h3>
                <button type="button" onClick={loadStudents} title="Refresh student data"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${studentsLoading ? 'animate-spin' : ''}`} />
                  <span>{studentsLoading ? 'Refreshing…' : 'Refresh'}</span>
                </button>
              </div>
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" placeholder="Search students…" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                  aria-label="Search students"
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            {studentsLoading && students.length === 0 ? (
              <div className="flex items-center gap-3 text-slate-500 text-sm p-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading student data…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-xs font-semibold text-slate-500">
                      <th className="px-6 py-3">Student</th>
                      {courses.length > 1 && <th className="px-4 py-3">Course</th>}
                      <th className="px-4 py-3">Assignment average</th>
                      <th className="px-4 py-3">Late</th>
                      <th className="px-4 py-3">Missed</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-6 py-3"><span className="sr-only">Topics and roadmap</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredStudents.map((student) => {
                      const tone = STATUS_TONE[student.status] ?? STATUS_TONE['Needs Review'];
                      return (
                        <tr key={`${student.student_id}-${student.course_id}`} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-3 text-sm font-semibold text-slate-900">{student.name}</td>
                          {courses.length > 1 && <td className="px-4 py-3 text-sm text-slate-600">{student.course_name}</td>}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div className={`${tone.bar} h-2 rounded-full`} style={{ width: `${Math.min(100, student.average ?? 0)}%` }} />
                              </div>
                              <span className="text-sm font-bold text-slate-700 tabular-nums">{student.average == null ? '—' : `${student.average}%`}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-slate-600">{student.late}</td>
                          <td className="px-4 py-3 text-sm tabular-nums text-slate-600">{student.missed}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${tone.pill}`}>{student.status}</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            {student.course_id && student.student_id ? (
                              <div className="inline-flex gap-2">
                              <button
                                onClick={() => setTopicsPanel({
                                  studentId: student.student_id!,
                                  studentName: student.name,
                                  courseId: student.course_id!,
                                  courseName: student.course_name ?? 'Course',
                                })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-xl transition-colors"
                              >
                                <Target className="w-3.5 h-3.5" /> Topics
                              </button>
                              <button
                                onClick={() => setRoadmapPanel({
                                  studentId: student.student_id!,
                                  studentName: student.name,
                                  courseId: student.course_id!,
                                  courseName: student.course_name ?? 'Course',
                                })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                              >
                                <Map className="w-3.5 h-3.5" /> Roadmap
                              </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredStudents.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-sm text-slate-500 py-12">
                        {students.length === 0 ? 'No students enrolled in your courses yet.' : 'No students match the search.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Status uses the assignment average: on track at 75% and above, needs review from 55%, below 55% otherwise.
            Unit test and semester marks are under Assessments.
          </p>
        </div>
      )}

      {activeTab === "manage" && <ManageTab courses={courses} user={user} />}
    </div>
  );
};

export { InstructorDashboard };
