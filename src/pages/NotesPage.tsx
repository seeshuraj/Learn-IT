import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';
import { Upload, FileText, X, CheckCircle } from 'lucide-react';

interface Message { role: 'user' | 'assistant'; content: string; }
interface UploadedFile { name: string; size: string; type: string; }

interface Props { user: any; }

export default function NotesPage({ user }: Props) {
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const fetchCourses = user.role === 'instructor'
      ? api.getInstructorCourses(user.id)
      : api.getStudentCourses(user.id);
    fetchCourses.then(setCourses).catch(console.error);
  }, [user?.id]);

  useEffect(() => {
    if (!selectedCourse) return;
    api.getCourseModules(selectedCourse.id).then(setModules).catch(console.error);
  }, [selectedCourse?.id]);

  useEffect(() => {
    if (selectedModule) {
      api.getModuleMaterials(selectedModule.id)
        .then((mats: any[]) => setUploadedFiles(mats.map(m => ({ name: m.title, size: m.size || '', type: m.type }))))
        .catch(console.error);
    }
  }, [selectedModule?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedModule) return;
    setUploading(true);
    setUploadSuccess('');
    try {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      const ext = file.name.split('.').pop()?.toLowerCase();
      const type = ext === 'pdf' ? 'pdf' : ext === 'mp4' ? 'video' : 'document';
      await api.uploadMaterial(selectedModule.id, file.name, type, sizeMB);
      setUploadedFiles(prev => [...prev, { name: file.name, size: sizeMB, type }]);
      setUploadSuccess(`"${file.name}" uploaded successfully!`);
      // Use filename content as notes context if it's a text file
      if (ext === 'txt' || ext === 'md') {
        const text = await file.text();
        setNotes(prev => prev ? prev + '\n\n' + text : text);
      }
      setTimeout(() => setUploadSuccess(''), 3000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function sendMessage() {
    if (!input.trim() || chatLoading) return;
    const question = input.trim();
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setChatLoading(true);
    try {
      const res = await api.aiChat(
        question,
        selectedModule?.name ?? 'General',
        notes,
        messages.map(m => ({ role: m.role, content: m.content }))
      );
      setMessages([...newMessages, { role: 'assistant', content: res.answer }]);
    } catch (e: any) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  const fileIcon = (type: string) => {
    if (type === 'pdf') return '📄';
    if (type === 'video') return '🎬';
    return '📝';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Notes & AI Tutor</h1>
        <p className="text-slate-500 text-sm mt-1">Upload course files, write notes, and chat with an AI tutor grounded in your material</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: Notes + Upload ── */}
        <div className="space-y-4">
          {/* Course + Module selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Course</label>
              <select
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                value={selectedCourse?.id ?? ''}
                onChange={e => {
                  const c = courses.find(c => c.id === Number(e.target.value));
                  setSelectedCourse(c ?? null);
                  setSelectedModule(null);
                  setModules([]);
                  setUploadedFiles([]);
                }}
              >
                <option value="">Select course…</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title ?? c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Module</label>
              <select
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white disabled:opacity-50"
                disabled={!modules.length}
                value={selectedModule?.id ?? ''}
                onChange={e => {
                  const m = modules.find(m => m.id === Number(e.target.value));
                  setSelectedModule(m ?? null);
                }}
              >
                <option value="">Select module…</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* File upload */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Upload Notes / Materials</label>
            <div
              onClick={() => selectedModule && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition cursor-pointer ${
                selectedModule
                  ? 'border-teal-300 hover:border-teal-500 hover:bg-teal-50'
                  : 'border-slate-200 opacity-50 cursor-not-allowed'
              }`}
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-teal-600">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-teal-600 border-t-transparent" />
                  <span className="text-sm">Uploading…</span>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                  <p className="text-sm text-slate-500">
                    {selectedModule ? 'Click to upload PDF, DOCX, TXT, MP4' : 'Select a module first'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Max 10 MB</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md,.mp4"
                onChange={handleFileUpload}
                disabled={!selectedModule}
              />
            </div>
            {uploadSuccess && (
              <div className="flex items-center gap-2 mt-2 text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs font-medium">{uploadSuccess}</span>
              </div>
            )}
          </div>

          {/* Uploaded files list */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">Module Materials ({uploadedFiles.length})</p>
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="text-base">{fileIcon(f.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate font-medium">{f.name}</p>
                    <p className="text-xs text-slate-400">{f.size}</p>
                  </div>
                  <FileText className="w-4 h-4 text-slate-300" />
                </div>
              ))}
            </div>
          )}

          {/* Notes textarea */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes Context for AI</label>
            <textarea
              className="w-full h-48 text-sm border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono bg-white"
              placeholder="Paste or type lecture notes here. The AI tutor will use these as context…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">{notes.length} chars · used as AI context</p>
          </div>
        </div>

        {/* ── Right: AI Chat ── */}
        <div className="flex flex-col border border-slate-200 rounded-xl shadow-sm bg-white overflow-hidden" style={{ height: '580px' }}>
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-500" />
            <span className="text-sm font-medium text-slate-700">AI Tutor</span>
            <span className="ml-auto text-xs text-slate-400">NVIDIA · {selectedModule?.name ?? 'No module selected'}</span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 text-sm mt-12">
                <div className="text-4xl mb-3">🤖</div>
                <p className="font-medium">Ask me anything about your module</p>
                <p className="text-xs mt-1">Add notes above for grounded answers</p>
                <div className="mt-4 space-y-2">
                  {['Explain the key concepts', 'Summarise my notes', 'Give me 3 exam tips'].map(s => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="block w-full text-xs text-left px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition text-slate-600"
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                  m.role === 'user' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-800'
                }`}>
                  {m.role === 'assistant'
                    ? <div className="prose prose-sm prose-slate max-w-none"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                    : m.content
                  }
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-xl px-4 py-2.5">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Ask a question about your notes…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                disabled={chatLoading}
              />
              <button
                onClick={sendMessage}
                disabled={chatLoading || !input.trim()}
                className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
