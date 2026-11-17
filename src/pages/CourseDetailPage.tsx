import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, CalendarDays, ChevronRight, ClipboardList, ExternalLink, FileText, GraduationCap, Loader2, Plus, Upload,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { User } from "../types";
import { ChatBot } from "../components/ChatBot";
import { api, type CourseSummary, type UpcomingExam } from "../services/api";

interface CourseDetailPageProps {
  user: User;
}

interface ModuleRow { id: number; name: string }
interface NoteRow { id: number; original_name?: string | null; filename?: string | null; uploaded_at?: string; uploader_name?: string | null }
interface AssignmentRow { id: number; title: string; due_date: string | null; max_points?: number | null }

const fmtDay = (d: string | null) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "No date";

/** Notes and assignments of one module, loaded when it's opened. */
function ModuleBody({ module, isStudent }: { module: ModuleRow; isStudent: boolean }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.getModuleNotes(module.id), api.getModuleAssignments(module.id)])
      .then(([n, a]: any[]) => {
        if (!live) return;
        setNotes(Array.isArray(n) ? n : []);
        setAssignments(Array.isArray(a) ? a : []);
      })
      .catch(e => { if (live) { setNotes([]); setError(e.message || "Could not load this module"); } });
    return () => { live = false; };
  }, [module.id]);

  const open = async (note: NoteRow) => {
    setOpening(note.id);
    try {
      const { url } = await api.getSignedNoteUrl(note.id);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message || "Could not open this file");
    } finally {
      setOpening(null);
    }
  };

  if (notes === null) {
    return <p className="flex items-center gap-2 px-6 pb-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  }
  return (
    <div className="space-y-5 border-t border-slate-100 bg-slate-50/60 p-6">
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Notes and materials</h4>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing uploaded for this module yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {notes.map(n => (
              <li key={n.id}>
                <button onClick={() => void open(n)} disabled={opening === n.id}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-indigo-300 disabled:opacity-60">
                  <FileText className="h-5 w-5 shrink-0 text-indigo-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{n.original_name || n.filename || "File"}</span>
                    {n.uploader_name && <span className="block truncate text-xs text-slate-500">{n.uploader_name}</span>}
                  </span>
                  {opening === n.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <ExternalLink className="h-4 w-4 text-slate-400" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {assignments.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Assignments</h4>
          <ul className="space-y-2">
            {assignments.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{a.title}</span>
                  <span className="block text-xs text-slate-500">Due {fmtDay(a.due_date)}{a.max_points ? ` · ${a.max_points} marks` : ""}</span>
                </span>
                {isStudent && <Link to="/assignments" className="shrink-0 text-sm font-semibold text-indigo-600 hover:underline">Open</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const CourseDetailPage: React.FC<CourseDetailPageProps> = ({ user }) => {
  const { id } = useParams();
  const courseId = Number(id);
  const isStudent = user.role === "student";
  const [course, setCourse] = useState<CourseSummary | null | undefined>(undefined);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [exams, setExams] = useState<UpcomingExam[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = !!course && (user.role === "admin" || (user.role === "instructor" && course.instructor_id === user.id));

  const loadModules = useCallback(() =>
    api.getCourseModules(courseId)
      .then((m: any) => setModules(Array.isArray(m) ? m.map((x: any) => ({ id: x.id, name: x.name })) : [])),
  [courseId]);

  useEffect(() => {
    let live = true;
    setCourse(undefined); setError("");
    api.getCourses()
      .then(list => {
        if (!live) return;
        const found = (Array.isArray(list) ? list : []).find(c => c.id === courseId) ?? null;
        setCourse(found);
        if (!found) return;
        loadModules().catch(e => live && setError(e.message || "Could not load modules"));
        api.getUpcomingExams(120)
          .then(x => { if (live) setExams((Array.isArray(x) ? x : []).filter(e => e.course_id === courseId)); })
          .catch(() => undefined);
      })
      .catch(e => { if (live) { setCourse(null); setError(e.message || "Could not load this course"); } });
    return () => { live = false; };
  }, [courseId, loadModules]);

  const addModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.createModule(courseId, newName.trim(), "");
      setNewName(""); setAdding(false);
      await loadModules();
      toast.success("Module added");
    } catch (err: any) {
      toast.error(err.message || "Could not add the module");
    } finally {
      setSaving(false);
    }
  };

  if (course === undefined) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  }
  if (course === null) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-xl font-bold text-slate-900">Course not found</h1>
        <p className="mt-2 text-sm text-slate-600">{error || "You don't have access to this course, or it no longer exists."}</p>
        <Link to="/courses" className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:underline">Back to courses</Link>
      </div>
    );
  }

  const active = modules.find(m => m.id === openId) ?? modules[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <Toaster position="top-right" />
      <div className="mb-8">
        <Link to="/courses" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition-colors hover:text-indigo-600">
          <ArrowLeft className="h-4 w-4" /> Courses
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          {course.code && <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">{course.code}</span>}
          {course.instructor_name && <span>{course.instructor_name}</span>}
          {course.semester && <span>Semester {course.semester}</span>}
        </div>
        <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">{course.name}</h1>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-labelledby="modules-title">
          <div className="flex items-center justify-between">
            <h2 id="modules-title" className="text-xl font-bold text-slate-900">Modules</h2>
            {canManage && !adding && (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                <Plus className="h-4 w-4" /> Add module
              </button>
            )}
          </div>

          {adding && (
            <form onSubmit={addModule} className="rounded-3xl border border-indigo-200 bg-white p-5 shadow-sm">
              <label className="block text-sm font-medium text-slate-700" htmlFor="new-module">Module name</label>
              <input id="new-module" value={newName} onChange={e => setNewName(e.target.value)} autoFocus maxLength={200}
                placeholder="Unit 3: Normalisation"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setAdding(false); setNewName(""); }} className="px-3 py-2 text-sm font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={saving || !newName.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {saving ? "Adding…" : "Add module"}
                </button>
              </div>
            </form>
          )}

          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {modules.length === 0 && !error ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-600">
              {canManage ? "Add the course's units as modules, then upload notes to each one." : "Your professor hasn't added any modules yet."}
            </div>
          ) : (
            modules.map((m, i) => {
              const isOpen = openId === m.id;
              return (
                <div key={m.id} className={`overflow-hidden rounded-3xl border bg-white transition-shadow ${isOpen ? "border-indigo-300 shadow-md" : "border-slate-200 shadow-sm"}`}>
                  <button onClick={() => setOpenId(isOpen ? null : m.id)} aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 p-5 text-left">
                    <span className="flex min-w-0 items-center gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">{i + 1}</span>
                      <span className="truncate font-semibold text-slate-900">{m.name}</span>
                    </span>
                    <ChevronRight className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && <ModuleBody module={m} isStudent={isStudent} />}
                </div>
              );
            })
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="exams-title">
            <h2 id="exams-title" className="mb-3 flex items-center gap-2 font-bold text-slate-900"><CalendarDays className="h-5 w-5 text-indigo-500" /> Upcoming exams</h2>
            {exams.length === 0 ? (
              <p className="text-sm text-slate-500">No exam scheduled for this course.</p>
            ) : (
              <ul className="space-y-3">
                {exams.slice(0, 5).map(e => (
                  <li key={e.id} className="text-sm">
                    <span className="block font-semibold text-slate-900">{e.title}</span>
                    <span className="block text-slate-600">
                      {fmtDay(e.exam_date)}{e.start_time ? `, ${e.start_time}` : e.session ? ` (${e.session})` : ""}{e.venue ? ` · ${e.venue}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/exams" className="mt-4 inline-block text-sm font-semibold text-indigo-600 hover:underline">All exams</Link>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 font-bold text-slate-900">Shortcuts</h2>
            <div className="space-y-2">
              {isStudent ? (
                <>
                  <Link to="/marks" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><GraduationCap className="h-4 w-4 text-indigo-500" /> My marks</Link>
                  <Link to="/assignments" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><ClipboardList className="h-4 w-4 text-indigo-500" /> My assignments</Link>
                </>
              ) : (
                <>
                  <Link to="/assessments" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><ClipboardList className="h-4 w-4 text-indigo-500" /> Enter marks</Link>
                  <Link to="/notes" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Upload className="h-4 w-4 text-indigo-500" /> Upload notes</Link>
                </>
              )}
            </div>
            {!isStudent && <p className="mt-3 text-xs text-slate-500">{course.student_count} {course.student_count === 1 ? "student" : "students"} enrolled</p>}
          </section>
        </aside>
      </div>

      <ChatBot moduleId={active?.id} moduleTitle={active?.name ?? course.name} />
    </div>
  );
};
