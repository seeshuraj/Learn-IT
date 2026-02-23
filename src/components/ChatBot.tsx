import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User as UserIcon, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { getChatResponse } from "../services/aiService";

interface Message {
  role: "user" | "ai";
  content: string;
}

interface ChatBotProps {
  moduleId: number;
  moduleName: string;
  moduleContent: string;
  onClose?: () => void;
}

export const ChatBot: React.FC<ChatBotProps> = ({ moduleId, moduleName, moduleContent, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", content: `Hi! I'm your LearnIT Assistant for **${moduleName}**. Ask me anything about the notes in this module!` }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const text = await getChatResponse(moduleId, moduleContent, userMessage);
      setMessages(prev => [...prev, { role: "ai", content: text || "Sorry, I encountered an error." }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: "ai", content: "Failed to connect to the AI service." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div className="bg-indigo-600 p-4 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-lg">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Module Tutor</h3>
            <p className="text-[10px] opacity-80 uppercase tracking-wider">AI Powered RAG</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "user" ? "bg-indigo-100 text-indigo-600" : "bg-white text-indigo-600 shadow-sm border border-slate-100"
                }`}>
                  {msg.role === "user" ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`p-3 rounded-2xl text-sm ${
                  msg.role === "user" 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white text-slate-800 shadow-sm border border-slate-100 rounded-tl-none"
                }`}>
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-white text-indigo-600 shadow-sm border border-slate-100 flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-3 bg-white rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about the module notes..."
            className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
