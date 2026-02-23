import React, { useEffect, useState } from "react";
import { User, Submission, Course } from "../types";
import { 
  Users, BookOpen, Clock, CheckCircle2, 
  AlertCircle, TrendingUp, ChevronRight, Brain,
  Search, Filter, BarChart3, Star, Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGradingSuggestion } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface InstructorDashboardProps {
  user: User;
}

export const InstructorDashboard: React.FC<InstructorDashboardProps> = ({ user }) => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'submissions' | 'students' | 'analytics'>('submissions');

  useEffect(() => {
    fetch("/api/instructor/submissions").then(res => res.json()).then(setSubmissions);
    fetch(`/api/instructor/${user.id}/courses`).then(res => res.json()).then(setCourses);
  }, [user.id]);

  const handleAiGrade = async () => {
    if (!selectedSubmission) return;
    setIsAiLoading(true);
    try {
      const suggestion = await getGradingSuggestion(selectedSubmission.content, "Standard Rubric");
      setGrade(suggestion.score);
      setFeedback(suggestion.feedback);
      toast.success("AI Grading Suggestion Generated!");
    } catch (e) {
      toast.error("AI Grading failed. Please try again.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const submitGrade = async () => {
    if (!selectedSubmission) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/submissions/${selectedSubmission.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, feedback }),
      });
      if (response.ok) {
        toast.success("Grade published successfully!");
        setSubmissions(prev => prev.filter(s => s.id !== selectedSubmission.id));
        setSelectedSubmission(null);
      }
    } catch (e) {
      toast.error("Failed to publish grade.");
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
          <p className="text-slate-500 mt-1">Manage your courses, grade submissions, and monitor student progress.</p>
        </div>
        <div className="flex bg-white p-1 rounded-2xl border border-slate-100 shadow-sm">
          <button 
            onClick={() => setActiveTab('submissions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'submissions' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Submissions
          </button>
          <button 
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'students' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Students
          </button>
          <button 
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'analytics' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Analytics
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-indigo-100 p-3 rounded-2xl text-indigo-600">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Pending Grading</p>
              <h3 className="text-2xl font-bold text-slate-900">{submissions.length}</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Action required</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-600">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Average Grade</p>
              <h3 className="text-2xl font-bold text-slate-900">84%</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Across all courses</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-red-100 p-3 rounded-2xl text-red-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">At-Risk Students</p>
              <h3 className="text-2xl font-bold text-slate-900">3</h3>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium">Flagged by AI</p>
        </div>
      </div>

      {activeTab === 'submissions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Grading Queue</h3>
            <div className="space-y-3">
              {submissions.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => {
                    setSelectedSubmission(sub);
                    setGrade(0);
                    setFeedback("");
                  }}
                  className={`w-full text-left p-6 rounded-3xl border transition-all ${selectedSubmission?.id === sub.id ? 'bg-white border-indigo-500 shadow-xl shadow-indigo-600/5 ring-1 ring-indigo-500' : 'bg-white border-slate-100 shadow-sm hover:border-indigo-200'}`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-bold text-xs">
                      {sub.student_name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{sub.course_name}</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1">{sub.student_name}</h4>
                  <p className="text-xs text-slate-500 mb-4">{sub.assignment_title}</p>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                    Grade Now
                  </div>
                </button>
              ))}
              {submissions.length === 0 && (
                <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                  <p className="text-sm text-slate-400">All caught up!</p>
                </div>
              )}
            </div>
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
                  <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900">{selectedSubmission.student_name}</h3>
                      <p className="text-sm text-slate-500">{selectedSubmission.assignment_title}</p>
                    </div>
                    <button 
                      onClick={handleAiGrade}
                      disabled={isAiLoading}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    >
                      {isAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
                      AI Grade Suggestion
                    </button>
                  </div>
                  
                  <div className="p-8 space-y-8">
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Submission Content</h4>
                      <p className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">{selectedSubmission.content}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                      <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Grade (0-100)</label>
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
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Feedback</label>
                        <textarea 
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          rows={4}
                          className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                          placeholder="Provide constructive feedback..."
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
                        onClick={submitGrade}
                        disabled={isSubmitting}
                        className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                          <>
                            Publish Grade <CheckCircle2 className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-12 bg-white rounded-[32px] border border-dashed border-slate-200 text-center min-h-[400px]">
                  <div className="bg-slate-50 p-6 rounded-full mb-4">
                    <Star className="w-12 h-12 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Select a submission to grade</h3>
                  <p className="text-sm text-slate-500 max-w-xs">Choose a student's work from the list on the left to start the grading process.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {activeTab === 'students' && (
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Student Monitoring</h3>
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search students..." 
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Student</th>
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Average</th>
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Missed</th>
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Status</th>
                  <th className="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[
                  { name: "Sarah Johnson", avg: 92, missed: 0, status: "On Track", color: "emerald" },
                  { name: "Michael Chen", avg: 78, missed: 1, status: "Needs Review", color: "amber" },
                  { name: "Alex Rivera", avg: 64, missed: 3, status: "At Risk", color: "red" },
                ].map((student, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 bg-${student.color}-50 text-${student.color}-600 rounded-xl flex items-center justify-center font-bold text-xs`}>
                          {student.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <span className="text-sm font-bold text-slate-900">{student.name}</span>
                      </div>
                    </td>
                    <td className="px-8 py-4 font-bold text-slate-700">{student.avg}%</td>
                    <td className="px-8 py-4 text-slate-500">{student.missed}</td>
                    <td className="px-8 py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${student.color}-100 text-${student.color}-700`}>
                        {student.status}
                      </span>
                    </td>
                    <td className="px-8 py-4 text-right">
                      <button className="text-indigo-600 text-xs font-bold hover:underline">View Profile</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              Grade Distribution
            </h3>
            <div className="h-[300px] w-full bg-slate-50 rounded-2xl flex items-center justify-center">
              <p className="text-slate-400 text-sm">Chart visualization here</p>
            </div>
          </div>
          <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              Topic Performance
            </h3>
            <div className="h-[300px] w-full bg-slate-50 rounded-2xl flex items-center justify-center">
              <p className="text-slate-400 text-sm">Chart visualization here</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
