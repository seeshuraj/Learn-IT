/**
 * InstructorRoadmapView
 * Read-only roadmap viewer for instructors.
 * Shown as a slide-over panel when clicking "View Roadmap" on any student row.
 */
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Map, X, CheckCircle2, Circle, Clock,
  BookOpen, RefreshCw, ChevronRight
} from "lucide-react";
import { api } from "../services/api";

interface Milestone {
  id: number;
  step_order: number;
  title: string;
  description: string | null;
  resource_hint: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  completed_at: string | null;
}

interface Roadmap {
  id: number;
  course_id: number;
  title: string;
  summary: string | null;
  generated_at: string;
  milestones: Milestone[];
}

const STATUS_CFG = {
  pending:     { icon: Circle,       color: 'text-slate-400',   bg: 'bg-slate-100'  },
  in_progress: { icon: Clock,        color: 'text-amber-500',   bg: 'bg-amber-50'   },
  completed:   { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' },
};

interface Props {
  studentName: string;
  courseId: number;
  courseName: string;
  onClose: () => void;
}

const InstructorRoadmapView: React.FC<Props> = ({ studentName, courseId, courseName, onClose }) => {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    api.getRoadmap(courseId)
      .then(d => setRoadmap(d as Roadmap))
      .catch(e => {
        if (!e.message?.includes('404') && !e.message?.includes('No roadmap')) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [courseId]);

  const completed = roadmap?.milestones.filter(m => m.status === 'completed').length ?? 0;
  const total     = roadmap?.milestones.length ?? 0;
  const progress  = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-indigo-100 p-2 rounded-xl shrink-0">
              <Map className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium truncate">{courseName}</p>
              <h2 className="text-sm font-bold text-slate-900 truncate">{studentName}&apos;s Roadmap</h2>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 ml-4 text-slate-400 hover:text-slate-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {loading && (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="text-red-600 text-sm bg-red-50 rounded-2xl px-4 py-3 border border-red-200">{error}</div>
          )}

          {!loading && !error && !roadmap && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Map className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-slate-500 text-sm font-medium">No roadmap generated yet for this student.</p>
              <p className="text-slate-400 text-xs mt-1">The student can generate one from their Roadmap page.</p>
            </div>
          )}

          {!loading && roadmap && (
            <>
              {/* Summary card */}
              <div className="bg-indigo-50 rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-indigo-900">{roadmap.title}</h3>
                {roadmap.summary && (
                  <p className="text-xs text-indigo-700 leading-relaxed">{roadmap.summary}</p>
                )}
                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-indigo-600">
                    <span>{completed} / {total} completed</span>
                    <span className="font-bold">{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-indigo-200 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-indigo-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-indigo-500">
                  Generated {new Date(roadmap.generated_at).toLocaleString()}
                </p>
              </div>

              {/* Milestones */}
              <div className="space-y-2">
                {roadmap.milestones.map((m, i) => {
                  const cfg = STATUS_CFG[m.status];
                  const Icon = cfg.icon;
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`flex items-start gap-3 p-4 rounded-2xl border ${
                        m.status === 'completed'
                          ? 'bg-emerald-50/60 border-emerald-100'
                          : m.status === 'in_progress'
                          ? 'bg-amber-50/50 border-amber-100'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-1 ring-offset-1 ${cfg.bg} ring-slate-200`}>
                        <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400">#{m.step_order}</span>
                          <p className={`text-sm font-semibold ${
                            m.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'
                          } truncate`}>{m.title}</p>
                        </div>
                        {m.description && (
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{m.description}</p>
                        )}
                        {m.resource_hint && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-indigo-600">
                            <BookOpen className="w-3 h-3 shrink-0" />
                            <span className="truncate">{m.resource_hint}</span>
                          </div>
                        )}
                        {m.completed_at && (
                          <p className="text-[10px] text-slate-400 mt-1">
                            Completed {new Date(m.completed_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default InstructorRoadmapView;
