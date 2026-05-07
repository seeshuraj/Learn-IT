import { useEffect, useState } from 'react';
import { api } from '../services/api';

interface CourseStats {
  course_name: string;
  course_code: string;
  assignments_total: number;
  assignments_submitted: number;
  avg_grade: number | null;
  grades: { title: string; grade: number; submitted_at: string }[];
}

interface AnalyticsData {
  student_name: string;
  overall_avg: number | null;
  total_submitted: number;
  total_pending: number;
  courses: CourseStats[];
}

interface Props { user: any; }

export default function AnalyticsPage({ user }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/students/${user.id}/analytics`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]);

  async function fetchAISummary() {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ai/analytics-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analytics: data }),
      });
      const json = await res.json();
      setAiSummary(json.summary ?? 'No summary available.');
    } catch {
      setAiSummary('Could not load AI summary.');
    } finally {
      setAiLoading(false);
    }
  }

  const gradeColor = (g: number | null) => {
    if (g == null) return 'text-slate-400';
    if (g >= 80) return 'text-green-600';
    if (g >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const gradeBar = (g: number | null) => {
    if (g == null) return 0;
    return Math.min(100, Math.max(0, g));
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  if (!data) return (
    <div className="text-center py-20 text-slate-400 text-sm">Could not load analytics.</div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Performance overview across all enrolled courses</p>
        </div>
        <button
          onClick={fetchAISummary}
          disabled={aiLoading}
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          {aiLoading ? (
            <span className="flex items-center gap-2"><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />Analysing…</span>
          ) : '✦ AI Summary'}
        </button>
      </div>

      {/* AI Summary Card */}
      {aiSummary && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-2">✦ AI Insight</p>
          <p className="text-sm text-teal-900 leading-relaxed whitespace-pre-line">{aiSummary}</p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Overall Average', value: data.overall_avg != null ? `${data.overall_avg.toFixed(1)}%` : '—', color: gradeColor(data.overall_avg) },
          { label: 'Submitted', value: String(data.total_submitted), color: 'text-slate-800' },
          { label: 'Pending', value: String(data.total_pending), color: data.total_pending > 0 ? 'text-amber-600' : 'text-slate-800' },
          { label: 'Courses', value: String(data.courses.length), color: 'text-slate-800' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Per-course breakdown */}
      <div className="space-y-6">
        {data.courses.map(c => (
          <div key={c.course_code} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c.course_code}</span>
                <span className="ml-2 text-sm font-semibold text-slate-800">{c.course_name}</span>
              </div>
              <span className={`text-lg font-bold tabular-nums ${gradeColor(c.avg_grade)}`}>
                {c.avg_grade != null ? `${c.avg_grade.toFixed(1)}%` : 'No grades'}
              </span>
            </div>

            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-teal-500 transition-all duration-700"
                    style={{ width: `${gradeBar(c.avg_grade)}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 tabular-nums">
                  {c.assignments_submitted}/{c.assignments_total} submitted
                </span>
              </div>

              {c.grades.length > 0 ? (
                <div className="space-y-2">
                  {c.grades.map((g, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-t border-slate-50 first:border-t-0">
                      <span className="text-sm text-slate-600 truncate max-w-xs">{g.title}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          {new Date(g.submitted_at).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}
                        </span>
                        <span className={`text-sm font-semibold tabular-nums w-12 text-right ${gradeColor(g.grade)}`}>
                          {g.grade}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-2">No graded assignments yet</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
