import React, { useEffect, useState } from "react";
import { User, Course, Assignment } from "../types";
import { BookOpen, Calendar, Clock, ArrowRight, CheckCircle2, AlertCircle, Bot, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { api } from "../services/api";

interface DashboardPageProps {
  user: User;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user }) => {
  const [courses, setCourses]         = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [aiInsight, setAiInsight]     = useState<string | null>(null);
  const [aiLoading, setAiLoading]     = useState(false);

  useEffect(() => {
    api.getStudentCourses(user.id)
      .then((data: any) => setCourses(Array.isArray(data) ? data : []))
      .catch(() => {});

    api.getStudentAssignments(user.id)
      .then((data: any) => setAssignments(Array.isArray(data) ? data : []))
      .catch(() => {});

    // P2-7: fetch analytics then pipe into AI summary
    setAiLoading(true);
    api.getStudentAnalytics(user.id)
      .then((analytics: any) => api.aiAnalyticsSummary(analytics))
      .then((res: any) => setAiInsight(res?.summary ?? null))
      .catch(() => setAiInsight(null))
      .finally(() => setAiLoading(false));
  }, [user.id]);

  const upcomingAssignments = assignments.filter(
    a => a.status === "pending" || a.status === "overdue"
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster richColors />
      <div>
        <h1 className="text-4xl font-bold text-slate-900">
          Welcome back, {user.name.split(" ")[0]}! 👋
        </h1>
        <p className="text-slate-500 mt-1">Here's what's happening in your courses today.</p>
      </div>

      <div className="inline-flex items-center gap-3 bg-white rounded-2xl px-6 py-4 shadow-sm border border-slate-100">
        <div className="text-3xl font-bold text-indigo-600">{user.gpa ?? '—'}</div>
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current GPA</p>
          <p className="text-sm font-semibold text-slate-600">Excellent Standing</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900">Active Courses</h2>
          <Link to="/courses" className="text-sm font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            View All <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {courses.slice(0, 4).map(course => (
            <div key={(course as any).id} className="p-5 bg-slate-50 rounded-2xl hover:bg-indigo-50 transition-colors">
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{(course as any).code}</span>
              <h3 className="text-sm font-bold text-slate-900 mt-1">{(course as any).name}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{(course as any).instructor_name}</p>
            </div>
          ))}
          {courses.length === 0 && (
            <p className="text-sm text-slate-400 col-span-2">No enrolled courses yet.</p>
          )}
        </div>
      </div>

      {/* P2-7: Live AI insight — loading skeleton → real summary → silent fail */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl p-8 text-white">
        <div className="flex items-center gap-2 text-indigo-200 text-xs font-bold uppercase tracking-wider mb-3">
          <Bot className="w-4 h-4" /> AI Learning Insight
        </div>

        {aiLoading ? (
          <div className="flex items-center gap-2 text-sm text-indigo-200 opacity-80">
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating your personalised insight…
          </div>
        ) : aiInsight ? (
          <p className="text-sm leading-relaxed opacity-90">{aiInsight}</p>
        ) : (
          <p className="text-sm leading-relaxed opacity-75 italic">
            Could not load AI insight right now — check back shortly.
          </p>
        )}

        <Link to="/courses" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white hover:text-indigo-200 transition-colors">
          Start Practice Session <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900">Upcoming</h2>
        </div>
        {upcomingAssignments.length > 0 ? (
          <div className="space-y-3">
            {upcomingAssignments.map(assignment => (
              <div key={(assignment as any).id} className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl">
                <div className="bg-indigo-100 text-indigo-700 rounded-xl p-2 text-center min-w-[48px]">
                  <p className="text-xs font-bold">{assignment.due_date?.split("-")[1]}</p>
                  <p className="text-sm font-bold">{assignment.due_date?.split("-")[2]}</p>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-slate-900">{assignment.title}</h4>
                  <p className="text-xs text-slate-400">{(assignment as any).course_name}</p>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                  assignment.status === "overdue"
                    ? "bg-red-50 text-red-600"
                    : "bg-amber-50 text-amber-600"
                }`}>
                  {assignment.status === "overdue" ? "Overdue" : "Due soon"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-semibold">All caught up!</span>
          </div>
        )}
        <Link to="/assignments" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-700">
          View All Assignments <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-3xl p-8 text-white">
        <Bot className="w-8 h-8 text-indigo-300 mb-3" />
        <h3 className="text-lg font-bold mb-1">Need Help?</h3>
        <p className="text-sm text-indigo-200 mb-4">Ask the LearnIT AI tutor about any module notes.</p>
        <button
          onClick={() => toast.info("Open a course module to start chatting with the AI Tutor!")}
          className="w-full py-2.5 bg-white text-indigo-600 rounded-xl text-sm font-bold shadow-lg hover:bg-indigo-50 transition-colors"
        >
          Open AI Tutor
        </button>
      </div>
    </div>
  );
};
