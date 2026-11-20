import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Target, X } from 'lucide-react';
import { api, type StudentTopicReport } from '../services/api';
import { TopicMastery } from './TopicMastery';

interface Props {
  studentId: number;
  studentName: string;
  courseId: number;
  courseName: string;
  onClose: () => void;
}

/** One student's topic mastery in a course, from question-wise marks (instructor view). */
export function StudentTopicsPanel({ studentId, studentName, courseId, courseName, onClose }: Props) {
  const [report, setReport] = useState<StudentTopicReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(null);
    setError('');
    api.getStudentCourseTopics(courseId, studentId)
      .then(setReport)
      .catch((e: any) => setError(e?.message || "Couldn't load this student's topics."));
  }, [courseId, studentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const written = report?.assessments.filter(a => !a.is_absent) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${studentName}'s topics`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-teal-100 p-2 rounded-xl shrink-0"><Target className="w-4 h-4 text-teal-700" /></div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium truncate">{courseName}</p>
              <h2 className="text-sm font-bold text-slate-900 truncate">{studentName}'s topics</h2>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 ml-4 text-slate-400 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {!report && !error && (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {report && (
            <>
              <p className="text-xs text-slate-500">
                {written.length === 0
                  ? 'No published assessment marks for this student yet.'
                  : <>From {written.length} published assessment{written.length === 1 ? '' : 's'}: {written.map(a => `${a.title} (${a.percentage ?? '—'}%)`).join(', ')}.</>}
              </p>
              {report.topics.length > 0 ? (
                <TopicMastery topics={report.topics} title="Topic mastery" singleCourse />
              ) : written.length > 0 ? (
                <p className="text-sm text-slate-500">
                  Topics appear once the assessment has question-wise marks and either an analysed question paper or units tagged on its questions.
                </p>
              ) : null}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
