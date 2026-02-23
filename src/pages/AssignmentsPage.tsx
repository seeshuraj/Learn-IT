import React, { useEffect, useState } from "react";
import { Assignment, User, Submission } from "../types";
import { 
  FileText, Clock, CheckCircle2, AlertCircle, 
  ArrowRight, Brain, Loader2, Send, ChevronDown, BookOpen, Plus
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGradingSuggestion } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface AssignmentsPageProps {
  user: User;
}

export const AssignmentsPage: React.FC<AssignmentsPageProps> = ({ user }) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [submissionText, setSubmissionText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ grade: number; feedback: string } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAddingAssignment, setIsAddingAssignment] = useState(false);

  useEffect(() => {
    const endpoint = user.role === 'student' ? `/api/student/${user.id}/assignments` : '/api/assignments';
    fetch(endpoint).then(res => res.json()).then(setAssignments);
  }, [user.id, user.role]);

  const handleCreateAssignment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const moduleId = Number(formData.get("module_id"));
    const newAssignment = {
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      due_date: formData.get("due_date") as string,
    };

    try {
      const response = await fetch(`/api/modules/${moduleId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAssignment),
      });
      if (response.ok) {
        toast.success("Assignment created!");
        setIsAddingAssignment(false);
        // Refresh
        const endpoint = user.role === 'student' ? `/api/student/${user.id}/assignments` : '/api/assignments';
        fetch(endpoint).then(res => res.json()).then(setAssignments);
      }
    } catch (e) {
      toast.error("Failed to create assignment");
    }
  };

  const handleGetAiSuggestion = async () => {
    if (!submissionText.trim()) return;
    setIsAiLoading(true);
    try {
      const data = await getGradingSuggestion(selectedAssignment?.title || "Assignment", submissionText);
      setAiSuggestion(data);
      toast.success("AI Grading Suggestion Generated!");
    } catch (error) {
      toast.error("Failed to generate AI suggestion.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: selectedAssignment?.id,
          student_id: user.id,
          content: submissionText
        })
      });
      if (response.ok) {
        toast.success("Assignment submitted successfully!");
        setSelectedAssignment(null);
        setSubmissionText("");
        setAiSuggestion(null);
      }
    } catch (error) {
      toast.error("Submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Assignments</h1>
          <p className="text-slate-500 mt-1">Track your progress and submit your work.</p>
        </div>
        <div className="flex items-center gap-3">
          {user.role === 'instructor' && (
            <button 
              onClick={() => setIsAddingAssignment(true)}
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-5 h-5" /> Create Assignment
            </button>
          )}
          <div className="flex bg-white p-1 rounded-2xl border border-slate-200">
            <button className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/20">Active</button>
            <button className="px-4 py-2 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-50">Completed</button>
          </div>
        </div>
      </div>

      {isAddingAssignment && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-8 border-b border-slate-50 bg-slate-50/50">
              <h2 className="text-2xl font-bold text-slate-900">Create Assignment</h2>
              <p className="text-sm text-slate-500">Assign a new task to your students.</p>
            </div>
            <form onSubmit={handleCreateAssignment} className="p-8 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Module ID</label>
                <input name="module_id" type="number" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="e.g. 1" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Title</label>
                <input name="title" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="Assignment Title" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Description</label>
                <textarea name="description" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 h-24 resize-none" placeholder="Instructions..." />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Due Date</label>
                <input name="due_date" type="date" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsAddingAssignment(false)} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">Create</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          {assignments.map(assignment => (
            <button 
              key={assignment.id}
              onClick={() => setSelectedAssignment(assignment)}
              className={`w-full text-left p-6 rounded-3xl border transition-all ${
                selectedAssignment?.id === assignment.id 
                  ? "bg-white border-indigo-500 shadow-xl shadow-indigo-600/5 ring-1 ring-indigo-500" 
                  : "bg-white border-slate-100 shadow-sm hover:border-indigo-200"
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-2xl ${
                  assignment.status === "graded" ? "bg-emerald-50 text-emerald-600" :
                  assignment.status === "overdue" ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600"
                }`}>
                  <FileText className="w-6 h-6" />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${
                  assignment.status === "graded" ? "bg-emerald-100 text-emerald-700" :
                  assignment.status === "overdue" ? "bg-red-100 text-red-700" : "bg-indigo-100 text-indigo-700"
                }`}>
                  {assignment.status}
                </span>
              </div>
              <h3 className="font-bold text-slate-900 mb-1">{assignment.title}</h3>
              <p className="text-xs text-slate-500 mb-4">{assignment.course_name}</p>
              <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Due {assignment.due_date}
                </div>
                {assignment.status === "graded" && (
                  <div className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" />
                    Graded
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            {selectedAssignment ? (
              <motion.div 
                key={selectedAssignment.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden"
              >
                <div className="p-8 border-b border-slate-50">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold text-slate-900">{selectedAssignment.title}</h2>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Points</p>
                      <p className="text-lg font-bold text-slate-900">100</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600">
                      <Clock className="w-3 h-3" /> Due {selectedAssignment.due_date}
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-600">
                      <BookOpen className="w-3 h-3" /> {selectedAssignment.course_name}
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  <section>
                    <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Instructions</h3>
                    <p className="text-slate-600 leading-relaxed">
                      Please provide a detailed report on the topic of {selectedAssignment.title}. Your submission should include a clear introduction, methodology, results, and conclusion. Ensure all citations are properly formatted.
                    </p>
                  </section>

                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Your Submission</h3>
                      {user.role === "instructor" && (
                        <button 
                          onClick={handleGetAiSuggestion}
                          disabled={!submissionText.trim() || isAiLoading}
                          className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                        >
                          {isAiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                          Get AI Grading Suggestion
                        </button>
                      )}
                    </div>
                    <textarea 
                      value={submissionText}
                      onChange={(e) => setSubmissionText(e.target.value)}
                      placeholder="Type your submission here or paste your report..."
                      className="w-full h-64 p-6 bg-slate-50 border border-slate-100 rounded-[24px] text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                    />
                  </section>

                  {aiSuggestion && (
                    <motion.section 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-indigo-50 rounded-3xl p-6 border border-indigo-100"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="bg-indigo-600 p-2 rounded-lg text-white">
                          <Brain className="w-4 h-4" />
                        </div>
                        <h4 className="font-bold text-indigo-900">AI Grading Suggestion</h4>
                      </div>
                      <div className="flex items-start gap-6">
                        <div className="text-center">
                          <p className="text-[10px] text-indigo-400 uppercase font-bold tracking-widest mb-1">Suggested Grade</p>
                          <p className="text-3xl font-bold text-indigo-600">{aiSuggestion.grade}/100</p>
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] text-indigo-400 uppercase font-bold tracking-widest mb-1">Feedback Summary</p>
                          <p className="text-sm text-indigo-800 leading-relaxed">{aiSuggestion.feedback}</p>
                        </div>
                      </div>
                    </motion.section>
                  )}

                  <div className="flex justify-end gap-4">
                    <button 
                      onClick={() => setSelectedAssignment(null)}
                      className="px-8 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSubmit}
                      disabled={!submissionText.trim() || isSubmitting}
                      className="px-10 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                        <>
                          Submit Assignment <Send className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white rounded-[32px] border border-slate-100 border-dashed">
                <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-6">
                  <FileText className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Select an Assignment</h3>
                <p className="text-slate-500 max-w-xs">Choose an assignment from the list to view details and submit your work.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
