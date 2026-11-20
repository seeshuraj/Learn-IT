import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, ChevronDown, ChevronRight, GraduationCap, Minus, Search, Users, X } from 'lucide-react';
import {
  api, type CollegePerformance, type PerformanceRollUp, type StudentMarks, type StudentPerformance,
  type StudentPerformanceQuery, type SubjectPerformance, type TopicAvg,
} from '../services/api';
import { TopicMastery } from '../components/TopicMastery';

type Tab = 'departments' | 'professors' | 'students';
type DeptFilter = 'all' | 'none' | number;

const PAGE = 50;
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
const pctTone = (n: number | null | undefined) =>
  n === null || n === undefined ? 'text-slate-400' : n < 50 ? 'text-red-600' : n < 75 ? 'text-amber-600' : 'text-emerald-600';
const fmtHours = (h: number | null) => (h === null ? '—' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

function Pct({ value }: { value: number | null | undefined }) {
  return <span className={`font-semibold tabular-nums ${pctTone(value)}`}>{fmtPct(value)}</span>;
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function WeakTopics({ topics }: { topics: TopicAvg[] }) {
  if (!topics.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <ul className="space-y-0.5">
      {topics.map(t => (
        <li key={t.topic} className="text-xs text-slate-600 flex gap-1.5 min-w-0">
          <span className={`tabular-nums shrink-0 ${pctTone(t.avg_pct)}`}>{fmtPct(t.avg_pct)}</span>
          <span className="truncate" title={t.topic}>{t.topic}</span>
        </li>
      ))}
    </ul>
  );
}

const taught = (r: { modules?: number; notes?: number; materials?: number; assignments: number; assessments: number }) =>
  `${r.materials ?? (r.modules ?? 0) + (r.notes ?? 0)} units & notes · ${r.assignments} assignments · ${r.assessments} assessments`;

function Empty({ children }: { children: ReactNode }) {
  return <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">{children}</div>;
}

// ── Departments ─────────────────────────────────────────────────────────────
function DepartmentsView({ data, onPick }: { data: CollegePerformance; onPick: (id: DeptFilter) => void }) {
  const rows = [
    ...data.departments.map(d => ({ key: d.id as DeptFilter, code: d.code, name: d.name, students: d.students, professors: d.professors, subjects: d.subjects, of_students: d.of_students })),
    ...(data.unassigned ? [{ key: 'none' as DeptFilter, code: '—', name: 'No department', students: null, professors: null, subjects: data.unassigned.subjects, of_students: data.unassigned.of_students }] : []),
  ];
  if (!rows.length) return <Empty>No departments yet. Add them in Course Management, then place courses and people in them.</Empty>;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm" data-testid="department-table">
        <thead className="bg-slate-50 text-xs text-slate-500 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium text-right">Students</th>
            <th className="px-4 py-3 font-medium text-right">Professors</th>
            <th className="px-4 py-3 font-medium text-right">Subjects</th>
            <th className="px-4 py-3 font-medium text-right" title="Average score in the department's subjects">Subject avg</th>
            <th className="px-4 py-3 font-medium text-right">Pass rate</th>
            <th className="px-4 py-3 font-medium text-right" title="The department's own students, in every subject they wrote">Students' avg</th>
            <th className="px-4 py-3 font-medium text-right">At risk</th>
            <th className="px-4 py-3 font-medium">Weakest topics</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={String(r.key)} className="hover:bg-slate-50 cursor-pointer" onClick={() => onPick(r.key)}>
              <td className="px-4 py-3">
                <button type="button" className="text-left font-medium text-teal-700 hover:underline" onClick={e => { e.stopPropagation(); onPick(r.key); }}>
                  {r.name}
                </button>
                <p className="text-xs text-slate-400 font-mono">{r.code}</p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{r.students ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.professors ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.subjects?.courses ?? 0}</td>
              <td className="px-4 py-3 text-right"><Pct value={r.subjects?.avg_pct} /></td>
              <td className="px-4 py-3 text-right"><Pct value={r.subjects?.pass_rate} /></td>
              <td className="px-4 py-3 text-right"><Pct value={r.of_students.avg_pct} /></td>
              <td className="px-4 py-3 text-right tabular-nums">{r.subjects?.at_risk ? <span className="text-red-600 font-semibold">{r.subjects.at_risk}</span> : 0}</td>
              <td className="px-4 py-3 max-w-xs"><WeakTopics topics={r.subjects?.weak_topics ?? []} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentSummary({ name, subjects, students, professors, ofStudents }: {
  name: string; subjects: PerformanceRollUp | null; students: number | null; professors: number | null;
  ofStudents: { avg_pct: number | null; pass_rate: number | null; written: number };
}) {
  return (
    <section className="space-y-3" aria-label={`${name} summary`}>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Stat label="Students" value={students ?? '—'} />
        <Stat label="Professors" value={professors ?? '—'} />
        <Stat label="Subjects" value={subjects?.courses ?? 0} hint={subjects ? `${subjects.assessments} assessments published` : undefined} />
        <Stat label="Subject average" value={<Pct value={subjects?.avg_pct} />} hint={subjects?.written ? `${subjects.written} results` : 'No published results'} />
        <Stat label="Pass rate" value={<Pct value={subjects?.pass_rate} />} />
        <Stat label="Students' own average" value={<Pct value={ofStudents.avg_pct} />} hint="All subjects they wrote" />
        <Stat label="Students at risk" value={<span className={subjects?.at_risk ? 'text-red-600' : ''}>{subjects?.at_risk ?? 0}</span>} hint="Under 50% in a subject" />
      </div>
      {subjects && subjects.weak_topics.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500 mb-2">Weakest topics across the department's subjects</p>
          <WeakTopics topics={subjects.weak_topics} />
        </div>
      )}
    </section>
  );
}

// ── Subjects ────────────────────────────────────────────────────────────────
function SubjectTable({ courses, showProfessor = true }: { courses: SubjectPerformance[]; showProfessor?: boolean }) {
  if (!courses.length) return <p className="text-sm text-slate-500 px-4 py-3">No subjects.</p>;
  return (
    <table className="w-full text-sm" data-testid="subject-table">
      <thead className="text-xs text-slate-500 text-left">
        <tr>
          <th className="px-4 py-2 font-medium">Subject</th>
          {showProfessor && <th className="px-4 py-2 font-medium">Professor</th>}
          <th className="px-4 py-2 font-medium text-right">Enrolled</th>
          <th className="px-4 py-2 font-medium">What's been taught</th>
          <th className="px-4 py-2 font-medium text-right">Class avg</th>
          <th className="px-4 py-2 font-medium text-right">Pass rate</th>
          <th className="px-4 py-2 font-medium text-right">At risk</th>
          <th className="px-4 py-2 font-medium">Grading</th>
          <th className="px-4 py-2 font-medium">Weakest topics</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {courses.map(c => (
          <tr key={c.id} data-subject={c.code}>
            <td className="px-4 py-2.5">
              <p className="font-medium text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-400 font-mono">{c.code}{c.semester ? ` · Sem ${c.semester}` : ''}</p>
            </td>
            {showProfessor && <td className="px-4 py-2.5 text-slate-600">{c.instructor_name ?? <span className="text-slate-400">Unassigned</span>}</td>}
            <td className="px-4 py-2.5 text-right tabular-nums">{c.enrolled}</td>
            <td className="px-4 py-2.5 text-xs text-slate-600">{taught(c)}</td>
            <td className="px-4 py-2.5 text-right"><Pct value={c.avg_pct} /></td>
            <td className="px-4 py-2.5 text-right"><Pct value={c.pass_rate} /></td>
            <td className="px-4 py-2.5 text-right tabular-nums">{c.at_risk ? <span className="text-red-600 font-semibold">{c.at_risk}</span> : 0}</td>
            <td className="px-4 py-2.5 text-xs text-slate-600">
              {c.submissions ? <>{c.graded}/{c.submissions} graded · {fmtHours(c.avg_turnaround_hours)}{c.pending ? <span className="text-amber-700"> · {c.pending} waiting</span> : null}</> : '—'}
            </td>
            <td className="px-4 py-2.5 max-w-xs"><WeakTopics topics={c.weak_topics} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Professors ──────────────────────────────────────────────────────────────
function ProfessorsView({ data, dept }: { data: CollegePerformance; dept: DeptFilter }) {
  const [open, setOpen] = useState<number | null>(null);
  const inDept = (c: SubjectPerformance) => dept === 'all' || (dept === 'none' ? c.department_id === null : c.department_id === dept);
  const profs = data.professors
    .map(p => ({ ...p, list: data.courses.filter(c => c.instructor_id === p.id && inDept(c)) }))
    .filter(p => dept === 'all' || p.list.length > 0 || (typeof dept === 'number' && p.department_id === dept))
    .sort((a, b) => (a.subjects?.avg_pct ?? 101) - (b.subjects?.avg_pct ?? 101) || String(a.name).localeCompare(String(b.name)));
  const unassigned = data.courses.filter(c => !c.instructor_id && inDept(c));
  if (!profs.length && !unassigned.length) return <Empty>No professors or subjects in this department.</Empty>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm" data-testid="professor-table">
        <thead className="bg-slate-50 text-xs text-slate-500 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Professor</th>
            <th className="px-4 py-3 font-medium text-right">Subjects</th>
            <th className="px-4 py-3 font-medium text-right">Enrolments</th>
            <th className="px-4 py-3 font-medium">What's been taught</th>
            <th className="px-4 py-3 font-medium text-right">Class avg</th>
            <th className="px-4 py-3 font-medium text-right">Pass rate</th>
            <th className="px-4 py-3 font-medium">Grading</th>
          </tr>
        </thead>
        {profs.map(p => {
          // Figures for the department in view, not every subject they teach.
          const r = dept === 'all' ? p.subjects : rollUpClient(p.list);
          const isOpen = open === p.id;
          return (
            <tbody key={p.id} className="border-t border-slate-100">
              <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(isOpen ? null : p.id)} data-professor={p.name ?? ''}>
                <td className="px-4 py-3">
                  <button type="button" aria-expanded={isOpen} className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    {p.name ?? 'Unnamed'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r?.courses ?? 0}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r?.enrolled ?? 0}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{r ? taught(r) : '—'}</td>
                <td className="px-4 py-3 text-right"><Pct value={r?.avg_pct} /></td>
                <td className="px-4 py-3 text-right"><Pct value={r?.pass_rate} /></td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {r?.submissions ? <>{r.graded}/{r.submissions} graded · avg {fmtHours(r.avg_turnaround_hours)}{r.pending ? <span className="text-amber-700"> · {r.pending} waiting</span> : null}</> : '—'}
                </td>
              </tr>
              {isOpen && (
                <tr><td colSpan={7} className="bg-slate-50/60 p-0"><SubjectTable courses={p.list} showProfessor={false} /></td></tr>
              )}
            </tbody>
          );
        })}
        {unassigned.length > 0 && (
          <tbody className="border-t border-slate-100">
            <tr><td colSpan={7} className="px-4 py-3 text-xs font-medium text-amber-700">Subjects with no professor</td></tr>
            <tr><td colSpan={7} className="p-0"><SubjectTable courses={unassigned} showProfessor={false} /></td></tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

/** Same weighting as the server's roll-up, for a professor's subjects within one department. */
function rollUpClient(list: SubjectPerformance[]): PerformanceRollUp | null {
  if (!list.length) return null;
  const sum = (f: (c: SubjectPerformance) => number) => list.reduce((s, c) => s + (f(c) || 0), 0);
  const written = sum(c => c.written);
  const pctSum = sum(c => (c.avg_pct ?? 0) * c.written);
  const timed = sum(c => c.timed);
  return {
    courses: list.length, enrolled: sum(c => c.enrolled), materials: sum(c => c.modules + c.notes),
    assignments: sum(c => c.assignments), assessments: sum(c => c.assessments), written,
    absent: sum(c => c.absent), at_risk: sum(c => c.at_risk),
    avg_pct: written ? Math.round((pctSum / written) * 10) / 10 : null,
    pass_rate: written ? Math.round((1000 * sum(c => c.passed)) / written) / 10 : null,
    submissions: sum(c => c.submissions), graded: sum(c => c.graded), pending: sum(c => c.pending),
    avg_turnaround_hours: timed ? Math.round((sum(c => (c.avg_turnaround_hours ?? 0) * c.timed) / timed) * 10) / 10 : null,
    weak_topics: [],
  };
}

// ── Students ────────────────────────────────────────────────────────────────
function TrendIcon({ trend }: { trend: StudentPerformance['trend'] }) {
  if (trend === 'up') return <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" aria-label="Improving" />;
  if (trend === 'down') return <ArrowDownRight className="w-3.5 h-3.5 text-red-600" aria-label="Dropped" />;
  if (trend === 'same') return <Minus className="w-3.5 h-3.5 text-slate-400" aria-label="Steady" />;
  return null;
}

function StudentsView({ dept, years }: { dept: DeptFilter; years: number[] }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState<number | ''>('');
  const [sort, setSort] = useState<NonNullable<StudentPerformanceQuery['sort']>>('avg_asc');
  const [atRisk, setAtRisk] = useState(false);
  const [rows, setRows] = useState<StudentPerformance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<StudentPerformance | null>(null);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const load = (offset: number) => {
    const n = ++seq.current;
    setLoading(true);
    setError('');
    api.getStudentPerformance({
      department_id: dept === 'all' ? undefined : dept, year: year || undefined, q: search || undefined,
      sort, at_risk: atRisk, limit: PAGE, offset,
    })
      .then(r => { if (n !== seq.current) return; setTotal(r.total); setRows(prev => (offset ? [...prev, ...r.students] : r.students)); })
      .catch((e: any) => { if (n === seq.current) setError(e?.message || "Couldn't load students."); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  };
  useEffect(() => { load(0); }, [dept, year, search, sort, atRisk]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="relative flex-1 min-w-[12rem] max-w-sm">
          <span className="sr-only">Search students</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </label>
        <select aria-label="Year of study" value={year} onChange={e => setYear(e.target.value ? Number(e.target.value) : '')}
          className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white">
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>Year {y}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as any)} className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white">
          <option value="avg_asc">Lowest average first</option>
          <option value="avg_desc">Highest average first</option>
          <option value="latest_asc">Lowest latest score first</option>
          <option value="name">Name</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 px-2">
          <input type="checkbox" checked={atRisk} onChange={e => setAtRisk(e.target.checked)} className="rounded border-slate-300 text-teal-600" />
          At risk only
        </label>
        <span className="ml-auto text-xs text-slate-500">{total} student{total === 1 ? '' : 's'}</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && rows.length === 0 ? (
        <Empty>{atRisk ? 'No students at risk here.' : 'No students match.'}</Empty>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm" data-testid="student-table">
            <thead className="bg-slate-50 text-xs text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium text-right">Subjects</th>
                <th className="px-4 py-3 font-medium text-right">Assessments</th>
                <th className="px-4 py-3 font-medium text-right">Average</th>
                <th className="px-4 py-3 font-medium text-right">Latest</th>
                <th className="px-4 py-3 font-medium text-right">Absent</th>
                <th className="px-4 py-3 font-medium text-right">Assignments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(s)}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="font-medium text-teal-700 hover:underline text-left" onClick={e => { e.stopPropagation(); setOpen(s); }}>{s.name}</button>
                    {s.at_risk && <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded"><AlertTriangle className="w-3 h-3" />At risk</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{s.department_code ?? '—'}{s.year_of_study ? ` · Year ${s.year_of_study}` : ''}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.courses}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.written}</td>
                  <td className="px-4 py-2.5 text-right"><Pct value={s.avg_pct} /></td>
                  <td className="px-4 py-2.5 text-right"><span className="inline-flex items-center gap-1 justify-end"><TrendIcon trend={s.trend} /><Pct value={s.latest_pct} /></span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.absent ? <span className="text-amber-700">{s.absent}</span> : 0}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{s.assignments ? `${s.submitted}/${s.assignments}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>}
          {!loading && rows.length < total && (
            <button type="button" onClick={() => load(rows.length)} className="w-full px-4 py-2.5 text-sm font-medium text-teal-700 hover:bg-slate-50 border-t border-slate-100">
              Show {Math.min(PAGE, total - rows.length)} more
            </button>
          )}
        </div>
      )}

      <AnimatePresence>{open && <StudentPanel student={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

function StudentPanel({ student, onClose }: { student: StudentPerformance; onClose: () => void }) {
  const [data, setData] = useState<StudentMarks | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.getStudentExamInsights(student.id).then(setData).catch((e: any) => setError(e?.message || "Couldn't load this student."));
  }, [student.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${student.name}'s performance`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-medium">{student.department_code ?? 'No department'}{student.year_of_study ? ` · Year ${student.year_of_study}` : ''}</p>
            <h2 className="text-sm font-bold text-slate-900 truncate">{student.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Average" value={<Pct value={student.avg_pct} />} />
            <Stat label="Assessments" value={student.written} hint={student.absent ? `${student.absent} absent` : undefined} />
            <Stat label="Assignments" value={student.assignments ? `${student.submitted}/${student.assignments}` : '—'} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />}
          {data && (
            <>
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-50">
                <h3 className="px-5 py-3 text-sm font-semibold text-slate-800">Assessments</h3>
                {data.results.length === 0 && <p className="px-5 py-3 text-sm text-slate-500">No published marks yet.</p>}
                {data.results.map(r => (
                  <div key={r.exam_id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate"><span className="text-xs font-mono text-slate-500 mr-2">{r.course_code}</span>{r.exam_title}</span>
                    {r.is_absent ? <span className="text-xs text-slate-500">Absent</span> : <Pct value={r.percentage === null ? null : Number(r.percentage)} />}
                  </div>
                ))}
              </section>
              <TopicMastery topics={data.topics ?? []} title="Topic mastery" />
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AdminPerformancePage() {
  const [data, setData] = useState<CollegePerformance | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('departments');
  const [dept, setDept] = useState<DeptFilter>('all');
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    api.getCollegePerformance().then(setData).catch((e: any) => setError(e?.message || "Couldn't load performance."));
  }, []);
  useEffect(() => {
    const sem = (data?.courses ?? []).map(c => c.semester).filter((s): s is number => !!s);
    setYears([...new Set(sem.map(s => Math.ceil(s / 2)))].sort((a, b) => a - b));
  }, [data]);

  const selected = typeof dept === 'number' ? data?.departments.find(d => d.id === dept) : null;
  const deptCourses = useMemo(
    () => (data?.courses ?? []).filter(c => dept === 'all' || (dept === 'none' ? c.department_id === null : c.department_id === dept)),
    [data, dept],
  );

  const pickDept = (d: DeptFilter) => { setDept(d); if (tab === 'departments' && d !== 'all') window.scrollTo({ top: 0 }); };

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'departments', label: 'Departments', icon: Building2 },
    { id: 'professors', label: 'Professors & subjects', icon: GraduationCap },
    { id: 'students', label: 'Students', icon: Users },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Performance</h1>
          <p className="text-sm text-slate-500">Published assessment results, what's been taught and grading, by department, professor and student.</p>
        </div>
        <label className="text-sm text-slate-600 flex items-center gap-2">
          Department
          <select aria-label="Department" value={String(dept)}
            onChange={e => setDept(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white min-w-[12rem]">
            <option value="all">All departments</option>
            {(data?.departments ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            {data?.unassigned && <option value="none">No department</option>}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="Performance views" className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && tab !== 'students' && (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      )}

      {data && tab === 'departments' && (
        dept === 'all' ? <DepartmentsView data={data} onPick={pickDept} /> : (
          <div className="space-y-5">
            <DepartmentSummary
              name={selected?.name ?? 'No department'}
              subjects={selected ? selected.subjects : data.unassigned?.subjects ?? null}
              students={selected ? selected.students : null}
              professors={selected ? selected.professors : null}
              ofStudents={selected ? selected.of_students : data.unassigned?.of_students ?? { written: 0, avg_pct: null, pass_rate: null }}
            />
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
              <h2 className="px-4 pt-4 pb-1 text-sm font-semibold text-slate-800">Subjects</h2>
              <SubjectTable courses={deptCourses} />
            </section>
          </div>
        )
      )}
      {data && tab === 'professors' && <ProfessorsView data={data} dept={dept} />}
      {tab === 'students' && <StudentsView dept={dept} years={years} />}
    </div>
  );
}
