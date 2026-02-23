import React, { useEffect, useState } from "react";
import { Submission, User } from "../types";
import { 
  CheckCircle2, Clock, Brain, ArrowRight, 
  MessageSquare, Loader2, Star, AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGradingSuggestion } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface InstructorDashboardProps {
  user: User;
}

export const InstructorDashboard: React.FC<InstructorDashboardProps> = ({ user }) => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [grade, setGrade] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/instructor/submissions").then(res => res.json()).then(setSubmissions);
  }, []);

  const handleGetAiSuggestion = async () => {
    if (!selectedSubmission) return;
    setIsAiLoading(true);
    try {
      const data = await getGradingSuggestion(selectedSubmission.assignment_title, selectedSubmission.content);
      setGrade(data.grade);
      setFeedback(data.feedback);
      toast.success("AI Suggestion Applied!");
    } catch (error) {
      toast.error("AI Suggestion failed.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSubmitGrade = async () => {
    if (!selectedSubmission) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/submissions/${selectedSubmission.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, feedback }),
      });
      if (response.ok) {
        toast.success("Grade submitted successfully!");
        setSubmissions(prev => prev.filter(s => s.id !== selectedSubmission.id));
        setSelectedSubmission(null);
      }
    } catch (error) {
      toast.error("Failed to submit grade.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Instructor Dashboard</h1>
          <p className="text-slate-500 mt-1">Manage submissions and provide AI-assisted feedback.</p>
        </div>
        <div className="flex items-center gap-4 bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-100">
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Pending Grading</p>
            <p className="text-xl font-bold text-indigo-600">{submissions.length} Submissions</p>
          </div>
          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Grading Queue</h2>
          {submissions.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 border border-slate-100 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-100 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">All caught up!</p>
            </div>
          ) : submissions.map(sub => (
            <button 
              key={sub.id}
              onClick={() => {
                setSelectedSubmission(sub);
                setGrade(0);
                setFeedback("");
              }}
              className={`w-full text-left p-6 rounded-3xl border transition-all ${
                selectedSubmission?.id === sub.id 
                  ? "bg-white border-indigo-500 shadow-xl shadow-indigo-600/5 ring-1 ring-indigo-500" 
                  : "bg-white border-slate-100 shadow-sm hover:border-indigo-200"
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-bold text-xs">
                  {sub.student_name.split(" ").map((n: string) => n[0]).join("")}
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{sub.course_name}</span>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">{sub.student_name}</h3>
              <p className="text-xs text-slate-500 mb-4">{sub.assignment_title}</p>
              <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                <ArrowRight className="w-3 h-3" /> Grade Now
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            {selectedSubmission ? (
              <motion.div 
                key={selectedSubmission.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden"
              >
                <div className="p-8 border-b border-slate-50 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{selectedSubmission.student_name}</h2>
                      <p className="text-sm text-slate-500">{selectedSubmission.assignment_title}</p>
                    </div>
                    <button 
                      onClick={handleGetAiSuggestion}
                      disabled={isAiLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                      {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                      Get AI Suggestion
                    </button>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <section>
                    <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Student Submission</h3>
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                      {selectedSubmission.content}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="md:col-span-1">
                      <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Grade</h3>
                      <div className="relative">
                        <input 
                          type="number" 
                          value={grade}
                          onChange={(e) => setGrade(Number(e.target.value))}
                          className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-2xl font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 text-center"
                          min="0"
                          max="100"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">/100</span>
                      </div>
                    </div>
                    <div className="md:col-span-3">
                      <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Feedback</h3>
                      <textarea 
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="Provide constructive feedback..."
                        className="w-full h-32 p-4 bg-white border border-slate-200 rounded-2xl text-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-4">
                    <button 
                      onClick={() => setSelectedSubmission(null)}
                      className="px-8 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      Skip for Now
                    </button>
                    <button 
                      onClick={handleSubmitGrade}
                      disabled={isSubmitting}
                      className="px-10 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                        <>
                          Confirm Grade <CheckCircle2 className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white rounded-[32px] border border-slate-100 border-dashed">
                <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-6">
                  <Star className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Select a Submission</h3>
                <p className="text-slate-500 max-w-xs">Choose a student submission from the queue to start grading with AI assistance.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
