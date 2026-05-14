import { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';

interface Assignment {
  id: number;
  title: string;
  description: string;
  due_date: string;
  max_points: number;
  module_name: string;
  course_name: string;
  submission_id?: number;
  submission_content?: string;
  grade?: number;
  ai_score?: number;
  ai_feedback?: string;
  feedback?: string;
  submitted_at?: string;
}

interface Props { user: any; }

export default function AssignmentsPage({ user }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [textContent, setTextContent] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'submitted'>('all');
  const [submitMode, setSubmitMode] = useState<'text' | 'file'>('text');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    fetchAssignments();
  }, [user?.id]);

  async function fetchAssignments() {
    setLoading(true);
    try {
      const data = await api.getStudentAssignments(user.id);
      setAssignments(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load assignments.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (submitMode === 'text' && !textContent.trim()) return setError('Answer cannot be empty.');
    if (submitMode === 'file' && (!files || files.length === 0)) return setError('Select at least one file.');

    setSubmitting(true); setError(''); setSuccess('');
    try {
      if (submitMode === 'file') {
        // student_id resolved server-side from JWT — do NOT send it from client
        await api.uploadSubmission(selected.id, Array.from(files!), textContent);
      } else {
        // student_id resolved server-side from JWT
        await api.submitAssignment(selected.id, textContent);
      }
      setSuccess('Submitted successfully! ✓');
      setTextContent(''); setFiles(null);
      if (fileRef.current) fileRef.current.value = '';
      await fetchAssignments();
      setSelected(prev => prev ? { ...prev, submission_id: -1 } : null);
    } catch (e: any) {
      setError(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = assignments.filter(a => {
    if (filter === 'pending') return !a.submission_id;
    if (filter === 'submitted') return !!a.submission_id;
    return true;
  });

  const isOverdue = (due: string) => new Date(due) < new Date();

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Assignments</h1>
          <p className="text-slate-500 text-sm mt-1">
            {assignments.length} total · {assignments.filter(a => !a.submission_id).length} pending
          </p>
        </div>
        <div className="flex gap-2">
          {(['all', 'pending', 'submitted'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition ${
                filter === f ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{f}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Assignment list */}
        <div className="lg:col-span-2 space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">No assignments</p>
            </div>
          )}
          {filtered.map(a => (
            <button
              key={a.id}
              onClick={() => { setSelected(a); setTextContent(''); setError(''); setSuccess(''); setFiles(null); }}
              className={`w-full text-left border rounded-xl p-4 transition ${
                selected?.id === a.id
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{a.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{a.course_name} · {a.module_name}</p>
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  a.grade != null
                    ? 'bg-green-100 text-green-700'
                    : a.submission_id
                    ? 'bg-blue-100 text-blue-700'
                    : isOverdue(a.due_date)
                    ? 'bg-red-100 text-red-600'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {a.grade != null ? `${a.grade}%` : a.submission_id ? 'Submitted' : isOverdue(a.due_date) ? 'Overdue' : 'Pending'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Due {new Date(a.due_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </button>
          ))}
        </div>

        {/* Detail + submission */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="flex items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              <div className="text-center">
                <div className="text-3xl mb-2">👈</div>
                <p className="text-sm">Select an assignment</p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">{selected.title}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {selected.course_name} · {selected.module_name} ·
                  Due {new Date(selected.due_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {selected.max_points && ` · ${selected.max_points} pts`}
                </p>
              </div>

              <div className="prose prose-sm prose-slate max-w-none bg-slate-50 rounded-lg p-4">
                <ReactMarkdown>{selected.description}</ReactMarkdown>
              </div>

              {selected.grade != null && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-green-700">{selected.grade}%</span>
                    <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Graded</span>
                    {selected.ai_score != null && (
                      <span className="text-xs text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                        AI suggested: {selected.ai_score}%
                      </span>
                    )}
                  </div>
                  {selected.feedback && (
                    <div className="prose prose-sm prose-green max-w-none">
                      <ReactMarkdown>{selected.feedback}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {selected.submission_id && selected.grade == null && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-700 font-medium">✓ Submitted — awaiting grade</p>
                  <p className="text-xs text-blue-500 mt-1">
                    {selected.submitted_at && new Date(selected.submitted_at).toLocaleDateString('en-IE')}
                  </p>
                </div>
              )}

              {!selected.submission_id && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex gap-2">
                    {(['text', 'file'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSubmitMode(mode)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                          submitMode === mode
                            ? 'bg-teal-700 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {mode === 'text' ? '✏️ Text answer' : '📎 Upload PDF / files'}
                      </button>
                    ))}
                  </div>

                  {submitMode === 'text' ? (
                    <textarea
                      className="w-full h-40 text-sm border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                      placeholder="Write your answer here…"
                      value={textContent}
                      onChange={e => setTextContent(e.target.value)}
                    />
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Attach files (PDF, DOCX, images)</label>
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-teal-300 transition">
                        <input
                          ref={fileRef}
                          type="file"
                          multiple
                          accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png"
                          onChange={e => setFiles(e.target.files)}
                          className="hidden"
                          id="assignment-file-input"
                        />
                        <label htmlFor="assignment-file-input" className="cursor-pointer">
                          <div className="text-2xl mb-2">📎</div>
                          <p className="text-sm text-slate-600">
                            <span className="text-teal-700 font-medium underline">Browse files</span> or drag & drop
                          </p>
                          <p className="text-xs text-slate-400 mt-1">PDF, DOCX, TXT, JPG, PNG · max 20MB each</p>
                        </label>
                      </div>
                      {files && files.length > 0 && (
                        <div className="space-y-1">
                          {Array.from(files).map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                              <span>📎</span>
                              <span className="truncate flex-1">{f.name}</span>
                              <span className="text-slate-400 shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        className="w-full h-20 text-sm border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                        placeholder="Optional: add a note with your file submission…"
                        value={textContent}
                        onChange={e => setTextContent(e.target.value)}
                      />
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
                  {success && <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition"
                  >
                    {submitting ? 'Submitting…' : 'Submit Assignment →'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
