import { useEffect, useState } from 'react';
import { AIAnalyticsSummary } from '../components/AIAnalyticsSummary';
import { StudentAnalyticsData } from '../services/aiService';
import { api } from '../services/api';

interface CourseStats {
  course_code: string;
  course_name: string;
  assignments_total: number;
  assignments_submitted: number;
  avg_grade: number | null;
  late: number;
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

function toAISummaryData(data: AnalyticsData, submissionRate: number): StudentAnalyticsData {
  return {
    studentName: data.student_name,
    overallAverage: data.overall_avg ?? 0,
    submissionRate,
    courses: data.courses.map(c => ({
      name: c.course_name,
      average: c.avg_grade ?? 0,
      assignments: c.assignments_submitted,
      late: c.late,
    })),
  };
}

const gradeColor = (g: number | null) => {
  if (g == null) return 'text-slate-400';
  if (g >= 80) return 'text-green-600';
  if (g >= 60) return 'text-amber-600';
  return 'text-red-600';
};

export default function AnalyticsPage({ user }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getStudentAnalytics(user.id)
      .then((d: any) => setData(d))
      .catch(() => setError('Could not load analytics data.'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
    </div>
  );

  if (error || !data) return (
    <div className="text-center py-20">
      <p className="text-slate-400 text-sm">{error || 'Could not load analytics.'}</p>
    </div>
  );

  const submissionRate = data.total_submitted + data.total_pending > 0
    ? Math.round((data.total_submitted / (data.total_submitted + data.total_pending)) * 100)
    : 0;

  const aiData = toAISummaryData(data, submissionRate);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Performance overview · {data.student_name}</p>
      </div>

      <AIAnalyticsSummary data={aiData} autoLoad={true} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: 'Overall Average',
            value: data.overall_avg != null ? `${data.overall_avg.toFixed(1)}%` : '—',
            color: gradeColor(data.overall_avg),
          },
          {
            label: 'Submission Rate',
            value: `${submissionRate}%`,
            color: submissionRate >= 80 ? 'text-green-600' : submissionRate >= 60 ? 'text-amber-600' : 'text-red-600',
          },
          {
            label: 'Submitted',
            value: String(data.total_submitted),
            color: 'text-slate-800',
          },
          {
            label: 'Pending',
            value: String(data.total_pending),
            color: data.total_pending > 0 ? 'text-amber-600' : 'text-slate-800',
          },
        ].map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {data.courses.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm">No courses enrolled yet</p>
        </div>
      ) : (
        <div className="space-y-5">
          {data.courses.map(c => (
            <div key={c.course_code} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded shrink-0">
                    {c.course_code}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 truncate">{c.course_name}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {c.late > 0 && (
                    <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                      {c.late} late
                    </span>
                  )}
                  <span className={`text-lg font-bold tabular-nums ${gradeColor(c.avg_grade)}`}>
                    {c.avg_grade != null ? `${c.avg_grade.toFixed(1)}%` : 'No grades'}
                  </span>
                </div>
              </div>
              <div className="px-5 pt-4 pb-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-teal-500 transition-all duration-700"
                      style={{ width: `${c.avg_grade != null ? Math.min(100, c.avg_grade) : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">
                    {c.assignments_submitted}/{c.assignments_total} submitted
                  </span>
                </div>
                {c.grades.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {c.grades.map((g, i) => (
                      <div key={i} className="flex items-center justify-between py-2">
                        <span className="text-sm text-slate-600 truncate max-w-xs">{g.title}</span>
                        <div className="flex items-center gap-3 shrink-0">
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
                  <p className="text-xs text-slate-400 text-center py-3 pb-4">No graded assignments yet</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
