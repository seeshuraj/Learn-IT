import React, { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { streamModuleChatbot, ConversationTurn } from "../services/aiService";
import { MarkdownMessage } from "./MarkdownMessage";

interface Props {
  moduleTitle?: string;
  /** The module's numeric DB id — required for server-side RAG retrieval. */
  moduleId?: number | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const WELCOME =
  "Hi! I'm your course tutor. I answer from this module's notes and tell you which note I used. " +
  "For students, I also look at your recent exam topics and graded feedback, so I can focus on what you need. " +
  "I can make mistakes, so check key points against your notes.";

const SUGGESTIONS = [
  "What should I revise for this module?",
  "Explain the topic I lost the most marks on",
  "Summarise the key points of these notes",
];

export const ChatBot: React.FC<Props> = ({
  moduleTitle = "General Course Assistant",
  moduleId = null,
}) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME },
  ]);
  const [loading, setLoading] = useState(false);
  // Set once the server confirms the student's own record informed an answer.
  const [personalized, setPersonalized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-flight answer; aborted when the window closes or the component unmounts.
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);
  useEffect(() => { if (!open) inflight.current?.abort(); }, [open]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, messages]);

  const send = async (preset?: string) => {
    const q = (preset ?? input).trim();
    if (!q || loading) return;
    setInput("");
    // The API accepts at most 20 prior turns of up to 4000 chars each;
    // recent context is what matters and it bounds token cost.
    const history: ConversationTurn[] = messages
      .filter((m) => m.content !== WELCOME && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    // The assistant bubble is appended up front and filled as tokens arrive.
    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    const setAnswer = (content: string) =>
      setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content }]);

    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      await streamModuleChatbot(q, moduleTitle, moduleId, history, setAnswer, controller.signal,
        (meta) => { if (meta.personalized) setPersonalized(true); });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setMessages((prev) => (prev.at(-1)?.content ? prev : prev.slice(0, -1)));
      } else {
        setAnswer(e?.message || "The AI assistant is temporarily unavailable. Please try again in a minute.");
      }
    } finally {
      if (inflight.current === controller) inflight.current = null;
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 w-14 h-14 bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
          aria-label="Open AI Chat"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 h-[min(520px,calc(100dvh-1.5rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col z-50 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-white/80" />
              <div>
                <p className="text-sm font-semibold text-white leading-tight">
                  AI Course Assistant
                </p>
                <p className="text-xs text-white/60 leading-tight flex items-center gap-1">
                  <BookOpen className="w-3 h-3" />
                  {moduleTitle}
                </p>
                {personalized && (
                  <p className="text-[11px] text-white/80 leading-tight mt-0.5">Using your marks and feedback</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.filter((m) => m.content).map((m, i) => (
              <div
                key={i}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                    m.role === "user"
                      ? "bg-violet-600 text-white rounded-br-md whitespace-pre-wrap"
                      : "bg-slate-100 text-slate-800 rounded-bl-md"
                  }`}
                >
                  {m.role === "assistant" ? <MarkdownMessage text={m.content} /> : m.content}
                </div>
              </div>
            ))}
            {messages.length === 1 && moduleId != null && (
              <div className="flex flex-col items-start gap-1.5 pt-1">
                {SUGGESTIONS.map((sgt) => (
                  <button
                    key={sgt}
                    type="button"
                    onClick={() => send(sgt)}
                    className="text-left text-xs px-3 py-1.5 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-50 transition-colors"
                  >
                    {sgt}
                  </button>
                ))}
              </div>
            )}
            {loading && !messages.at(-1)?.content && (
              <div className="flex justify-start">
                <div className="bg-slate-100 px-3 py-2.5 rounded-2xl rounded-bl-md flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-slate-100 flex gap-2 items-center">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask about your course material…"
              disabled={loading}
              className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200 disabled:opacity-50 placeholder:text-slate-400"
            />
            <button
              onClick={() => send()}
              aria-label="Send"
              disabled={!input.trim() || loading}
              className="w-9 h-9 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 text-white rounded-xl flex items-center justify-center transition-colors shrink-0"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
