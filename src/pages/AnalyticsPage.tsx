import { useEffect, useState } from 'react';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';

interface Stats {
  totalSubmissions: number;
  gradedCount: number;
  avgGrade: number;
  lateCount: number;
  assignments: Array<{ title: string; avgGrade: number; submissionCount: number }>;
}

export default function AnalyticsPage() {
  const userRaw = localStorage.getItem('learnit_user');
  const user = userRaw ? JSON.parse(userRaw) : null;
  const [stats, setStats] = useState<Stats | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!user) return;
    api.getStudentStats(user.id)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoadingStats(false));
  }, [user?.id]);

  async function fetchAiSummary() {
    if (!stats) return;
    setAiLoading(true);
    setAiSummary('');
    try {
      const res = await api.aiAnalyticsSummary({
        studentName: user?.name,
        totalSubmissions: stats.totalSubmissions,
        gradedCount: stats.gradedCount,
        avgGrade: stats.avgGrade,
        lateCount: stats.lateCount,
        assignments: stats.assignments,
      });
      setAiSummary(res.summary);
    } catch (e: any) {
      setAiSummary('Could not generate summary: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  if (loadingStats) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Your performance overview powered by AI</p>
      </div>

      {/* KPI row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Submissions', value: stats.totalSubmissions },
            { label: 'Graded', value: stats.gradedCount },
            { label: 'Avg Grade', value: stats.avgGrade != null ? `${stats.avgGrade.toFixed(1)}%` : '—' },
            { label: 'Late', value: stats.lateCount },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-teal-700">{kpi.value}</div>
              <div className="text-xs text-slate-500 mt-1">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Assignment breakdown */}
      {stats?.assignments && stats.assignments.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Assignment Breakdown</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Assignment</th>
                <th className="text-right px-5 py-3">Avg Grade</th>
                <th className="text-right px-5 py-3">Submissions</th>
              </tr>
            </thead>
            <tbody>
              {stats.assignments.map((a, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-700">{a.title}</td>
                  <td className="px-5 py-3 text-right font-medium text-teal-700">{a.avgGrade != null ? `${Number(a.avgGrade).toFixed(1)}%` : '—'}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{a.submissionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Summary */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-slate-800">AI Performance Summary</h2>
            <p className="text-xs text-slate-400 mt-0.5">Powered by NVIDIA NIM · Mistral Large</p>
          </div>
          <button
            onClick={fetchAiSummary}
            disabled={aiLoading || !stats}
            className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {aiLoading ? 'Generating…' : aiSummary ? 'Regenerate' : '✦ Generate AI Summary'}
          </button>
        </div>
        {aiLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-teal-500 border-t-transparent" />
            Analysing your performance data…
          </div>
        )}
        {aiSummary && !aiLoading && (
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown>{aiSummary}</ReactMarkdown>
          </div>
        )}
        {!aiSummary && !aiLoading && (
          <p className="text-slate-400 text-sm">Click the button above to get a personalised AI analysis of your academic performance.</p>
        )}
      </div>
    </div>
  );
}
