import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Map, Sparkles, ChevronDown, CheckCircle2, Circle, Clock, RefreshCw, BookOpen, AlertCircle } from "lucide-react";
import { api } from "../services/api";
import { User } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface Course {
  id: number;
  name: string;
  code: string;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:     { label: 'Not started', icon: Circle,       color: 'text-slate-400',   bg: 'bg-slate-100',   ring: 'ring-slate-200' },
  in_progress: { label: 'In progress', icon: Clock,        color: 'text-amber-500',   bg: 'bg-amber-50',    ring: 'ring-amber-200' },
  completed:   { label: 'Completed',   icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50',  ring: 'ring-emerald-200' },
};

const nextStatus = (s: Milestone['status']): Milestone['status'] => {
  if (s === 'pending')     return 'in_progress';
  if (s === 'in_progress') return 'completed';
  return 'pending';
};

// ── MilestoneCard ────────────────────────────────────────────────────────────

const MilestoneCard: React.FC<{
  milestone: Milestone;
  index: number;
  onStatusChange: (id: number, status: Milestone['status']) => void;
}> = ({ milestone: m, index, onStatusChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const cfg = STATUS_CONFIG[m.status];
  const Icon = cfg.icon;

  const handleCycle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setUpdating(true);
    const next = nextStatus(m.status);
    await onStatusChange(m.id, next);
    setUpdating(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`relative flex gap-4`}
    >
      {/* Vertical connector line */}
      <div className="flex flex-col items-center">
        <button
          onClick={handleCycle}
          disabled={updating}
          title={`Mark as ${nextStatus(m.status)}`}
          className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${
            cfg.ring
          } ${cfg.bg} shrink-0 transition-all hover:scale-110 disabled:opacity-50 disabled:cursor-wait`}
        >
          {updating
            ? <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
            : <Icon className={`w-4 h-4 ${cfg.color}`} />}
        </button>
        {/* line below (hidden on last) */}
        <div className="w-px flex-1 min-h-4 bg-slate-200 mt-1" />
      </div>

      {/* Card body */}
      <div
        className={`flex-1 mb-4 rounded-2xl border cursor-pointer transition-colors ${
          m.status === 'completed'
            ? 'border-emerald-100 bg-emerald-50/40'
            : m.status === 'in_progress'
            ? 'border-amber-100 bg-amber-50/30'
            : 'border-slate-100 bg-white'
        } hover:border-indigo-200 shadow-sm`}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">#{m.step_order}</span>
            <p className={`text-sm font-semibold truncate ${
              m.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'
            }`}>
              {m.title}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`} />
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2">
                {m.description && (
                  <p className="text-sm text-slate-600 leading-relaxed">{m.description}</p>
                )}
                {m.resource_hint && (
                  <div className="flex items-start gap-2 text-xs text-indigo-600 bg-indigo-50 rounded-xl px-3 py-2">
                    <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{m.resource_hint}</span>
                  </div>
                )}
                {m.completed_at && (
                  <p className="text-xs text-slate-400">
                    Completed {new Date(m.completed_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

// ── RoadmapPage ──────────────────────────────────────────────────────────────

interface RoadmapPageProps {
  user: User;
}

const RoadmapPage: React.FC<RoadmapPageProps> = ({ user }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load enrolled courses
  useEffect(() => {
    api.getStudentCourses(user.id).then((data: any) => {
      const list: Course[] = Array.isArray(data) ? data : [];
      setCourses(list);
      if (list.length > 0) setSelectedCourseId(list[0].id);
    }).catch(() => {});
  }, [user.id]);

  // Load roadmap whenever course changes
  const loadRoadmap = useCallback(async (courseId: number) => {
    setLoading(true);
    setError(null);
    setRoadmap(null);
    try {
      const data = await api.getRoadmap(courseId);
      setRoadmap(data as Roadmap);
    } catch (e: any) {
      // 404 = not generated yet — that's fine, show empty state
      if (!e.message?.includes('404') && !e.message?.includes('No roadmap')) {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCourseId != null) loadRoadmap(selectedCourseId);
  }, [selectedCourseId, loadRoadmap]);

  const handleGenerate = async () => {
    if (!selectedCourseId) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await api.generateRoadmap(selectedCourseId);
      setRoadmap(data as Roadmap);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (milestoneId: number, status: Milestone['status']) => {
    try {
      await api.updateMilestoneStatus(milestoneId, status);
      setRoadmap(prev => prev ? {
        ...prev,
        milestones: prev.milestones.map(m =>
          m.id === milestoneId
            ? { ...m, status, completed_at: status === 'completed' ? new Date().toISOString() : null }
            : m
        ),
      } : prev);
    } catch {}
  };

  const selectedCourse = courses.find(c => c.id === selectedCourseId);
  const completed  = roadmap?.milestones.filter(m => m.status === 'completed').length ?? 0;
  const total      = roadmap?.milestones.length ?? 0;
  const progress   = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Map className="w-7 h-7 text-indigo-500" />
            My Learning Roadmap
          </h1>
          <p className="text-slate-500 text-sm mt-1">AI-personalised milestones based on your progress.</p>
        </div>

        {/* Course picker */}
        <select
          value={selectedCourseId ?? ""}
          onChange={e => setSelectedCourseId(Number(e.target.value))}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        >
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state — not yet generated */}
      {!loading && !error && !roadmap && selectedCourseId && (
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm p-10 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mx-auto">
            <Sparkles className="w-8 h-8 text-indigo-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">No roadmap yet</h2>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            Generate a personalised AI learning roadmap for{" "}
            <span className="font-semibold">{selectedCourse?.name}</span>{" "}
            based on your submissions, grades, and pending work.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-indigo-600/20"
          >
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Sparkles className="w-4 h-4" /> Generate Roadmap</>}
          </button>
        </div>
      )}

      {/* Roadmap exists */}
      {!loading && roadmap && (
        <>
          {/* Roadmap header card */}
          <div className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">{roadmap.title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Generated {new Date(roadmap.generated_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                title="Regenerate roadmap"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors disabled:opacity-50"
              >
                {generating
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>

            {roadmap.summary && (
              <p className="text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                {roadmap.summary}
              </p>
            )}

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{completed} / {total} milestones complete</span>
                <span className="font-semibold text-indigo-600">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-indigo-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>

          {/* Milestone stepper */}
          <div className="relative">
            {roadmap.milestones.map((m, i) => (
              <MilestoneCard
                key={m.id}
                milestone={m}
                index={i}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default RoadmapPage;
