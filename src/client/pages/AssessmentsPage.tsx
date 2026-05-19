/**
 * AssessmentsPage
 * Shown at /courses/:courseId/assessments
 * - Instructor: lists all unit exams for their course with band distribution.
 *   Can create new exams via ExamUploadWizard. Clicking an exam opens analytics.
 * - Student: lists exams and their own result for each.
 *
 * API used:
 *   GET  /api/unit-exams/course/:courseId   — list exams with aggregate stats
 *   GET  /api/unit-exams/:id/analytics      — instructor drill-down (ExamAnalyticsModal)
 *   GET  /api/unit-exams/student/:id/insights — student's own results (ExamPerformanceCard)
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ExamUploadWizard } from '../components/instructor/ExamUploadWizard';
import { ExamAnalyticsModal } from '../components/instructor/ExamAnalyticsModal';
import { ExamPerformanceCard } from '../components/student/ExamPerformanceCard';
import {
  ClipboardList,
  Plus,
  ChevronRight,
  BarChart2,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface UnitExam {
  id: number;
  title: string;
  exam_date: string | null;
  max_marks: number;
  status: string;
  analysis_status: string;
  result_count: number;
  // aggregate stats returned by the list route (computed server-side)
  avg_pct:        number | null;
  pass_rate:      number | null;
  strong_count:   number;
  moderate_count: number;
  weak_count:     number;
}

interface CourseInfo {
  id: number;
  name: string;
}

interface Props {
  role: 'instructor' | 'student';
  /** Required for student view — the logged-in student's ID */
  studentId?: number;
}

export function AssessmentsPage({ role, studentId }: Props) {
  const { courseId } = useParams<{ courseId: string }>();
  const [exams,           setExams]           = useState<UnitExam[]>([]);
  const [course,          setCourse]          = useState<CourseInfo | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [showWizard,      setShowWizard]      = useState(false);
  const [analyticsExamId, setAnalyticsExamId] = useState<number | null>(null);
  const [error,           setError]           = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    fetchExams();
  }, [courseId]);

  async function fetchExams() {
    try {
      setLoading(true);
      setError(null);
      // Correct route: /api/unit-exams/course/:courseId
      const res = await fetch(`/api/unit-exams/course/${courseId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const data: UnitExam[] = await res.json();
      setExams(data);
      // Course name is not returned by the list route — read from URL/state or
      // set a fallback; a separate course fetch would be a separate concern.
      setCourse(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function bandColor(band: 'strong' | 'moderate' | 'weak') {
    if (band === 'strong')   return 'text-green-700 bg-green-50';
    if (band === 'moderate') return 'text-amber-700 bg-amber-50';
    return 'text-red-700 bg-red-50';
  }

  function statusIcon(status: string) {
    if (status === 'published') return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === 'draft')     return <Clock className="w-4 h-4 text-gray-400" />;
    return <AlertCircle className="w-4 h-4 text-amber-500" />;
  }

  function analysisLabel(s: string) {
    const map: Record<string, string> = {
      pending:    'Analysis pending',
      processing: 'Analysing…',
      done:       'Analysis complete',
      failed:     'Analysis failed',
    };
    return map[s] ?? s;
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="space-y-4">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          <p className="font-medium">Failed to load assessments</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={fetchExams} className="mt-3 text-sm underline hover:no-underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link to="/courses" className="hover:text-gray-700">Courses</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span>{course?.name ?? `Course ${courseId}`}</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-800 font-medium">Assessments</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-teal-600" />
            Unit Exams
          </h1>
        </div>
        {role === 'instructor' && (
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Exam
          </button>
        )}
      </div>

      {/* Instructor: Exam Upload Wizard */}
      {showWizard && courseId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <ExamUploadWizard
              courseId={Number(courseId)}
              onClose={() => setShowWizard(false)}
              onSuccess={() => {
                setShowWizard(false);
                fetchExams();
              }}
            />
          </div>
        </div>
      )}

      {/* Instructor: Analytics drill-down modal */}
      {role === 'instructor' && analyticsExamId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <ExamAnalyticsModal
              examId={analyticsExamId}
              onClose={() => setAnalyticsExamId(null)}
            />
          </div>
        </div>
      )}

      {/* Student: exam performance summary (their own results across all exams) */}
      {role === 'student' && studentId && (
        <div className="mb-6">
          <ExamPerformanceCard studentId={studentId} />
        </div>
      )}

      {/* Empty state */}
      {exams.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ClipboardList className="w-12 h-12 text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">No exams yet</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-sm">
            {role === 'instructor'
              ? 'Create your first unit exam and upload marks to get performance analytics.'
              : 'Your instructor hasn\'t uploaded any unit exam results yet.'}
          </p>
          {role === 'instructor' && (
            <button
              onClick={() => setShowWizard(true)}
              className="mt-5 flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Exam
            </button>
          )}
        </div>
      )}

      {/* Exam list */}
      <div className="space-y-3">
        {exams.map(exam => {
          const total = exam.result_count ?? 0;
          const strong   = exam.strong_count   ?? 0;
          const moderate = exam.moderate_count ?? 0;
          const weak     = exam.weak_count     ?? 0;

          return (
            <div
              key={exam.id}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => role === 'instructor' ? setAnalyticsExamId(exam.id) : undefined}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {statusIcon(exam.status)}
                    <h3 className="font-semibold text-gray-900 truncate">{exam.title}</h3>
                  </div>
                  <p className="text-xs text-gray-500">
                    {exam.exam_date
                      ? new Date(exam.exam_date).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })
                      : 'Date TBC'}
                    {' · '}Max: {exam.max_marks} marks
                    {' · '}{analysisLabel(exam.analysis_status)}
                  </p>
                </div>

                {/* Stats — only shown if results exist */}
                {total > 0 && (
                  <div className="flex items-center gap-4 flex-shrink-0">
                    {exam.avg_pct != null && (
                      <div className="text-center">
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <BarChart2 className="w-3.5 h-3.5" /> Avg
                        </p>
                        <p className="text-sm font-semibold text-gray-800">{exam.avg_pct}%</p>
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> Students
                      </p>
                      <p className="text-sm font-semibold text-gray-800">{total}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bandColor('strong')}`}>
                        {strong} strong
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bandColor('moderate')}`}>
                        {moderate} moderate
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bandColor('weak')}`}>
                        {weak} weak
                      </span>
                    </div>
                  </div>
                )}

                {total === 0 && (
                  <span className="text-xs text-gray-400 flex-shrink-0">No results yet</span>
                )}
              </div>

              {/* Band distribution progress bar */}
              {total > 0 && (
                <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
                  <div style={{ width: `${(strong   / total) * 100}%` }} className="bg-green-400" />
                  <div style={{ width: `${(moderate / total) * 100}%` }} className="bg-amber-400" />
                  <div style={{ width: `${(weak     / total) * 100}%` }} className="bg-red-400" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
