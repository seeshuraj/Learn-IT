/**
 * RoadmapPage — a student's study plan per course. With an exam coming, the
 * plan is dated day by day up to the exam (portion and weak topics first,
 * revision at the end); otherwise it's an ordered list.
 *
 * Route: /roadmap (student)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, Circle, Clock, Map, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../services/api";
import { User } from "../types";
import { dayLabel, daysUntil } from "../components/exams/UpcomingExams";

interface Course { id: number; name: string; code: string }

type Status = 'pending' | 'in_progress' | 'completed';

interface Milestone {
  id: number;
  step_order: number;
  title: string;
  description: string | null;
  resource_hint: string | null;
  status: Status;
  completed_at: string | null;
  due_date: string | null;
  kind: 'learn' | 'practice' | 'revise' | 'assignment' | 'exam' | 'other' | null;
  topic: string | null;
  est_minutes: number | null;
}

interface Roadmap {
  id: number;
  course_id: number;
  title: string;
  summary: string | null;
  generated_at: string;
  stale_reason: string | null;
  target_exam: { unit_exam_id: number; title: string; exam_date: string } | null;
  milestones: Milestone[];
}

const STATUS: Record<Status, { label: string; icon: typeof Circle; tone: string }> = {
  pending:     { label: 'Not started', icon: Circle,       tone: 'text-slate-400' },
  in_progress: { label: 'In progress', icon: Clock,        tone: 'text-amber-500' },
  completed:   { label: 'Done',        icon: CheckCircle2, tone: 'text-emerald-600' },
};
const nextStatus = (s: Status): Status => (s === 'pending' ? 'in_progress' : s === 'in_progress' ? 'completed' : 'pending');

const KIND: Record<string, { label: string; cls: string }> = {
  learn:      { label: 'Learn',      cls: 'bg-indigo-50 text-indigo-700' },
  practice:   { label: 'Practise',   cls: 'bg-teal-50 text-teal-700' },
  revise:     { label: 'Revise',     cls: 'bg-amber-50 text-amber-800' },
  assignment: { label: 'Assignment', cls: 'bg-slate-100 text-slate-700' },
  exam:       { label: 'Exam',       cls: 'bg-red-50 text-red-700' },
  other:      { label: 'Task',       cls: 'bg-slate-100 text-slate-700' },
};

const MilestoneRow: React.FC<{ m: Milestone; onStatus: (id: number, s: Status) => Promise<void> }> = ({ m, onStatus }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS[m.status];
  const Icon = st.icon;
  const kind = KIND[m.kind ?? 'other'] ?? KIND.other;
  const isExam = m.kind === 'exam';

  return (
    <li className={`rounded-xl border bg-white ${isExam ? 'border-red-200' : m.status === 'completed' ? 'border-emerald-100' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        {!isExam ? (
          <button
            onClick={async () => { setBusy(true); await onStatus(m.id, nextStatus(m.status)); setBusy(false); }}
            disabled={busy}
            aria-label={`${m.title}: ${st.label}. Mark as ${STATUS[nextStatus(m.status)].label}`}
            className="mt-0.5 shrink-0 rounded-full p-0.5 hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? <RefreshCw className="h-5 w-5 animate-spin text-slate-400" /> : <Icon className={`h-5 w-5 ${st.tone}`} />}
          </button>
        ) : <span className="mt-0.5 h-6 w-6 shrink-0" />}
        <button onClick={() => setOpen(o => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className={`text-sm font-semibold ${m.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{m.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className={`rounded-full px-2 py-0.5 font-medium ${kind.cls}`}>{kind.label}</span>
            {m.topic && <span>{m.topic}</span>}
            {m.est_minutes && <span>· {m.est_minutes} min</span>}
          </p>
        </button>
        {(m.description || m.resource_hint) && (
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        )}
      </div>
      {open && (m.description || m.resource_hint) && (
        <div className="space-y-2 px-3 pb-3 pl-12">
          {m.description && <p className="text-sm leading-relaxed text-slate-600">{m.description}</p>}
          {m.resource_hint && (
            <p className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {m.resource_hint}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

const RoadmapPage: React.FC<{ user: User }> = ({ user }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStudentCourses(user.id).then((data: any) => {
      const list: Course[] = Array.isArray(data) ? data : [];
      setCourses(list);
      const fromUrl = Number(new URLSearchParams(window.location.search).get('course'));
      setCourseId(list.find(c => c.id === fromUrl)?.id ?? list[0]?.id ?? null);
    }).catch(() => {});
  }, [user.id]);

  const load = useCallback(async (id: number) => {
    setLoading(true); setError(null); setRoadmap(null);
    try { setRoadmap(await api.getRoadmap(id) as Roadmap); }
    catch (e: any) { if (e.status !== 404 && !/No roadmap/.test(e.message ?? '')) setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (courseId != null) void load(courseId); }, [courseId, load]);

  const generate = async () => {
    if (!courseId) return;
    setGenerating(true); setError(null);
    try { await api.generateRoadmap(courseId); await load(courseId); }
    catch (e: any) { setError(e.message); }
    finally { setGenerating(false); }
  };

  const setStatus = async (id: number, status: Status) => {
    try {
      await api.updateMilestoneStatus(id, status);
      setRoadmap(r => r && ({ ...r, milestones: r.milestones.map(m => m.id === id ? { ...m, status, completed_at: status === 'completed' ? new Date().toISOString() : null } : m) }));
    } catch { /* unchanged on failure */ }
  };

  const course = courses.find(c => c.id === courseId);
  const steps = roadmap?.milestones.filter(m => m.kind !== 'exam') ?? [];
  const done = steps.filter(m => m.status === 'completed').length;
  const progress = steps.length ? Math.round((done / steps.length) * 100) : 0;

  // Dated plans: overdue ("catch up"), then one group per day.
  const groups = useMemo(() => {
    if (!roadmap) return [];
    const dated = roadmap.milestones.some(m => m.due_date);
    if (!dated) return [{ key: 'all', label: null as string | null, tone: '', items: roadmap.milestones }];
    const out: { key: string; label: string | null; tone: string; items: Milestone[] }[] = [];
    const overdue = roadmap.milestones.filter(m => m.due_date && daysUntil(m.due_date) < 0 && m.status !== 'completed');
    if (overdue.length) out.push({ key: 'overdue', label: 'Catch up', tone: 'text-red-700', items: overdue });
    const byDay: Record<string, Milestone[]> = {};
    for (const m of roadmap.milestones) {
      if (!m.due_date || (daysUntil(m.due_date) < 0 && m.status !== 'completed')) continue;
      (byDay[m.due_date] ??= []).push(m);
    }
    for (const d of Object.keys(byDay).sort()) {
      const n = daysUntil(d);
      out.push({ key: d, label: n === 0 ? `Today · ${dayLabel(d)}` : n === 1 ? `Tomorrow · ${dayLabel(d)}` : dayLabel(d), tone: n <= 1 ? 'text-indigo-700' : 'text-slate-700', items: byDay[d] });
    }
    return out;
  }, [roadmap]);

  const exam = roadmap?.target_exam;
  const daysToExam = exam ? daysUntil(exam.exam_date) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-0">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            <Map className="h-7 w-7 text-indigo-500" /> My study plan
          </h1>
          <p className="mt-1 text-sm text-slate-500">Day by day to your next exam, from your marks, weak topics and the exam portion.</p>
        </div>
        <select value={courseId ?? ''} onChange={e => setCourseId(Number(e.target.value))} aria-label="Course"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm">
          {courses.map(c => <option key={c.id} value={c.id}>{c.code}: {c.name}</option>)}
        </select>
      </div>

      {loading && <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>}

      {!loading && error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!loading && !error && !roadmap && courseId && (
        <div className="space-y-4 rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm">
          <Sparkles className="mx-auto h-10 w-10 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">No plan yet for {course?.code}</h2>
          <p className="mx-auto max-w-sm text-sm text-slate-500">
            LearnIT builds a day-by-day plan to your next {course?.code} exam: the exam portion first, your weak topics given extra time, and revision days at the end.
          </p>
          <button onClick={generate} disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {generating ? <><RefreshCw className="h-4 w-4 animate-spin" /> Making your plan…</> : <><Sparkles className="h-4 w-4" /> Make my plan</>}
          </button>
        </div>
      )}

      {!loading && roadmap && (
        <>
          {roadmap.stale_reason && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{roadmap.stale_reason}. Update your plan to match.</span>
              <button onClick={generate} disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                {generating && <RefreshCw className="h-4 w-4 animate-spin" />} Update my plan
              </button>
            </div>
          )}

          <div className="space-y-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
            {exam && daysToExam !== null && daysToExam >= 0 && (
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold tabular-nums text-slate-900">{daysToExam}</span>
                <span className="text-sm text-slate-600">
                  {daysToExam === 1 ? 'day' : 'days'} to <b className="text-slate-900">{exam.title}</b> · {dayLabel(exam.exam_date)}
                </span>
              </div>
            )}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">{roadmap.title}</h2>
                <p className="mt-0.5 text-xs text-slate-400">Made {new Date(roadmap.generated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
              {!roadmap.stale_reason && (
                <button onClick={generate} disabled={generating}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                  {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generating ? 'Updating…' : 'Remake plan'}
                </button>
              )}
            </div>
            {roadmap.summary && <p className="border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-600">{roadmap.summary}</p>}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{done} of {steps.length} steps done</span>
                <span className="font-semibold text-indigo-600">{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {groups.map(g => (
              <section key={g.key} aria-label={g.label ?? 'Steps'}>
                {g.label && <h3 className={`mb-2 text-sm font-bold ${g.tone}`}>{g.label}</h3>}
                <ul className="space-y-2">{g.items.map(m => <MilestoneRow key={m.id} m={m} onStatus={setStatus} />)}</ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default RoadmapPage;
