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
  const [selectedModule, setSelectedModule] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const isInstructor = user?.role === 'instructor' || user?.role === 'admin';

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user?.id]);

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
      if (allModules.length > 0) setSelectedModule(prev => prev ?? allModules[0].id);

      const notesRes = await fetch(`${BASE}/api/students/${user.id}/notes`, { credentials: 'include' });
      const notesData = await notesRes.json();
      setNotes(Array.isArray(notesData) ? notesData : []);
    } catch {
      setError('Could not load notes.');
    } finally {
      setLoading(false);
    }
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
        <h1 className="text-2xl font-bold text-slate-800">Course Notes</h1>
        <p className="text-slate-500 text-sm mt-1">
          {isInstructor
            ? 'Use the Upload Notes button on the dashboard to add lecture materials.'
            : 'Lecture notes and materials uploaded by your instructor.'}
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

        {/* Notes list */}
        <div className="lg:col-span-3 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

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
                {!isInstructor && (
                  <p className="text-xs mt-1">Your instructor hasn't uploaded materials for this module yet</p>
                )}
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
                      <a
                        href={`${BASE}/uploads/notes/${note.filename}`}
                        download={note.original_name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-lg transition font-medium"
                        title="Download file"
                      >
                        ↓ Download
                      </a>
                      {isInstructor && (
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this note?')) return;
                            await fetch(`${BASE}/api/notes/${note.id}`, { method: 'DELETE', credentials: 'include' });
                            setNotes(prev => prev.filter(n => n.id !== note.id));
                          }}
                          className="text-slate-300 hover:text-red-500 transition text-lg leading-none"
                          title="Delete note"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ChatBot floats bottom-right, context = currently selected module */}
      <ChatBot
        moduleId={currentModule?.id}
        moduleTitle={currentModule ? `${currentModule.name} · ${currentModule.course_name}` : 'Course Assistant'}
      />
    </div>
  );
}
