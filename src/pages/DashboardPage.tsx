import React, { useEffect, useState } from "react";
import { User, Course, Assignment } from "../types";
import { BookOpen, Calendar, Clock, ArrowRight, CheckCircle2, AlertCircle, Bot } from "lucide-react";
import { Link } from "react-router-dom";
import { Toaster, toast } from "sonner";

interface DashboardPageProps {
  user: User;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    fetch("/api/courses").then(res => res.json()).then(setCourses);
    fetch("/api/assignments").then(res => res.json()).then(setAssignments);
  }, []);

  const upcomingAssignments = assignments.filter(a => a.status === "pending" || a.status === "overdue");

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Welcome back, {user.name.split(" ")[0]}! 👋</h1>
          <p className="text-slate-500 mt-1">Here's what's happening in your courses today.</p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-100">
          <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold">
            {user.gpa}
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Current GPA</p>
            <p className="text-sm font-bold text-slate-900">Excellent Standing</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                Active Courses
              </h2>
              <Link to="/courses" className="text-sm font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                View All <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courses.slice(0, 4).map(course => (
                <Link 
                  key={course.id} 
                  to={`/courses/${course.id}`}
                  className="group bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-indigo-600/5 hover:border-indigo-100 transition-all"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <BookOpen className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{course.code}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-indigo-600 transition-colors">{course.name}</h3>
                  <p className="text-sm text-slate-500">{course.instructor_name}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-6">
              <div className="bg-purple-100 p-3 rounded-2xl text-purple-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">AI Learning Insight</h3>
                <p className="text-sm text-slate-500">Based on your recent Algorithm Report</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <p className="text-slate-700 leading-relaxed">
                "You're performing exceptionally well in theoretical concepts, but your implementation scores show a slight dip. We recommend spending 2 extra hours on the **Sorting Algorithms** module practice exercises."
              </p>
              <button className="mt-4 text-sm font-bold text-indigo-600 hover:text-indigo-700">Start Practice Session →</button>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" />
              Upcoming
            </h2>
            <div className="space-y-4">
              {upcomingAssignments.length > 0 ? upcomingAssignments.map(assignment => (
                <div key={assignment.id} className="flex gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100 group">
                  <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                    assignment.status === "overdue" ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600"
                  }`}>
                    <span className="text-[10px] font-bold uppercase">{assignment.due_date.split("-")[1]}</span>
                    <span className="text-lg font-bold leading-none">{assignment.due_date.split("-")[2]}</span>
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">{assignment.title}</h4>
                    <p className="text-xs text-slate-500 truncate">{assignment.course_name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className={`text-[10px] font-bold ${assignment.status === "overdue" ? "text-red-500" : "text-slate-400"}`}>
                        {assignment.status === "overdue" ? "Overdue" : "Due in 3 days"}
                      </span>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-emerald-100 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">All caught up!</p>
                </div>
              )}
            </div>
            <Link to="/assignments" className="block w-full text-center mt-6 py-3 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors">
              View All Assignments
            </Link>
          </section>

          <section className="bg-indigo-600 rounded-3xl p-6 text-white overflow-hidden relative">
            <div className="relative z-10">
              <h3 className="font-bold mb-2">Need Help?</h3>
              <p className="text-xs text-indigo-100 mb-4">Ask the LearnIT AI tutor about any module notes.</p>
              <button 
                onClick={() => toast.info("Open a course module to start chatting with the AI Tutor!")}
                className="w-full py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold shadow-lg shadow-indigo-900/20"
              >
                Open AI Tutor
              </button>
            </div>
            <div className="absolute top-[-20%] right-[-20%] w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
          </section>
        </div>
      </div>
    </div>
  );
};
