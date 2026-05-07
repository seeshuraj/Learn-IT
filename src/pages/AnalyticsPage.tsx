import React, { useState, useEffect } from "react";
import { User } from "../types";
import { TrendingUp, TrendingDown, Minus, Brain, Loader2, BarChart3, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getAnalyticsSummary, StudentAnalyticsData } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface AnalyticsPageProps { user: User; }

const MOCK_ANALYTICS: StudentAnalyticsData = {
  studentName: "Alex",
  overallAverage: 81,
  submissionRate: 94,
  courses: [
    { name: "Data Structures (CS301)", average: 92, assignments: 8, late: 0 },
    { name: "Algorithms (CS302)", average: 88, assignments: 7, late: 1 },
    { name: "Database Systems (CS401)", average: 67, assignments: 6, late: 2 },
    { name: "Operating Systems (CS403)", average: 76, assignments: 5, late: 1 },
    { name: "Computer Networks (CS404)", average: 83, assignments: 6, late: 0 },
  ],
};

const GRADE_HISTORY = [
  { week: "W1", avg: 74 }, { week: "W2", avg: 78 }, { week: "W3", avg: 75 },
  { week: "W4", avg: 82 }, { week: "W5", avg: 80 }, { week: "W6", avg: 85 },
  { week: "W7", avg: 84 }, { week: "W8", avg: 88 },
];

function GradeBar({ value }: { value: number }) {
  const color = value >= 85 ? "bg-emerald-500" : value >= 70 ? "bg-indigo-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${color} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="text-sm font-bold text-slate-700 w-10 text-right tabular-nums">{value}%</span>
    </div>
  );
}

function MiniSparkline() {
  const W = 200; const H = 60;
  const max = Math.max(...GRADE_HISTORY.map((d) => d.avg));
  const min = Math.min(...GRADE_HISTORY.map((d) => d.avg)) - 5;
  const pts = GRADE_HISTORY.map((d, i) => {
    const x = (i / (GRADE_HISTORY.length - 1)) * W;
    const y = H - ((d.avg - min) / (max - min)) * H;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16">
      <polyline points={pts} fill="none" stroke="rgb(99 102 241)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {GRADE_HISTORY.map((d, i) => {
        const x = (i / (GRADE_HISTORY.length - 1)) * W;
        const y = H - ((d.avg - min) / (max - min)) * H;
        return <circle key={i} cx={x} cy={y} r="3" fill="rgb(99 102 241)" />;
      })}
    </svg>
  );
}

// Render **bold** markdown inline
function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-bold text-indigo-900">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ user }) => {
  const [aiSummary, setAiSummary] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const data = MOCK_ANALYTICS;
  const sorted = [...data.courses].sort((a, b) => b.average - a.average);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const fetchSummary = async () => {
    setIsLoading(true);
    setAiSummary("");
    try {
      const summary = await getAnalyticsSummary(data);
      setAiSummary(summary);
    } catch {
      toast.error("Could not load AI summary.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div>
        <h1 className="text-4xl font-bold text-slate-900">My Analytics</h1>
        <p className="text-slate-500 mt-1">Track your performance with AI-powered insights.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Overall Average", value: `${data.overallAverage}%`, icon: BarChart3, color: "indigo" },
          { label: "Submission Rate", value: `${data.submissionRate}%`, icon: CheckCircle2, color: "emerald" },
          { label: "Best Subject", value: best.average + "%", icon: TrendingUp, color: "emerald", sub: best.name.split("(")[0].trim() },
          { label: "Needs Work", value: worst.average + "%", icon: AlertCircle, color: "red", sub: worst.name.split("(")[0].trim() },
        ].map((kpi, i) => (
          <div key={i} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            <div className={`bg-${kpi.color}-50 p-2.5 rounded-xl text-${kpi.color}-600 w-fit mb-3`}>
              <kpi.icon className="w-5 h-5" />
            </div>
            <p className="text-xs text-slate-500 font-medium mb-1">{kpi.label}</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{kpi.value}</p>
            {kpi.sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{kpi.sub}</p>}
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-[28px] border border-green-100">
        <div className="flex items-center gap-2 mb-4">
          <div className="bg-green-700 p-2 rounded-xl">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-sm font-bold text-green-900">AI Performance Summary</h3>
          <div className="ml-auto flex items-center gap-1 bg-white/60 px-2.5 py-1 rounded-full border border-green-100">
            <Sparkles className="w-3 h-3 text-green-600" />
            <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">NVIDIA NIM</span>
          </div>
        </div>
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-2">
              <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
              <span className="text-sm text-green-700">Generating your personalised summary…</span>
            </motion.div>
          ) : (
            <motion.p key="summary" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="text-sm text-green-900 leading-relaxed">
              {aiSummary ? <BoldText text={aiSummary} /> : "Click Refresh to generate your AI summary."}
            </motion.p>
          )}
        </AnimatePresence>
        <button
          onClick={fetchSummary}
          disabled={isLoading}
          className="mt-4 text-xs font-bold text-green-700 hover:text-green-900 transition-colors disabled:opacity-40"
        >
          ↻ Refresh Summary
        </button>
      </div>

      <div className="bg-white p-8 rounded-[28px] border border-slate-100 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6">Course Breakdown</h3>
        <div className="space-y-5">
          {data.courses.map((course, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{course.name}</p>
                  <p className="text-xs text-slate-400">
                    {course.assignments} assignments
                    {course.late > 0 && <span className="ml-2 text-red-400 font-medium">· {course.late} late</span>}
                  </p>
                </div>
                {course.average >= 85 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> :
                  course.average < 70 ? <TrendingDown className="w-4 h-4 text-red-400" /> :
                  <Minus className="w-4 h-4 text-slate-400" />}
              </div>
              <GradeBar value={course.average} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-8 rounded-[28px] border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">Grade Trend (8 Weeks)</h3>
          <span className="text-xs text-slate-400 font-medium">{GRADE_HISTORY[0].avg}% → {GRADE_HISTORY[GRADE_HISTORY.length - 1].avg}%</span>
        </div>
        <MiniSparkline />
        <div className="flex justify-between mt-2">
          {GRADE_HISTORY.map((d) => (<span key={d.week} className="text-[10px] text-slate-400 font-medium">{d.week}</span>))}
        </div>
      </div>
    </div>
  );
};
