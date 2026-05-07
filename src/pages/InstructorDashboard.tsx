import React, { useEffect, useState } from "react";
import { User, Submission, Course } from "../types";
import {
  Users, BookOpen, Clock, CheckCircle2,
  AlertCircle, TrendingUp, Brain,
  Search, BarChart3, Star, Loader2, Sparkles,
  ThumbsUp, ThumbsDown, RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGradingSuggestion, GradingSuggestion, getClassOverviewSummary, ClassOverviewData } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface InstructorDashboardProps { user: User; }

const CLASS_DATA: ClassOverviewData = {
  courseName: "Computer Science — All Courses",
  classAverage: 78,
  students: [
    { name: "Sarah Johnson", average: 92, missed: 0, status: "On Track" },
    { name: "Michael Chen", average: 78, missed: 1, status: "Needs Review" },
    { name: "Alex Rivera", average: 64, missed: 3, status: "At Risk" },
  ],
};

// Render **bold** markdown inline
function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-bold text-green-900">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export const InstructorDashboard: React.FC<InstructorDashboardProps> = ({ user }) => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<GradingSuggestion | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"submissions" | "students" | "analytics">("submissions");
  const [classSummary, setClassSummary] = useState("");
  const [classSummaryLoading, setClassSummaryLoading] = useState(false);

  useEffect(() => {
    fetch("/api/instructor/submissions").then(res => res.json()).then(setSubmissions).catch(() => {});
    fetch(`/api/instructor/${user.id}/courses`).then(res => res.json()).then(setCourses).catch(() => {});
  }, [user.id]);

  const handleAiGrade = async () => {
    if (!selectedSubmission) return;
    setIsAiLoading(true);
    setAiSuggestion(null);
    try {
      const rubric = "Assess understanding of core concepts, clarity of explanation, use of examples, and conclusion quality.";
      const suggestion = await getGradingSuggestion(selectedSubmission.content, rubric);
      setAiSuggestion(suggestion);
      toast.success("AI grading suggestion ready!");
    } catch {
      toast.error("AI grading failed. Please try again.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAcceptAiGrade = () => {
    if (!aiSuggestion) return;
    setGrade(aiSuggestion.score);
    setFeedback(aiSuggestion.feedback);
    toast.success("AI grade accepted — edit if needed, then publish.");
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
        setAiSuggestion(null);
      }
    } catch {
      toast.error("Failed to publish grade.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchClassSummary = async () => {
    setClassSummaryLoading(true);
    setClassSummary("");
    try {
      const summary = await getClassOverviewSummary(CLASS_DATA);
      setClassSummary(summary);
    } catch {
      toast.error("Could not generate class summary.");
    } finally {
      setClassSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "analytics" && !classSummary) fetchClassSummary();
  }, [activeTab]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Instructor Dashboard</h1>
          <p className="text-slate-500 mt-1">Manage your courses, grade submissions, and monitor student progress.</p>
        </div>
        <div className="flex bg-white p-1 rounded-2xl border border-slate-100 shadow-sm">
          {(["submissions", "students", "analytics"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize ${
                activeTab === tab ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Pending Grading", value: submissions.length, sub: "Action required", icon: Clock, color: "indigo" },
          { label: "Average Grade", value: "84%", sub: "Across all courses", icon: CheckCircle2, color: "emerald" },
          { label: "At-Risk Students", value: 3, sub: "Flagged by AI", icon: AlertCircle, color: "red" },
        ].map((kpi, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-4 mb-4">
              <div className={`bg-${kpi.color}-100 p-3 rounded-2xl text-${kpi.color}-600`}>
                <kpi.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{kpi.label}</p>
                <h3 className="text-2xl font-bold text-slate-900">{kpi.value}</h3>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-medium">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Submissions Tab */}
      {activeTab === "submissions" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Grading Queue</h3>
            <div className="space-y-3">
              {submissions.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => { setSelectedSubmission(sub); setGrade(0); setFeedback(""); setAiSuggestion(null); }}
                  className={`w-full text-left p-6 rounded-3xl border transition-all ${
                    selectedSubmission?.id === sub.id
                      ? "bg-white border-indigo-500 shadow-xl shadow-indigo-600/5 ring-1 ring-indigo-500"
                      : "bg-white border-slate-100 shadow-sm hover:border-indigo-200"
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-bold text-xs">
                      {sub.student_name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{sub.course_name}</span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1">{sub.student_name}</h4>
                  <p className="text-xs text-slate-500 mb-4">{sub.assignment_title}</p>
                  <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Grade Now →</div>
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
                      className="px-5 py-2.5 bg-green-700 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-green-800 transition-all shadow-lg shadow-green-700/20 disabled:opacity-50"
                    >
                      {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                      AI Grade
                    </button>
                  </div>

                  <div className="p-8 space-y-6">
                    {/* Submission content */}
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Submission</h4>
                      <p className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">{selectedSubmission.content}</p>
                    </div>

                    {/* AI Suggestion Panel */}
                    <AnimatePresence>
                      {aiSuggestion && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 overflow-hidden"
                        >
                          <div className="p-5 border-b border-green-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="bg-green-700 p-1.5 rounded-lg">
                                <Brain className="w-3.5 h-3.5 text-white" />
                              </div>
                              <span className="text-sm font-bold text-green-900">AI Grading Suggestion</span>
                              <div className="flex items-center gap-1 bg-white/60 px-2 py-0.5 rounded-full border border-green-100">
                                <Sparkles className="w-3 h-3 text-green-600" />
                                <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">NVIDIA NIM</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={handleAcceptAiGrade}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white rounded-xl text-xs font-bold hover:bg-green-800 transition-all"
                              >
                                <ThumbsUp className="w-3 h-3" /> Accept
                              </button>
                              <button
                                onClick={handleAiGrade}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-green-700 border border-green-200 rounded-xl text-xs font-bold hover:bg-green-50 transition-all"
                              >
                                <RefreshCw className="w-3 h-3" /> Re-run
                              </button>
                            </div>
                          </div>
                          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
                            <div className="text-center">
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-1">Score</p>
                              <p className="text-4xl font-bold text-green-800 tabular-nums">{aiSuggestion.score}</p>
                              <p className="text-xs text-green-600">/100</p>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-1">Feedback</p>
                              <p className="text-sm text-green-900 leading-relaxed">{aiSuggestion.feedback}</p>
                            </div>
                          </div>
                          <div className="px-5 pb-5 grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-2">Strengths</p>
                              <ul className="space-y-1">
                                {aiSuggestion.strengths.map((s, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-green-800">
                                    <span className="text-emerald-500 mt-0.5">✓</span> {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[10px] text-green-600 uppercase font-bold tracking-widest mb-2">Improvements</p>
                              <ul className="space-y-1">
                                {aiSuggestion.improvements.map((s, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-green-800">
                                    <span className="text-amber-500 mt-0.5">→</span> {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Grade inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Grade (0–100)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={grade}
                            onChange={(e) => setGrade(Number(e.target.value))}
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-2xl font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 text-center"
                            min="0" max="100"
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
                          placeholder="Provide constructive feedback…"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-4">
                      <button onClick={() => { setSelectedSubmission(null); setAiSuggestion(null); }} className="px-8 py-3 text-sm font-bold text-slate-500 hover:text-slate-700">
                        Skip for Now
                      </button>
                      <button
                        onClick={submitGrade}
                        disabled={isSubmitting}
                        className="px-10 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                      >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (<>Publish Grade <CheckCircle2 className="w-4 h-4" /></>)}
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
                  <p className="text-sm text-slate-500 max-w-xs">Choose a student&apos;s work from the list on the left to start grading.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Students Tab */}
      {activeTab === "students" && (
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-900">Student Monitoring</h3>
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search students…" className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50">
                  {["Student", "Average", "Missed", "AI Status", ""].map((h, i) => (
                    <th key={i} className={`px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest ${i === 4 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {CLASS_DATA.students.map((student, i) => {
                  const color = student.status === "On Track" ? "emerald" : student.status === "At Risk" ? "red" : "amber";
                  return (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-8 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 bg-${color}-50 text-${color}-600 rounded-xl flex items-center justify-center font-bold text-xs`}>
                            {student.name.split(" ").map(n => n[0]).join("")}
                          </div>
                          <span className="text-sm font-bold text-slate-900">{student.name}</span>
                        </div>
                      </td>
                      <td className="px-8 py-4 font-bold text-slate-700 tabular-nums">{student.average}%</td>
                      <td className="px-8 py-4 text-slate-500">{student.missed}</td>
                      <td className="px-8 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${color}-100 text-${color}-700`}>
                          {student.status}
                        </span>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <button className="text-indigo-600 text-xs font-bold hover:underline">View Profile</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === "analytics" && (
        <div className="space-y-8">
          {/* AI Class Overview */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-[28px] border border-green-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-green-700 p-2 rounded-xl">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-sm font-bold text-green-900">AI Class Overview</h3>
              <div className="flex items-center gap-1 bg-white/60 px-2.5 py-1 rounded-full border border-green-100 ml-2">
                <Sparkles className="w-3 h-3 text-green-600" />
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">NVIDIA NIM</span>
              </div>
              <button
                onClick={fetchClassSummary}
                disabled={classSummaryLoading}
                className="ml-auto text-xs font-bold text-green-700 hover:text-green-900 disabled:opacity-40 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            <AnimatePresence mode="wait">
              {classSummaryLoading ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-2">
                  <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                  <span className="text-sm text-green-700">Analysing your class…</span>
                </motion.div>
              ) : (
                <motion.p key="summary" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-green-900 leading-relaxed">
                  {classSummary ? <BoldText text={classSummary} /> : "Click Refresh to generate the class overview."}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-600" /> Grade Distribution
              </h3>
              {/* Simple horizontal bars */}
              <div className="space-y-4">
                {CLASS_DATA.students.map((s, i) => {
                  const color = s.average >= 85 ? "bg-emerald-500" : s.average >= 70 ? "bg-indigo-500" : "bg-red-400";
                  return (
                    <div key={i}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-slate-700">{s.name}</span>
                        <span className="text-sm font-bold text-slate-700 tabular-nums">{s.average}%</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full ${color} rounded-full`}
                          initial={{ width: 0 }}
                          animate={{ width: `${s.average}%` }}
                          transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.1 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-600" /> At-Risk Breakdown
              </h3>
              <div className="space-y-4">
                {CLASS_DATA.students
                  .filter(s => s.status !== "On Track")
                  .map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-red-50 rounded-2xl border border-red-100">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{s.name}</p>
                        <p className="text-xs text-slate-500">Average: {s.average}% · Missed: {s.missed}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        s.status === "At Risk" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      }`}>{s.status}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
