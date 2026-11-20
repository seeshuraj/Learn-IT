import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, BarChart3, AlertCircle, FileText, RefreshCw } from 'lucide-react';
import { AIAnalyticsSummary } from '../components/AIAnalyticsSummary';
import {
  StudentAnalyticsResponse, submissionRateOf, toAISummaryData,
} from '../services/aiService';
import { api, type StudentMarks } from '../services/api';
import { TopicMastery } from '../components/TopicMastery';

type AnalyticsData = StudentAnalyticsResponse;

interface GradingInsight {
  text: string;
  count: number;
}

interface GradingInsights {
  totalSubmissionsWithFeedback: number;
  strengths: GradingInsight[];
  improvements: GradingInsight[];
}

interface Props { user: any; }

const gradeColor = (g: number | null) => {
  if (g == null) return 'text-slate-400';
  if (g >= 80) return 'text-green-600';
  if (g >= 60) return 'text-amber-600';
  return 'text-red-600';
};

// ── Band helpers ──────────────────────────────────────────────────────────────────────
const BAND_COLORS: Record<string, string> = {
  strong:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  moderate: 'bg-amber-100   text-amber-700   border-amber-200',
  weak:     'bg-red-100     text-red-700     border-red-200',
};
const BAND_BAR: Record<string, string> = {
  strong: 'bg-emerald-500', moderate: 'bg-amber-500', weak: 'bg-red-500',
};
function BandBadge({ band }: { band: string }) {
  const icons: Record<string, any> = {
    strong:   <TrendingUp   className="w-3 h-3" />,
    moderate: <BarChart3    className="w-3 h-3" />,
    weak:     <TrendingDown className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
      BAND_COLORS[band] ?? 'bg-slate-100 text-slate-600 border-slate-200'
    }`}>
      {icons[band]}
      {band.charAt(0).toUpperCase() + band.slice(1)}
    </span>
  );
}

// ── Grading Insights Panel ──────────────────────────────────────────────────────────────────────
function GradingInsightsPanel({ userId }: { userId: number }) {
  const [insights, setInsights] = useState<GradingInsights | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    api.getStudentGradingInsights(userId)
      .then((d: any) => setInsights(d))
      .catch(() => setError('Could not load grading insights.'))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="h-4 w-40 bg-slate-100 rounded animate-pulse mb-4" />
      <div className="flex gap-2 flex-wrap">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-7 w-28 bg-slate-100 rounded-full animate-pulse" />
        ))}
      </div>
    </div>
  );

  if (error || !insights || insights.totalSubmissionsWithFeedback === 0) return null;
  const hasAny = insights.strengths.length > 0 || insights.improvements.length > 0;
  if (!hasAny) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-slate-800">AI Grading Insights</h2>
        <span className="ml-auto text-xs text-slate-400">
          Based on {insights.totalSubmissionsWithFeedback} graded submission{insights.totalSubmissionsWithFeedback !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="px-5 py-4 grid sm:grid-cols-2 gap-5">
        {insights.strengths.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">✓ Strengths</p>
            <div className="flex flex-wrap gap-2">
              {insights.strengths.map((s, i) => (
                <span key={i} title={s.count > 1 ? `Mentioned ${s.count}×` : undefined}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                  {s.text}
                  {s.count > 1 && <span className="text-emerald-500 text-[10px] font-bold">{s.count}×</span>}
                </span>
              ))}
            </div>
          </div>
        )}
        {insights.improvements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              <AlertCircle className="inline w-3 h-3 mr-1" />Areas to Improve
            </p>
            <div className="flex flex-wrap gap-2">
              {insights.improvements.map((imp, i) => (
                <span key={i} title={imp.count > 1 ? `Mentioned ${imp.count}×` : undefined}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                  {imp.text}
                  {imp.count > 1 && <span className="text-amber-500 text-[10px] font-bold">{imp.count}×</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Unit Exam Section ────────────────────────────────────────────────────────────────────────────────
// Published assessments with their marks, then topic mastery worked out from
// the question-wise marks against each question paper.
function UnitExamSection({ userId }: { userId: number }) {
  const [insights, setInsights] = useState<StudentMarks | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    api.getStudentExamInsights(userId)
      .then(d => setInsights(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm animate-pulse">
      <div className="h-4 w-48 bg-slate-100 rounded mb-4" />
      {[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl mb-3" />)}
    </div>
  );

  const exams = insights?.results ?? [];
  if (!insights || exams.length === 0) return null;
  const topics = insights.topics ?? [];
  const courses = new Set(topics.map(t => t.course_id));

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-slate-800">Assessments</h2>
          {insights.overall_avg !== null && (
            <span className="ml-auto text-xs text-slate-500">Average <strong className="tabular-nums">{insights.overall_avg}%</strong></span>
          )}
        </div>
        <div className="divide-y divide-slate-50" data-testid="assessment-results">
          {exams.slice(0, 6).map(ex => {
            const pct = ex.percentage !== null ? Number(ex.percentage) : null;
            const band = ex.performance_band;
            return (
              <div key={ex.exam_id} className="px-5 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {ex.course_code && (
                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded shrink-0">{ex.course_code}</span>
                      )}
                      <span className="text-sm font-semibold text-slate-800 truncate">{ex.exam_title}</span>
                    </div>
                    {ex.exam_date && (
                      <p className="text-xs text-slate-400">
                        {new Date(ex.exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ex.is_absent ? (
                      <span className="text-xs font-medium text-slate-500">Absent</span>
                    ) : (
                      <span className="text-sm font-bold tabular-nums text-slate-700">
                        {ex.marks_obtained}/{ex.max_marks}
                        {pct !== null && <span className="text-xs font-normal text-slate-400 ml-1">({pct}%)</span>}
                      </span>
                    )}
                    {band && <BandBadge band={band} />}
                  </div>
                </div>
                {pct !== null && !ex.is_absent && (
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-2 rounded-full ${BAND_BAR[band ?? ''] ?? 'bg-slate-400'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <TopicMastery topics={topics} title="Topic mastery" singleCourse={courses.size <= 1} />
    </div>
  );
}

// ── Main AnalyticsPage ────────────────────────────────────────────────────────────────────────────
export default function AnalyticsPage({ user }: Props) {
  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError('');
    api.getStudentAnalytics(user.id)
      .then((d: any) => setData(d))
      .catch(() => setError('Could not load analytics. The server may still be warming up.'))
      .finally(() => setLoading(false));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent" />
      <p className="text-slate-400 text-sm">Loading analytics…</p>
    </div>
  );

  if (error || !data) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <p className="text-slate-500 text-sm text-center max-w-xs">
        {error || 'Could not load analytics.'}
      </p>
      <button
        onClick={load}
        className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );

  const submissionRate = submissionRateOf(data);
  const aiData = toAISummaryData(data);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Performance overview · {data.student_name}</p>
      </div>

      {/* AI narrative summary */}
      <AIAnalyticsSummary data={aiData} autoLoad={true} />

      {/* AI Grading Insights from assignments */}
      <GradingInsightsPanel userId={user.id} />

      {/* Unit Exam Performance — rendered only when data exists */}
      <UnitExamSection userId={user.id} />

      {/* Stats row */}
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
          { label: 'Submitted', value: String(data.total_submitted), color: 'text-slate-800' },
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

      {/* Course breakdown */}
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
                    <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{c.late} late</span>
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
