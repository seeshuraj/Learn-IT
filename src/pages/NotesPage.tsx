import { useEffect, useState, useRef } from 'react';

interface Note {
  id: number;
  original_name: string;
  file_type: string;
  uploaded_at: string;
  module_name: string;
  course_name: string;
  chunk_count: number;
  module_id: number;
}

interface Module {
  id: number;
  name: string;
  course_name: string;
}

interface Props { user: any; }

// Use relative paths so Vite proxy (dev) and VITE_API_BASE_URL (prod) both work
const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

const FILE_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'text/plain': '📃',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
};

const ACCEPT = '.pdf,.docx,.doc,.txt,.jpg,.jpeg,.png';

export default function NotesPage({ user }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedModule, setSelectedModule] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user?.id]);

  async function loadData() {
    setLoading(true);
    try {
      const notesRes = await fetch(`${BASE}/api/students/${user.id}/notes`, { credentials: 'include' });
      const notesData = await notesRes.json();
      setNotes(Array.isArray(notesData) ? notesData : []);

      const coursesRes = await fetch(`${BASE}/api/student/${user.id}/courses`, { credentials: 'include' });
      const courses = await coursesRes.json();
      const allModules: Module[] = [];
      for (const course of (Array.isArray(courses) ? courses : [])) {
        const modRes = await fetch(`${BASE}/api/courses/${course.id}/modules`, { credentials: 'include' });
        const mods = await modRes.json();
        (Array.isArray(mods) ? mods : []).forEach((m: any) =>
          allModules.push({ id: m.id, name: m.name, course_name: course.name })
        );
      }
      setModules(allModules);
      if (allModules.length > 0 && !selectedModule) setSelectedModule(allModules[0].id);
    } catch (e) {
      setError('Could not load notes.');
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedModule) return setError('Select a module first.');
    if (!file) return;

    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|docx|doc|txt|jpg|jpeg|png)$/i)) {
      return setError('Unsupported file type. Use PDF, DOCX, TXT, or image files.');
    }
    if (file.size > 20 * 1024 * 1024) return setError('File too large (max 20MB).');

    setUploading(true);
    setError('');
    setUploadProgress('Uploading…');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('student_id', String(user.id));

    try {
      setUploadProgress('Extracting text & embedding…');
      const res = await fetch(`${BASE}/api/modules/${selectedModule}/notes`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
      const data = await res.json();
      setUploadProgress(`Done — ${data.chunk_count} chunks embedded ✓`);
      await loadData();
      setTimeout(() => setUploadProgress(''), 3000);
    } catch (e: any) {
      setError(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function deleteNote(id: number) {
    if (!confirm('Delete this note? Its embeddings will also be removed.')) return;
    await fetch(`${BASE}/api/notes/${id}`, { method: 'DELETE', credentials: 'include' });
    setNotes(prev => prev.filter(n => n.id !== id));
  }

  const filteredNotes = selectedModule
    ? notes.filter(n => n.module_id === selectedModule)
    : notes;

  const currentModule = modules.find(m => m.id === selectedModule);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">My Notes</h1>
        <p className="text-slate-500 text-sm mt-1">
          Upload PDFs, DOCX, or text files — they&apos;re chunked, embedded, and fed to your module chatbot.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Module selector */}
        <div className="lg:col-span-1 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Modules</p>
          {modules.length === 0 && (
            <p className="text-xs text-slate-400">No modules found. Enrol in a course first.</p>
          )}
          {modules.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedModule(m.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${
                selectedModule === m.id
                  ? 'bg-teal-700 text-white font-semibold'
                  : 'bg-white border border-slate-200 text-slate-700 hover:border-teal-300'
              }`}
            >
              <p className="truncate font-medium">{m.name}</p>
              <p className={`text-xs mt-0.5 truncate ${selectedModule === m.id ? 'text-teal-200' : 'text-slate-400'}`}>
                {m.course_name}
              </p>
            </button>
          ))}
        </div>

        {/* Upload + notes list */}
        <div className="lg:col-span-3 space-y-5">
          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) uploadFile(file);
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition ${
              dragOver ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white hover:border-teal-300'
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
                <p className="text-sm text-teal-700 font-medium">{uploadProgress}</p>
              </div>
            ) : (
              <>
                <div className="text-3xl mb-3">📎</div>
                <p className="text-sm text-slate-600 font-medium mb-1">
                  Drag & drop or{' '}
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-teal-700 underline hover:no-underline"
                    disabled={!selectedModule}
                  >
                    browse files
                  </button>
                </p>
                <p className="text-xs text-slate-400">PDF, DOCX, TXT, JPG, PNG · max 20 MB</p>
                {!selectedModule && (
                  <p className="text-xs text-amber-600 mt-2">← Select a module first</p>
                )}
                {uploadProgress && (
                  <p className="text-xs text-teal-600 mt-2 font-medium">{uploadProgress}</p>
                )}
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* Notes list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                {currentModule ? `Notes for ${currentModule.name}` : 'All Notes'}
                <span className="ml-2 text-xs font-normal text-slate-400">({filteredNotes.length})</span>
              </p>
            </div>

            {filteredNotes.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-xl text-slate-400">
                <p className="text-2xl mb-2">📂</p>
                <p className="text-sm">No notes uploaded for this module yet</p>
                <p className="text-xs mt-1">Upload lecture PDFs or notes above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotes.map(note => (
                  <div
                    key={note.id}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4 hover:border-slate-300 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl shrink-0">
                        {FILE_ICONS[note.file_type] ?? '📄'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{note.original_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {note.chunk_count > 0
                            ? `${note.chunk_count} chunks embedded · `
                            : 'Processing · '}
                          {new Date(note.uploaded_at).toLocaleDateString('en-IE', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {note.chunk_count > 0 && (
                        <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                          ✓ Embedded
                        </span>
                      )}
                      <button
                        onClick={() => deleteNote(note.id)}
                        className="text-slate-300 hover:text-red-500 transition text-lg leading-none"
                        title="Delete note"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
