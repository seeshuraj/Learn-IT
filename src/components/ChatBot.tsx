import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Loader2, Brain, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { askModuleChatbot } from "../services/aiService";

interface Message { role: "user" | "assistant"; content: string; }
interface ChatBotProps { moduleTitle?: string; notesContext?: string; }

export const ChatBot: React.FC<ChatBotProps> = ({
  moduleTitle = "General Course Assistant",
  notesContext = "",
}) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((p) => [...p, { role: "user", content: q }]);
    setLoading(true);
    try {
      const answer = await askModuleChatbot(q, moduleTitle, notesContext);
      setMessages((p) => [...p, { role: "assistant", content: answer }]);
    } catch {
      setMessages((p) => [...p, { role: "assistant", content: "Sorry, I couldn't reach the AI service." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen((p) => !p)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 flex items-center justify-center hover:bg-indigo-700 transition-colors"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Toggle AI chat assistant"
      >
        {open ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-24 right-6 z-50 w-80 h-[460px] bg-white rounded-[24px] shadow-2xl border border-slate-100 flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-slate-50 bg-indigo-600 flex items-center gap-2">
              <Brain className="w-5 h-5 text-white" />
              <div className="flex-1">
                <p className="text-sm font-bold text-white">AI Study Assistant</p>
                <p className="text-[10px] text-indigo-200 truncate">{moduleTitle}</p>
              </div>
              <div className="flex items-center gap-1 bg-white/20 px-2 py-1 rounded-full">
                <Sparkles className="w-3 h-3 text-white" />
                <span className="text-[9px] font-bold text-white uppercase tracking-wider">Gemini</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="bg-slate-50 p-3 rounded-2xl mb-2">
                    <MessageSquare className="w-7 h-7 text-slate-300" />
                  </div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">Ask me anything</p>
                  <p className="text-[11px] text-slate-400">I'll answer based on your course notes.</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-sm"
                  }`}>{msg.content}</div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 border border-slate-100 px-3 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                    <span className="text-xs text-slate-400">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="p-3 border-t border-slate-50">
              <div className="flex gap-2 bg-slate-50 rounded-2xl p-1.5">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Ask about your notes…"
                  className="flex-1 bg-transparent text-xs text-slate-700 px-2 py-1 focus:outline-none"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-40 flex-shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
