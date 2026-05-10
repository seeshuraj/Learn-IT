import { useEffect, useState } from 'react';
import { ChatBot } from '../components/ChatBot';

interface Note {
  id: number;
  original_name: string;
  filename: string;
  file_type: string;
  uploaded_at: string;
  module_name: string;
  course_name: string;
  chunk_count: number;
  module_id: number;
  cloudinary_url?: string;
}

interface Module {
  id: number;
  name: string;
  course_name: string;
}

interface Props { user: any; }

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

const FILE_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'text/plain': '📃',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
};

export default function NotesPage({ user }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const isInstructor = user?.role === 'instructor' || user?.role === 'admin';

  useEffect(() => { if (user) loadData(); }, [user?.id]);

  async function loadData() {
    setLoading(true);
    try {
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

      const notesRes = await fetch(`${BASE}/api/students/${user.id}/notes`, { credentials: 'include' });
      const notesData = await notesRes.json();
      const fetchedNotes: Note[] = Array.isArray(notesData) ? notesData : [];
      setNotes(fetchedNotes);

      // Auto-select first module that has notes
      if (fetchedNotes.length > 0) {
        setSelectedModuleId(prev => prev ?? fetchedNotes[0].module_id);
      } else if (allModules.length > 0) {
        setSelectedModuleId(prev => prev ?? allModules[0].id);
      }
    } catch {
      setError('Could not load notes.');
    } finally {
      setLoading(false);
    }
  }

  // Sidebar: enrolled modules + any orphan note modules
  const sidebarModules: Module[] = [
    ...modules,
    ...notes
      .filter(n => !modules.find(m => m.id === n.module_id))
      .map(n => ({ id: n.module_id, name: n.module_name, course_name: n.course_name }))
      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i),
  ];

  const filteredNotes = selectedModuleId
    ? notes.filter(n => n.module_id === selectedModuleId)
    : notes;

  const currentModule = sidebarModules.find(m => m.id === selectedModuleId);

  // AI chat priority: activeNote module > selected module (if has notes) > first module with notes
  const chatModuleId: number | undefined =
    activeNote?.module_id ??
    (filteredNotes.length > 0 ? (selectedModuleId ?? undefined) : undefined) ??
    (notes.length > 0 ? notes[0].module_id : undefined);

  const chatModuleTitle = activeNote
    ? `${activeNote.module_name} · ${activeNote.course_name}`
    : currentModule
      ? `${currentModule.name} · ${currentModule.course_name}`
      : 'Course Assistant';

  // Backend proxy URL — bypasses Cloudinary CORS/content-disposition for iframe rendering
  function getProxyUrl(note: Note): string {
    return `${BASE}/api/notes/${note.id}/proxy`;
  }

  function getDownloadUrl(note: Note): string {
    return note.cloudinary_url || `${BASE}/uploads/notes/${note.filename}`;
  }

  function canPreview(note: Note): boolean {
    return note.file_type === 'application/pdf' || note.file_type === 'text/plain';
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Course Notes</h1>
        <p className="text-slate-500 text-sm mt-1">
          {isInstructor
            ? 'Use the Upload Notes button on the dashboard to add lecture materials.'
            : 'Lecture notes and materials uploaded by your instructor.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Module sidebar */}
        <div className="lg:col-span-1 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Modules</p>
          {sidebarModules.length === 0 && (
            <p className="text-xs text-slate-400">No modules found.</p>
          )}
          {sidebarModules.map(m => (
            <button
              key={m.id}
              onClick={() => { setSelectedModuleId(m.id); setActiveNote(null); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${
                selectedModuleId === m.id
                  ? 'bg-teal-700 text-white font-semibold'
                  : 'bg-white border border-slate-200 text-slate-700 hover:border-teal-300'
              }`}
            >
              <p className="truncate font-medium">{m.name}</p>
              <p className={`text-xs mt-0.5 truncate ${
                selectedModuleId === m.id ? 'text-teal-200' : 'text-slate-400'
              }`}>{m.course_name}</p>
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="lg:col-span-3 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* PDF / text viewer — uses backend proxy */}
          {activeNote && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-slate-700 truncate">{activeNote.original_name}</span>
                  {activeNote.cloudinary_url && <span className="text-xs text-teal-500 shrink-0">☁ Cloud</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={getProxyUrl(activeNote)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1 bg-white hover:bg-teal-50 text-slate-600 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-lg transition font-medium"
                  >
                    ↗ Open
                  </a>
                  <a
                    href={getDownloadUrl(activeNote)}
                    download={activeNote.original_name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1 bg-white hover:bg-teal-50 text-slate-600 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-lg transition font-medium"
                  >
                    ↓ Download
                  </a>
                  <button
                    onClick={() => setActiveNote(null)}
                    className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1"
                  >✕</button>
                </div>
              </div>
              <iframe
                key={activeNote.id}
                src={getProxyUrl(activeNote)}
                className="w-full border-0"
                style={{ height: '72vh' }}
                title={activeNote.original_name}
                allow="fullscreen"
              />
            </div>
          )}

          {/* Notes list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                {currentModule ? `Notes for ${currentModule.name}` : 'All Notes'}
                <span className="ml-2 text-xs font-normal text-slate-400">({filteredNotes.length})</span>
              </p>
              {chatModuleId && (
                <span className="text-xs text-indigo-500 font-medium">
                  🧠 AI → module #{chatModuleId}
                </span>
              )}
            </div>

            {filteredNotes.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-xl text-slate-400">
                <p className="text-2xl mb-2">📂</p>
                <p className="text-sm">No notes uploaded for this module yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotes.map(note => (
                  <div
                    key={note.id}
                    className={`bg-white border rounded-xl px-4 py-3 flex items-center justify-between gap-4 transition ${
                      activeNote?.id === note.id
                        ? 'border-indigo-300 ring-1 ring-indigo-200'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl shrink-0">{FILE_ICONS[note.file_type] ?? '📄'}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{note.original_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {note.chunk_count > 0 ? `${note.chunk_count} chunks · ` : 'Processing · '}
                          {new Date(note.uploaded_at).toLocaleDateString('en-IE', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                          {note.cloudinary_url && <span className="ml-1 text-teal-500">☁</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {note.chunk_count > 0 && (
                        <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                          ✓ AI Ready
                        </span>
                      )}
                      {canPreview(note) && (
                        <button
                          onClick={() => setActiveNote(activeNote?.id === note.id ? null : note)}
                          className={`text-xs px-3 py-1.5 border rounded-lg transition font-medium ${
                            activeNote?.id === note.id
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          {activeNote?.id === note.id ? '✕ Close' : '👁 Preview & Chat'}
                        </button>
                      )}
                      <a
                        href={getDownloadUrl(note)}
                        download={note.original_name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-lg transition font-medium"
                      >
                        ↓ Download
                      </a>
                      {isInstructor && (
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this note?')) return;
                            await fetch(`${BASE}/api/notes/${note.id}`, { method: 'DELETE', credentials: 'include' });
                            setNotes(prev => prev.filter(n => n.id !== note.id));
                            if (activeNote?.id === note.id) setActiveNote(null);
                          }}
                          className="text-slate-300 hover:text-red-500 transition text-lg leading-none"
                        >×</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ChatBot moduleId={chatModuleId} moduleTitle={chatModuleTitle} />
    </div>
  );
}
