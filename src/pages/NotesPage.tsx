import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';

interface Message { role: 'user' | 'assistant'; content: string; }

export default function NotesPage() {
  const userRaw = localStorage.getItem('learnit_user');
  const user = userRaw ? JSON.parse(userRaw) : null;

  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    api.getStudentCourses(user.id).then(setCourses).catch(console.error);
  }, [user?.id]);

  useEffect(() => {
    if (!selectedCourse) return;
    api.getCourseModules(selectedCourse.id).then(setModules).catch(console.error);
  }, [selectedCourse?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Notes & AI Tutor</h1>
        <p className="text-slate-500 text-sm mt-1">Write notes and chat with an AI tutor grounded in your course material</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Notes */}
        <div className="space-y-4">
          {/* Course + Module selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Course</label>
              <select
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={selectedCourse?.id ?? ''}
                onChange={e => {
                  const c = courses.find(c => c.id === Number(e.target.value));
                  setSelectedCourse(c ?? null);
                  setSelectedModule(null);
                  setModules([]);
                }}
              >
                <option value="">Select course…</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Module</label>
              <select
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
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

          {/* Notes textarea */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Your Notes</label>
            <textarea
              className="w-full h-72 text-sm border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none font-mono"
              placeholder="Paste or write your lecture notes here. The AI tutor will use these as context for answering your questions…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">{notes.length} chars · AI will use these as context</p>
          </div>
        </div>

        {/* Right: Chat */}
        <div className="flex flex-col border border-slate-200 rounded-xl shadow-sm bg-white overflow-hidden" style={{ height: '460px' }}>
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-500" />
            <span className="text-sm font-medium text-slate-700">AI Tutor</span>
            <span className="ml-auto text-xs text-slate-400">NVIDIA · {selectedModule?.name ?? 'No module selected'}</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 text-sm mt-8">
                <div className="text-3xl mb-2">💬</div>
                <p>Ask anything about your module or notes.</p>
                <p className="text-xs mt-1">The AI will answer based on your notes context.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                  m.role === 'user'
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 text-slate-800'
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

          {/* Input */}
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
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
