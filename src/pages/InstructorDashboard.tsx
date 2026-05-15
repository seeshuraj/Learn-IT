import React, { useEffect, useState, useRef } from "react";
import { User, Submission, Course } from "../types";
import { Users, BookOpen, Clock, CheckCircle2, AlertCircle, TrendingUp, Brain, Search, BarChart3, Star, Loader2, Sparkles, ThumbsUp, RefreshCw, Plus, X, Upload, Trash2, Map, FileText, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getClassOverviewSummary, ClassOverviewData } from "../services/aiService";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";
import InstructorRoadmapView from "./InstructorRoadmapView";

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
  average: number;
  missed: number;
  late: number;
  status: string;
  course_id?: number;
  course_name?: string;
}

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
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto"
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
          <div className="grid grid-cols-2 gap-4">
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
function UploadNotesModal({ courses, onClose }: { courses: Course[]; onClose: () => void }) {
  const [courseId, setCourseId] = useState<number | ''>('');
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
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-md overflow-hidden"
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
                          {note.cloudinary_url ? ' · ☁ Cloud' : ' · 💾 Local'}
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
  const [activeTab, setActiveTab] = useState<"submissions" | "students" | "analytics" | "manage">("submissions");
  const [classSummary, setClassSummary] = useState("");
  const [classSummaryLoading, setClassSummaryLoading] = useState(false);
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [showUploadNotes, setShowUploadNotes] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [submissionFileCount, setSubmissionFileCount] = useState<Record<number, number>>({});

  const [roadmapPanel, setRoadmapPanel] = useState<{
    studentName: string;
    courseId: number;
    courseName: string;
  } | null>(null);

  function loadSubmissions() {
    api.getInstructorSubmissions()
      .then((d: any) => {
        const subs = Array.isArray(d) ? d : [];
        setSubmissions(subs);
        // Fetch file counts for each submission in parallel (best-effort)
        subs.forEach((s: any) => {
          api.getSubmissionFiles(s.id)
            .then((files: any) => {
              const count = Array.isArray(files) ? files.length : 0;
              setSubmissionFileCount(prev => ({ ...prev, [s.id]: count }));
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
  }

  function loadStudents() {
    setStudentsLoading(true);
    Promise.all(
      courses.map((c: Course) => api.getCourseAnalytics(c.id).then((r: any) => ({ ...r, _course: c })))
    ).then((results: any[]) => {
      const map = new Map<string, { name: string; total: number; count: number; missed: number; late: number; student_id?: number; course_id?: number; course_name?: string }>();
      results.forEach((r: any) => {
        if (!Array.isArray(r?.students)) return;
        r.students.forEach((s: any) => {
          const key = String(s.student_id ?? s.name);
          const prev = map.get(key) ?? { name: s.name, total: 0, count: 0, missed: 0, late: 0 };
          map.set(key, {
            name:        s.name,
            total:       prev.total  + (s.avg_grade ?? 0),
            count:       prev.count  + 1,
            missed:      prev.missed + (s.missed ?? 0),
            late:        prev.late   + (s.late   ?? 0),
            student_id:  s.student_id,
            course_id:   r._course?.id,
            course_name: r._course?.name,
          });
        });
      });
      const list: StudentStat[] = [];
      map.forEach(v => {
        const avg = v.count > 0 ? Math.round(v.total / v.count) : 0;
        list.push({ name: v.name, average: avg, missed: v.missed, late: v.late,
          status: avg >= 75 ? 'On Track' : avg >= 55 ? 'Needs Review' : 'At Risk',
          student_id: v.student_id, course_id: v.course_id, course_name: v.course_name });
      });
      setStudents(list.sort((a, b) => b.average - a.average));
      const allAvg = list.length > 0 ? Math.round(list.reduce((s, v) => s + v.average, 0) / list.length) : 0;
      setClassAvg(allAvg);
    }).catch(() => {}).finally(() => setStudentsLoading(false));
  }

  useEffect(() => {
    loadSubmissions();
    api.getInstructorCourses(user.id)
      .then((d: any) => setCourses(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [user.id]);

  useEffect(() => {
    if (activeTab === 'students' && courses.length > 0) loadStudents();
    if (activeTab === 'analytics' && courses.length > 0 && students.length === 0) loadStudents();
  }, [activeTab, courses]);

  const fetchClassSummary = async () => {
    if (students.length === 0) return;
    setClassSummaryLoading(true); setClassSummary("");
    try {
      const classData: ClassOverviewData = {
        courseName: courses.map(c => c.name).join(', ') || 'All Courses',
        classAverage: classAvg,
        students: students.map(s => ({ name: s.name, average: s.average, missed: s.missed, status: s.status })),
      };
      const summary = await getClassOverviewSummary(classData);
      setClassSummary(summary);
    } catch { toast.error("Could not generate class summary."); }
    finally { setClassSummaryLoading(false); }
  };

  useEffect(() => {
    if (activeTab === "analytics" && students.length > 0 && !classSummary) fetchClassSummary();
  }, [activeTab, students]);

  /**
   * AI Grade handler — uses RAG-enhanced /api/ai/grade-pdf when the submission
   * has files; falls back to text-only /api/ai/grade for text-only submissions.
   * Persists result to DB (ai_score, ai_feedback, ai_strengths, ai_improvements).
   */
  const handleAiGrade = async () => {
    if (!selectedSubmission) return;
    setIsAiLoading(true); setAiResult(null);

    const fileCount = submissionFileCount[selectedSubmission.id] ?? 0;
    // Build rubric from assignment description if available, else use default
    const rubric = (selectedSubmission as any).assignment_description
      ? `Assignment: ${(selectedSubmission as any).assignment_title}\n\nInstructions: ${(selectedSubmission as any).assignment_description}\n\nRubric: Assess understanding of core concepts, clarity of explanation, use of examples, and conclusion quality. Score out of 100.`
      : "Assess understanding of core concepts, clarity of explanation, use of examples, and conclusion quality. Score out of 100.";

    try {
      let result: AiGradeResult;

      if (fileCount > 0) {
        // Full RAG-enhanced PDF grading — reads actual uploaded files from Supabase storage
        const moduleId: number | undefined = (selectedSubmission as any).module_id ?? undefined;
        const raw = await api.aiGradePdf(selectedSubmission.id, rubric, moduleId);
        result = {
          score:            raw.score ?? 0,
          feedback:         raw.feedback ?? '',
          strengths:        Array.isArray(raw.strengths)   ? raw.strengths   : [],
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
          strengths:    Array.isArray(raw.strengths)   ? raw.strengths   : [],
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
      await api.gradeSubmission(selectedSubmission.id, grade, feedback);
      toast.success('Grade published successfully!');
      setSubmissions(prev => prev.filter(s => s.id !== selectedSubmission.id));
      setSelectedSubmission(null); setAiResult(null);
    } catch { toast.error('Failed to publish grade.'); }
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
            studentName={roadmapPanel.studentName}
            courseId={roadmapPanel.courseId}
            courseName={roadmapPanel.courseName}
            onClose={() => setRoadmapPanel(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateAssignment && <CreateAssignmentModal courses={courses} onClose={() => setShowCreateAssignment(false)} onCreated={loadSubmissions} />}
        {showUploadNotes && <UploadNotesModal courses={courses} onClose={() => setShowUploadNotes(false)} />}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Instructor Dashboard</h1>
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
          <div className="flex bg-white p-1 rounded-2xl border border-slate-100 shadow-sm">
            {(["submissions", "students", "analytics", "manage"] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize ${
                  activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-500 hover:bg-slate-50"
                }`}>{tab}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Pending Grading",  value: submissions.length,                              sub: "Action required",  icon: Clock,         color: "indigo"  },
          { label: "Class Average",     value: classAvg > 0 ? `${classAvg}%` : '—',            sub: "Across all courses", icon: CheckCircle2,   color: "emerald" },
          { label: "At-Risk Students",  value: students.filter(s => s.status === 'At Risk').length, sub: "Flagged by AI", icon: AlertCircle,    color: "red"     },
        ].map((kpi, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-4 mb-4">
              <div className={`bg-${kpi.color}-100 p-3 rounded-2xl text-${kpi.color}-600`}>
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

      {activeTab === "submissions" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Queue ── */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Grading Queue</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">{submissions.length}</span>
            </div>
            <div className="space-y-3">
              {submissions.map(sub => {
                const fileCount = submissionFileCount[sub.id] ?? 0;
                const hasSavedAi = !!(sub as any).ai_score;
                return (
                  <button key={sub.id} onClick={() => {
                    setSelectedSubmission(sub);
                    // Pre-populate grade/feedback from saved ai_score if exists
                    if (hasSavedAi) {
                      setGrade((sub as any).ai_score ?? 0);
                      setFeedback((sub as any).ai_feedback ?? '');
                      setAiResult({
                        score:        (sub as any).ai_score ?? 0,
                        feedback:     (sub as any).ai_feedback ?? '',
                        strengths:    (sub as any).ai_strengths ?? [],
                        improvements: (sub as any).ai_improvements ?? [],
                        graded_via:   'pdf',
                      });
                    } else {
                      setGrade(0); setFeedback(''); setAiResult(null);
                    }
                  }}
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
                    <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Grade Now →</div>
                  </button>
                );
              })}
              {submissions.length === 0 && (
                <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">All caught up!</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Grading Panel ── */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {selectedSubmission ? (
                <motion.div key={selectedSubmission.id}
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">

                  {/* Header */}
                  <div className="p-8 border-b border-slate-50 bg-slate-50/50">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-bold text-slate-900">{selectedSubmission.student_name}</h3>
                        <p className="text-sm text-slate-500">{selectedSubmission.assignment_title}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {(submissionFileCount[selectedSubmission.id] ?? 0) > 0 && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                              <FileText className="w-3 h-3" />
                              {submissionFileCount[selectedSubmission.id]} file{submissionFileCount[selectedSubmission.id] > 1 ? 's' : ''} attached
                            </span>
                          )}
                          {(submissionFileCount[selectedSubmission.id] ?? 0) > 0 && (
                            <span className="text-[10px] text-indigo-400 font-medium">RAG-enhanced grading available</span>
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
                                <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">
                                  {aiResult.graded_via === 'pdf' ? 'NVIDIA NIM · RAG' : 'NVIDIA NIM'}
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
                              <p className="text-xs text-green-600">/100</p>
                              {/* Score ring indicator */}
                              <div className="mt-2 mx-auto w-16">
                                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#d1fae5" strokeWidth="3" />
                                  <circle cx="18" cy="18" r="15.9" fill="none"
                                    stroke={aiResult.score >= 75 ? '#059669' : aiResult.score >= 55 ? '#d97706' : '#dc2626'}
                                    strokeWidth="3"
                                    strokeDasharray={`${aiResult.score} 100`}
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
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Grade (0–100)</label>
                        <div className="relative">
                          <input type="number" value={grade} onChange={(e) => setGrade(Number(e.target.value))}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-2xl font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 text-center"
                            min="0" max="100" />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">/100</span>
                        </div>
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Feedback</label>
                        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4}
                          className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                          placeholder="Provide constructive feedback…" />
                      </div>
                    </div>

                    <div className="flex justify-end gap-4">
                      <button onClick={() => { setSelectedSubmission(null); setAiResult(null); }}
                        className="px-8 py-3 text-sm font-bold text-slate-500 hover:text-slate-700">Skip for Now</button>
                      <button onClick={submitGrade} disabled={isSubmitting}
                        className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50">
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Publish Grade <CheckCircle2 className="w-4 h-4" /></>}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
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
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <h3 className="text-xl font-bold text-slate-900">Student Monitoring</h3>
              <button type="button" onClick={loadStudents} title="Refresh student data"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-indigo-600 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${studentsLoading ? 'animate-spin' : ''}`} />
                <span>{studentsLoading ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            </div>
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search students…" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          {studentsLoading ? (
            <div className="flex items-center gap-3 text-slate-400 text-sm p-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading student data…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50">
                    {["Student", "Average", "Late", "Missed", "AI Status", ""].map((h, i) => (
                      <th key={i} className={`px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest ${i === 5 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredStudents.map((student, i) => {
                    const color = student.status === "On Track" ? "emerald" : student.status === "At Risk" ? "red" : "amber";
                    return (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 bg-${color}-50 text-${color}-600 rounded-xl flex items-center justify-center font-bold text-xs`}>
                              {student.name.split(" ").map((n: string) => n[0]).join("")}
                            </div>
                            <span className="text-sm font-bold text-slate-900">{student.name}</span>
                          </div>
                        </td>
                        <td className="px-8 py-4 font-bold text-slate-700 tabular-nums">{student.average}%</td>
                        <td className="px-8 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            student.late > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                          }`}>{student.late}</span>
                        </td>
                        <td className="px-8 py-4 text-slate-500">{student.missed}</td>
                        <td className="px-8 py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${color}-100 text-${color}-700`}>
                            {student.status}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-right">
                          {student.course_id ? (
                            <button
                              onClick={() => setRoadmapPanel({
                                studentName: student.name,
                                courseId: student.course_id!,
                                courseName: student.course_name ?? 'Course',
                              })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                            >
                              <Map className="w-3.5 h-3.5" /> Roadmap
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-sm text-slate-400 py-12">
                      {students.length === 0 ? 'No student data available yet.' : 'No students match the search.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "analytics" && (
        <div className="space-y-8">
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-[28px] border border-green-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-green-700 p-2 rounded-xl"><Brain className="w-4 h-4 text-white" /></div>
              <h3 className="text-sm font-bold text-green-900">AI Class Overview</h3>
              <div className="flex items-center gap-1 bg-white/60 px-2.5 py-1 rounded-full border border-green-100 ml-2">
                <Sparkles className="w-3 h-3 text-green-600" />
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">NVIDIA NIM</span>
              </div>
            </div>
            {classSummaryLoading ? (
              <div className="flex items-center gap-3 text-green-800 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Generating AI class summary…</div>
            ) : classSummary ? (
              <p className="text-sm text-green-900 leading-relaxed"><BoldText text={classSummary} /></p>
            ) : (
              <button onClick={fetchClassSummary} className="text-sm text-green-700 font-bold hover:underline">Generate summary</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: "Class Average", value: classAvg > 0 ? `${classAvg}%` : '—', icon: TrendingUp,  color: "emerald" },
              { label: "On Track",      value: students.filter(s => s.status === "On Track").length,     icon: CheckCircle2, color: "indigo"  },
              { label: "At Risk",       value: students.filter(s => s.status === "At Risk").length,      icon: AlertCircle,  color: "red"     },
            ].map((kpi, i) => (
              <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`bg-${kpi.color}-100 p-2.5 rounded-xl`}><kpi.icon className={`w-5 h-5 text-${kpi.color}-600`} /></div>
                  <p className="text-sm text-slate-500 font-medium">{kpi.label}</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{kpi.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-[28px] border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-50">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-500" /> Performance Breakdown
              </h3>
            </div>
            {studentsLoading ? (
              <div className="flex items-center gap-3 text-slate-400 text-sm p-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {students.map((s, i) => {
                  const color = s.status === "On Track" ? "emerald" : s.status === "At Risk" ? "red" : "amber";
                  return (
                    <div key={i} className="px-8 py-4 flex items-center gap-6">
                      <div className="w-32 shrink-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{s.name}</p>
                        <span className={`text-[10px] font-bold uppercase tracking-wider text-${color}-600`}>{s.status}</span>
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className={`bg-${color}-500 h-2 rounded-full transition-all`} style={{ width: `${s.average}%` }} />
                      </div>
                      <span className="text-sm font-bold text-slate-700 tabular-nums w-12 text-right">{s.average}%</span>
                    </div>
                  );
                })}
                {students.length === 0 && <div className="text-center text-sm text-slate-400 py-12">No analytics data available yet.</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "manage" && <ManageTab courses={courses} user={user} />}
    </div>
  );
};

export { InstructorDashboard };
