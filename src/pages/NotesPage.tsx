import React, { useState, useRef, useEffect } from "react";
import { User } from "../types";
import {
  MessageSquare, Send, Loader2, Brain,
  FileText, ChevronDown, ChevronUp, Sparkles, Upload
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { askModuleChatbot } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface NotesPageProps { user: User; }

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const MOCK_MODULES = [
  {
    id: "m1",
    title: "Data Structures — Week 3",
    course: "CS301",
    sampleNotes:
      "Binary Trees: A binary tree is a tree data structure where each node has at most two children. " +
      "Types: Full Binary Tree (every node has 0 or 2 children), Complete Binary Tree (all levels filled except last), " +
      "Perfect Binary Tree (all internal nodes have two children, all leaves at same level). " +
      "Tree Traversals: In-order (left, root, right) gives sorted output for BST. " +
      "Pre-order (root, left, right) useful for copying tree. " +
      "Post-order (left, right, root) useful for deletion. " +
      "BST Operations: Search O(log n) average, O(n) worst. Insert/Delete same complexity. " +
      "AVL Trees: Self-balancing BST. Balance factor = height(left) - height(right). Must be -1, 0, or 1. " +
      "Rotations: LL rotation, RR rotation, LR rotation, RL rotation.",
  },
  {
    id: "m2",
    title: "Algorithms — Week 5: Sorting",
    course: "CS302",
    sampleNotes:
      "Sorting Algorithms: " +
      "Merge Sort: O(n log n) all cases, O(n) space. Stable. Divide and conquer. " +
      "Quick Sort: O(n log n) average, O(n^2) worst. O(log n) space. Not stable. Pivot selection matters. " +
      "Heap Sort: O(n log n) always. O(1) space. Not stable. Uses max-heap. " +
      "Counting Sort: O(n+k) time. Only for integers in range. Stable. " +
      "Key insight: Comparison-based sorting has Omega(n log n) lower bound. " +
      "Stability matters when sorting objects with multiple keys.",
  },
  {
    id: "m3",
    title: "Database Systems — Week 7: Indexing",
    course: "CS401",
    sampleNotes:
      "Database Indexing: Indexes speed up SELECT but slow INSERT/UPDATE/DELETE. " +
      "B-Tree Index: Most common. Balanced tree. Good for range queries and equality. " +
      "Hash Index: O(1) lookup. Only for equality. No range queries. " +
      "Clustered Index: Data rows stored in index order. Only one per table. Primary key by default in InnoDB. " +
      "Non-clustered Index: Separate structure with pointer to data. Multiple allowed. " +
      "Composite Index: Index on multiple columns. Order matters — leading column rule. " +
      "Covering Index: Index contains all columns needed — avoids table lookup. " +
      "Index Selectivity: High selectivity = better index candidate.",
  },
];

export const NotesPage: React.FC<NotesPageProps> = ({ user }) => {
  const [selectedModule, setSelectedModule] = useState(MOCK_MODULES[0]);
  const [userNotes, setUserNotes] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentNotes = userNotes[selectedModule.id] ?? selectedModule.sampleNotes;
  const currentMessages = messages[selectedModule.id] ?? [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || isLoading) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: q, timestamp: new Date() };
    setMessages((prev) => ({ ...prev, [selectedModule.id]: [...(prev[selectedModule.id] ?? []), userMsg] }));
    setIsLoading(true);
    try {
      const answer = await askModuleChatbot(q, selectedModule.title, currentNotes);
      const assistantMsg: ChatMessage = { role: "assistant", content: answer, timestamp: new Date() };
      setMessages((prev) => ({ ...prev, [selectedModule.id]: [...(prev[selectedModule.id] ?? []), assistantMsg] }));
    } catch {
      toast.error("AI assistant unavailable. Check your API key.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Toaster position="top-right" />
      <div>
        <h1 className="text-4xl font-bold text-slate-900">Notes & AI Assistant</h1>
        <p className="text-slate-500 mt-1">Write your module notes, then ask the AI anything grounded in them.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        {MOCK_MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => setSelectedModule(mod)}
            className={`px-4 py-2 rounded-2xl text-sm font-bold transition-all border ${
              selectedModule.id === mod.id
                ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/20"
                : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
            }`}
          >
            <span className="text-xs opacity-60 mr-1">{mod.course}</span>
            {mod.title.split("—")[0].trim()}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notes panel */}
        <div className="bg-white rounded-[28px] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
          <div
            className="p-6 border-b border-slate-50 flex items-center justify-between cursor-pointer"
            onClick={() => setNotesExpanded((p) => !p)}
          >
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 p-2 rounded-xl text-indigo-600">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">{selectedModule.title}</h2>
                <p className="text-xs text-slate-400">{selectedModule.course}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">{currentNotes.length} chars</span>
              {notesExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </div>
          <AnimatePresence>
            {notesExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col"
              >
                <textarea
                  value={currentNotes}
                  onChange={(e) => setUserNotes((prev) => ({ ...prev, [selectedModule.id]: e.target.value }))}
                  className="flex-1 p-6 text-sm text-slate-700 leading-relaxed resize-none focus:outline-none min-h-[340px] bg-slate-50/40"
                  placeholder="Paste or type your module notes here..."
                />
                <div className="p-4 border-t border-slate-50">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Upload className="w-3.5 h-3.5" />
                    Edit notes above — the AI uses them to answer your questions
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Chat panel */}
        <div className="bg-white rounded-[28px] border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[520px]">
          <div className="p-6 border-b border-slate-50 flex items-center gap-3">
            <div className="bg-violet-50 p-2 rounded-xl text-violet-600">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">AI Study Assistant</h2>
              <p className="text-xs text-slate-400">Grounded in your {selectedModule.course} notes</p>
            </div>
            <div className="ml-auto flex items-center gap-1 bg-violet-50 px-3 py-1.5 rounded-full">
              <Sparkles className="w-3 h-3 text-violet-500" />
              <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Gemini</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="bg-slate-50 p-4 rounded-2xl mb-3">
                  <MessageSquare className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-600 mb-1">Ask anything about your notes</p>
                <p className="text-xs text-slate-400 max-w-[200px]">
                  Try: "Explain AVL rotations" or "What's the difference between clustered and non-clustered index?"
                </p>
              </div>
            )}
            <AnimatePresence>
              {currentMessages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-sm"
                        : "bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-sm"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <Brain className="w-3 h-3 text-violet-500" />
                        <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wider">AI Assistant</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-[10px] mt-1.5 ${msg.role === "user" ? "text-indigo-200" : "text-slate-400"}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="bg-slate-50 border border-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                  <span className="text-xs text-slate-500">Thinking…</span>
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 border-t border-slate-50">
            <div className="flex gap-2 bg-slate-50 rounded-2xl p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
                placeholder="Ask about your notes… (Enter to send)"
                className="flex-1 bg-transparent text-sm text-slate-700 resize-none focus:outline-none px-2 py-1"
                style={{ maxHeight: 80 }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
