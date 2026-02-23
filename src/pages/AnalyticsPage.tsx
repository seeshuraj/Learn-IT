import React, { useEffect, useState } from "react";
import { User, Submission } from "../types";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard";
import { Brain, Sparkles, Download, Loader2 } from "lucide-react";
import { getLongitudinalInsight } from "../services/aiService";
import { toast, Toaster } from "sonner";

interface AnalyticsPageProps {
  user: User;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ user }) => {
  const [stats, setStats] = useState<{ user: User; submissions: Submission[] } | null>(null);
  const [aiInsight, setAiInsight] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/student/${user.id}/stats`).then(res => res.json()).then(setStats);
  }, [user.id]);

  const handleAiDeepDive = async () => {
    if (!stats) return;
    setIsAiLoading(true);
    try {
      const insight = await getLongitudinalInsight(user.name, user.gpa || 0, user.major || "", stats.submissions);
      setAiInsight(insight);
      toast.success("AI Deep Dive Complete!");
    } catch (error) {
      toast.error("AI Analysis failed.");
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!stats) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster position="top-right" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Academic Analytics</h1>
          <p className="text-slate-500 mt-1">Longitudinal tracking and AI-powered insights.</p>
        </div>
        <div className="flex gap-3">
          <button className="px-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2">
            <Download className="w-4 h-4" /> Export Report
          </button>
          <button 
            onClick={handleAiDeepDive}
            disabled={isAiLoading}
            className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Deep Dive
          </button>
        </div>
      </div>

      {aiInsight && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-8 flex items-start gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="bg-indigo-600 p-3 rounded-2xl text-white">
            <Brain className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-indigo-900 mb-2">AI Longitudinal Insight</h3>
            <p className="text-indigo-800 leading-relaxed">{aiInsight}</p>
          </div>
        </div>
      )}

      <AnalyticsDashboard user={stats.user} submissions={stats.submissions} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Recent Performance</h3>
          <div className="space-y-6">
            {stats.submissions.map(sub => (
              <div key={sub.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100">
                    <Brain className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{sub.assignment_title}</p>
                    <p className="text-xs text-slate-500">Graded by Dr. Aris</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-indigo-600">{sub.grade}/100</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Final Grade</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Learning Path</h3>
          <div className="space-y-6">
            <div className="relative pl-8 border-l-2 border-indigo-100 space-y-8">
              <div className="relative">
                <div className="absolute -left-[41px] top-0 w-4 h-4 rounded-full bg-indigo-600 border-4 border-white shadow-sm"></div>
                <h4 className="text-sm font-bold text-slate-900">Current: 3rd Year CS</h4>
                <p className="text-xs text-slate-500 mt-1">Focusing on AI and Advanced Algorithms.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-[41px] top-0 w-4 h-4 rounded-full bg-slate-200 border-4 border-white shadow-sm"></div>
                <h4 className="text-sm font-bold text-slate-400">Next: Final Year Project</h4>
                <p className="text-xs text-slate-400 mt-1">Recommended topic: Neural Network Optimization.</p>
              </div>
              <div className="relative">
                <div className="absolute -left-[41px] top-0 w-4 h-4 rounded-full bg-slate-200 border-4 border-white shadow-sm"></div>
                <h4 className="text-sm font-bold text-slate-400">Career: ML Engineer</h4>
                <p className="text-xs text-slate-400 mt-1">Projected readiness: 85%.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
