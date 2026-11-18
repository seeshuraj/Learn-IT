import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { api, type Assessment, type MarksPreview, type QuestionMark, type QuestionPattern, type RosterStudent } from '../../services/api';
import { parseCell, scoreQuestions } from '../../server/lib/questionPattern';
import { fmtNum, isSplit } from './shared';

/**
 * Marks entry grid: one row per enrolled student. Edits save automatically a
 * moment after typing stops (and on leaving the page's last field). Enter /
 * ↓ / ↑ move between students in the same column, like a spreadsheet.
 *
 * Question-wise assessments get one column per question, grouped by part;
 * Enter moves along the row (Q1 → Q2 …) and on to the next student, and the
 * row total is worked out as you type. Either/or cells take "12b".
 */

interface Row {
  student: RosterStudent;
  marks: string;
  internal: string;
  external: string;
  absent: boolean;
  grade: string;          // '' = worked out from marks
  q: Record<string, string>; // question-wise cells, as typed
  rev: number;            // bumped on every edit
  savedRev: number;       // rev last saved
  serverError: string | null;
  result: { percentage: string | null; grade: string | null };
}

type SaveState = 'idle' | 'saving' | 'error';

const AUTOSAVE_MS = 1200;

/** A stored question mark as the professor would type it. */
const cellText = (m: QuestionMark | undefined) =>
  m === undefined || m === null ? '' : typeof m === 'number' ? fmtNum(m) : `${fmtNum(m.m)}${m.o === 'b' ? 'b' : ''}`;

function fromStudent(s: RosterStudent): Row {
  return {
    q: Object.fromEntries(Object.entries(s.question_marks ?? {}).map(([k, v]) => [k, cellText(v)])),
    student: s,
    marks: fmtNum(s.marks_obtained),
    internal: fmtNum(s.internal_marks),
    external: fmtNum(s.external_marks),
    absent: !!s.is_absent,
    grade: '',
    rev: 0,
    savedRev: 0,
    serverError: null,
    result: { percentage: s.percentage, grade: s.grade },
  };
}

function checkMark(label: string, v: string, max: number): string | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0 || n > max) return `${label} must be 0–${max}`;
  return null;
}

/** Questions of a pattern in paper order, with their part. */
const questionsOf = (p: QuestionPattern) => p.parts.flatMap(part => part.questions.map(q => ({ ...q, part: part.key })));

/** Parse a row's cells; total is null when every cell is blank. */
function rowScore(r: Row, p: QuestionPattern): { total: number | null; error: string | null; marks: Record<string, QuestionMark> } {
  const marks: Record<string, QuestionMark> = {};
  for (const q of questionsOf(p)) {
    const c = parseCell(r.q[q.no] ?? '', q.either_or);
    if ('error' in c) return { total: null, error: `Q${q.no}: ${c.error}`, marks };
    if (c.mark !== null) marks[q.no] = c.mark;
  }
  if (!Object.keys(marks).length) return { total: null, error: null, marks };
  const s = scoreQuestions(p, marks);
  return 'error' in s ? { total: null, error: s.error, marks } : { total: s.total, error: null, marks };
}

/** Quick check before sending; the server applies the full rules. */
function clientError(r: Row, exam: Assessment): string | null {
  if (r.absent) return null;
  if (exam.question_pattern) {
    const sc = rowScore(r, exam.question_pattern);
    if (sc.error) return sc.error;
    if (isSplit(exam)) {
      const i = r.internal.trim();
      if ((i === '') !== (sc.total === null)) return 'Enter internal marks and the question marks';
      return checkMark('Internal', i, Number(exam.internal_max));
    }
    return null;
  }
  if (isSplit(exam)) {
    const i = r.internal.trim(), e = r.external.trim();
    if ((i === '') !== (e === '')) return 'Enter both internal and external';
    return checkMark('Internal', i, Number(exam.internal_max)) ?? checkMark('External', e, Number(exam.external_max));
  }
  return checkMark('Marks', r.marks, Number(exam.max_marks));
}

const isBlank = (r: Row, split: boolean) =>
  !r.absent && (split ? r.internal.trim() === '' && r.external.trim() === '' : r.marks.trim() === '')
  && Object.values(r.q).every(v => v.trim() === '');

export function MarksGrid({ exam, onCountsChange }: {
  exam: Assessment;
  onCountsChange?: (entered: number) => void;
}) {
  const split = isSplit(exam);
  const pattern = exam.question_pattern ?? null;
  const questions = useMemo(() => (pattern ? questionsOf(pattern) : []), [pattern]);
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<MarksPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(() => {
    setLoading(true); setLoadError('');
    api.getExamRoster(exam.id)
      .then(d => { setRows(d.students.map(fromStudent)); setGrades(d.grades); })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [exam.id]);

  useEffect(load, [load]);

  const pending = rows.filter(r => r.rev !== r.savedRev);
  const blocked = pending.filter(r => r.serverError || clientError(r, exam));
  const entered = rows.filter(r => r.student.is_absent || r.student.marks_obtained !== null).length;
  useEffect(() => { onCountsChange?.(entered); }, [entered]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (inFlight.current) return;
    const current = rowsRef.current;
    const toSend = current.filter(r => r.rev !== r.savedRev && !r.serverError && !clientError(r, exam));
    if (toSend.length === 0) return;
    const sentRevs = new Map(toSend.map(r => [r.student.student_id, r.rev]));
    inFlight.current = true;
    setSaveState('saving'); setSaveError('');
    try {
      const res = await api.saveExamResults(exam.id, toSend.map(r => ({
        student_id: r.student.student_id,
        absent: r.absent,
        marks: split || pattern ? null : r.marks.trim() || null,
        internal: split ? r.internal.trim() || null : null,
        external: split && !pattern ? r.external.trim() || null : null,
        grade: r.grade || null,
        ...(pattern ? { questions: Object.fromEntries(questions.map(q => [q.no, (r.q[q.no] ?? '').trim() || null])) } : {}),
      })));
      const saved = new Map(res.saved.map((s: any) => [s.student_id, s]));
      setRows(prev => prev.map(r => {
        const rev = sentRevs.get(r.student.student_id);
        if (rev === undefined) return r;
        const s: any = saved.get(r.student.student_id);
        const student = {
          ...r.student,
          marks_obtained: s?.marks_obtained ?? null,
          is_absent: s?.is_absent ?? false,
        } as RosterStudent;
        return {
          ...r, student, savedRev: rev,
          result: s ? { percentage: s.percentage, grade: s.grade } : { percentage: null, grade: null },
        };
      }));
      setSaveState('idle');
    } catch (e: any) {
      const perRow: { student_id: number; error: string }[] | undefined = e.body?.results;
      if (e.status === 422 && perRow?.length) {
        const errs = new Map(perRow.map(x => [x.student_id, x.error]));
        setRows(prev => prev.map(r => errs.has(r.student.student_id) ? { ...r, serverError: errs.get(r.student.student_id)! } : r));
        setSaveState('idle'); // the autosave picks up the remaining rows
      } else {
        setSaveState('error');
        setSaveError(e.message || 'Could not save');
      }
    } finally {
      inFlight.current = false;
    }
  }, [exam, split]);

  // Autosave shortly after the last edit.
  useEffect(() => {
    if (pending.length === 0) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
  }, [rows, save]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving with unsaved marks.
  useEffect(() => {
    if (pending.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);

  const edit = (sid: number, patch: Partial<Pick<Row, 'marks' | 'internal' | 'external' | 'absent' | 'grade' | 'q'>>) => {
    setRows(prev => prev.map(r => r.student.student_id === sid ? { ...r, ...patch, rev: r.rev + 1, serverError: null } : r));
  };
  const editQ = (sid: number, no: string, v: string) =>
    setRows(prev => prev.map(r => r.student.student_id === sid ? { ...r, q: { ...r.q, [no]: v }, rev: r.rev + 1, serverError: null } : r));

  /** Question-wise: Enter / → go along the row, then to the next student; ↑ ↓ stay in the column. */
  const colOrder = useMemo(() => [...(split ? ['internal'] : []), ...questions.map(q => `q:${q.no}`)], [questions, split]);
  const moveQ = (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, col: string) => {
    const ci = colOrder.indexOf(col);
    let r = rowIndex, c = ci;
    const input = e.currentTarget as HTMLInputElement;
    const atEnd = input.selectionStart === input.value.length;
    if (e.key === 'Enter' || (e.key === 'ArrowRight' && atEnd)) { c = ci + 1; if (c >= colOrder.length) { c = 0; r = rowIndex + 1; } }
    else if (e.key === 'ArrowLeft' && input.selectionStart === 0) { c = ci - 1; if (c < 0) { c = colOrder.length - 1; r = rowIndex - 1; } }
    else if (e.key === 'ArrowDown') r = rowIndex + 1;
    else if (e.key === 'ArrowUp') r = rowIndex - 1;
    else return;
    e.preventDefault();
    const target = tableRef.current?.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${colOrder[c]}"]`);
    if (target) { target.focus(); (target as HTMLInputElement).select?.(); }
    else if (e.key === 'Enter') void save();
  };

  const move = (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, col: string) => {
    let next = rowIndex;
    if (e.key === 'Enter' || e.key === 'ArrowDown') next = rowIndex + 1;
    else if (e.key === 'ArrowUp') next = rowIndex - 1;
    else return;
    e.preventDefault();
    const target = tableRef.current?.querySelector<HTMLElement>(`[data-row="${next}"][data-col="${col}"]`);
    if (target) { target.focus(); (target as HTMLInputElement).select?.(); }
    else if (e.key === 'Enter') void save();
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => `${r.student.name ?? ''} ${r.student.email ?? ''}`.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const downloadTemplate = () => {
    const head = pattern
      ? ['email', 'name', ...(split ? ['internal'] : []), ...questions.map(q => `Q${q.no}`), 'absent']
      : split ? ['email', 'name', 'internal', 'external', 'absent'] : ['email', 'name', 'marks', 'absent'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [head.join(',')].concat(rows.map(r => {
      const vals = pattern ? [...(split ? [r.internal] : []), ...questions.map(q => r.q[q.no] ?? '')] : split ? [r.internal, r.external] : [r.marks];
      return [r.student.email ?? '', r.student.name ?? '', ...vals, r.absent ? 'AB' : ''].map(esc).join(',');
    }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `${(exam.course_code ?? 'course')}-${exam.title}`.replace(/[^\w.-]+/g, '_') + '.csv',
    });
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true); setImportError('');
    try { setPreview(await api.previewExamMarks(exam.id, file)); }
    catch (e: any) { setImportError(e.message); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const applyPreview = () => {
    if (!preview) return;
    const byId = new Map(preview.matched.map(m => [m.student_id, m]));
    setRows(prev => prev.map(r => {
      const m = byId.get(r.student.student_id);
      if (!m) return r;
      return {
        ...r,
        absent: !!m.absent,
        marks: m.absent ? '' : fmtNum(m.marks),
        internal: m.absent ? '' : fmtNum(m.internal),
        external: m.absent ? '' : fmtNum(m.external),
        grade: m.grade ? String(m.grade).toUpperCase() : r.grade,
        q: m.absent ? {} : m.questions
          ? Object.fromEntries(Object.entries(m.questions).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]))
          : r.q,
        rev: r.rev + 1,
        serverError: null,
      };
    }));
    setPreview(null);
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading students…</div>;
  if (loadError) return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle className="h-4 w-4 shrink-0" /> {loadError}
      <button onClick={load} className="ml-auto font-semibold underline">Try again</button>
    </div>
  );
  if (rows.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
      No students are enrolled in this course yet. Ask your college admin to enrol them, then come back to enter marks.
    </div>
  );

  const markCols = split
    ? [{ key: 'internal' as const, label: `Internal /${fmtNum(exam.internal_max)}` }, { key: 'external' as const, label: `External /${fmtNum(exam.external_max)}` }]
    : [{ key: 'marks' as const, label: `Marks /${fmtNum(exam.max_marks)}` }];

  return (
    <div className="space-y-4">
      {exam.published_at && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          These results are published. Changes you make are visible to students as soon as they save.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a student"
            aria-label="Find a student"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
          <Download className="h-4 w-4" /> Download sheet
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Import from file
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => void pickFile(e.target.files?.[0])} />
        <SaveStatus state={saveState} pending={pending.length} blocked={blocked.length} error={saveError} onRetry={() => void save()} />
      </div>

      {importError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{importError}</p>}

      {pattern ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table ref={tableRef} className="w-full text-sm" style={{ minWidth: `${16 + questions.length * 3.25 + (split ? 5 : 0) + 12}rem` }}>
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" rowSpan={2} className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left align-bottom">Student</th>
                {split && <th scope="col" rowSpan={2} className="w-20 px-1 py-2 text-center align-bottom">Internal<br /><span className="font-normal">/{fmtNum(exam.internal_max)}</span></th>}
                {pattern.parts.map(part => (
                  <th key={part.key} scope="colgroup" colSpan={part.questions.length}
                    className="border-l border-slate-200 px-1 pt-2 text-center">
                    {part.label}
                    <span className="block font-normal text-slate-500">
                      {part.answer_count ? `any ${part.answer_count} of ${part.questions.length}` : `${part.questions.length} × ${fmtNum(part.questions[0]?.marks)}`}
                      {part.questions.some(q => q.either_or) ? ', a/b' : ''}
                    </span>
                  </th>
                ))}
                <th scope="col" rowSpan={2} className="w-16 border-l border-slate-200 px-2 py-2 text-right align-bottom">Total</th>
                <th scope="col" rowSpan={2} className="w-14 px-1 py-2 text-center align-bottom">Absent</th>
                {grades.length > 0 && <th scope="col" rowSpan={2} className="w-20 px-1 py-2 align-bottom">Grade</th>}
                <th scope="col" rowSpan={2} className="w-20 px-3 py-2 text-right align-bottom">Result</th>
              </tr>
              <tr>
                {questions.map((q, qi) => (
                  <th key={q.no} scope="col"
                    className={`px-0.5 pb-2 pt-1 text-center font-medium ${qi === 0 || questions[qi - 1].part !== q.part ? 'border-l border-slate-200' : ''}`}>
                    Q{q.no}<span className="block text-[11px] font-normal text-slate-400">/{fmtNum(q.marks)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const err = r.serverError ?? clientError(r, exam);
                const unsaved = r.rev !== r.savedRev;
                const sid = r.student.student_id;
                const who = r.student.name ?? r.student.email;
                const sc = rowScore(r, pattern);
                const live = sc.total === null ? null : sc.total + (split ? Number(r.internal) || 0 : 0);
                return (
                  <tr key={sid} className={`border-t border-slate-100 ${err ? 'bg-red-50/60' : ''}`}>
                    <th scope="row" className={`sticky left-0 z-10 px-3 py-1.5 text-left font-normal ${err ? 'bg-red-50' : 'bg-white'}`}>
                      <span className="block max-w-[8.5rem] truncate font-medium text-slate-900 sm:max-w-[12rem]">{who}</span>
                      {err && <span className="block max-w-[8.5rem] text-xs text-red-700 sm:max-w-[12rem]">{err}</span>}
                    </th>
                    {split && (
                      <td className="px-1 py-1.5">
                        <input data-row={i} data-col="internal" inputMode="decimal" autoComplete="off"
                          aria-label={`Internal marks for ${who}`} value={r.internal} disabled={r.absent}
                          onChange={e => edit(sid, { internal: e.target.value })} onKeyDown={e => moveQ(e, i, 'internal')}
                          onBlur={() => void save()} className="w-full rounded-md border border-slate-200 bg-white px-1 py-1.5 text-center tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:bg-slate-100 disabled:text-slate-400" />
                      </td>
                    )}
                    {questions.map((q, qi) => {
                      const v = r.q[q.no] ?? '';
                      const c = parseCell(v, q.either_or);
                      const over = !('error' in c) && c.mark !== null && (typeof c.mark === 'number' ? c.mark : c.mark.m) > q.marks;
                      const bad = 'error' in c || over;
                      return (
                        <td key={q.no} className={`px-0.5 py-1.5 ${qi === 0 || questions[qi - 1].part !== q.part ? 'border-l border-slate-100' : ''}`}>
                          <input data-row={i} data-col={`q:${q.no}`} inputMode={q.either_or ? 'text' : 'decimal'} autoComplete="off"
                            aria-label={`Q${q.no} (out of ${fmtNum(q.marks)}${q.either_or ? ', a or b' : ''}) for ${who}`}
                            aria-invalid={bad} value={v} disabled={r.absent} maxLength={6}
                            onChange={e => editQ(sid, q.no, e.target.value)} onKeyDown={e => moveQ(e, i, `q:${q.no}`)}
                            onBlur={() => void save()}
                            className={`CELL min-w-[2.75rem] ${bad ? 'border-red-400 bg-red-50 text-red-800' : ''}`} />
                        </td>
                      );
                    })}
                    <td className="border-l border-slate-100 px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                      {r.absent ? '—' : live === null ? <span className="text-slate-300">—</span> : fmtNum(live)}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      <input type="checkbox" checked={r.absent} aria-label={`Absent: ${who}`}
                        onChange={e => edit(sid, { absent: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                    </td>
                    {grades.length > 0 && (
                      <td className="px-1 py-1.5">
                        <select value={r.grade} disabled={r.absent} aria-label={`Grade override for ${who}`}
                          onChange={e => edit(sid, { grade: e.target.value })}
                          className="w-full rounded-md border border-slate-200 bg-white px-1 py-1.5 text-sm disabled:bg-slate-100">
                          <option value="">Auto</option>
                          {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {unsaved
                        ? <span className="text-xs text-slate-400">{err ? 'Not saved' : 'Saving…'}</span>
                        : r.absent
                          ? <span className="font-medium text-slate-500">AB</span>
                          : r.result.percentage !== null && r.result.percentage !== undefined
                            ? <span className="text-slate-700">{r.result.grade ? <b className="mr-1.5 text-slate-900">{r.result.grade}</b> : null}{Number(r.result.percentage).toFixed(1)}%</span>
                            : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={questions.length + (split ? 1 : 0) + (grades.length ? 5 : 4)} className="py-10 text-center text-sm text-slate-500">No student matches “{search}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table ref={tableRef} className="w-full min-w-[30rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5">Student</th>
              {markCols.map(c => <th key={c.key} scope="col" className="w-28 px-2 py-2.5 text-right">{c.label}</th>)}
              <th scope="col" className="w-20 px-2 py-2.5 text-center">Absent</th>
              {grades.length > 0 && <th scope="col" className="w-24 px-2 py-2.5">Grade</th>}
              <th scope="col" className="w-24 px-3 py-2.5 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const err = r.serverError ?? clientError(r, exam);
              const unsaved = r.rev !== r.savedRev;
              const sid = r.student.student_id;
              return (
                <tr key={sid} className={`border-t border-slate-100 ${err ? 'bg-red-50/60' : ''}`}>
                  <th scope="row" className={`sticky left-0 z-10 px-3 py-1.5 text-left font-normal ${err ? 'bg-red-50' : 'bg-white'}`}>
                    <span className="block max-w-[8.5rem] truncate font-medium text-slate-900 sm:max-w-[14rem]">{r.student.name ?? r.student.email}</span>
                    {err
                      ? <span className="block max-w-[8.5rem] text-xs text-red-700 sm:max-w-[14rem]">{err}</span>
                      : <span className="hidden max-w-[14rem] truncate text-xs text-slate-500 sm:block">{r.student.email}</span>}
                  </th>
                  {markCols.map(c => (
                    <td key={c.key} className="px-2 py-1.5">
                      <input
                        data-row={i} data-col={c.key}
                        inputMode="decimal" autoComplete="off"
                        aria-label={`${c.label} for ${r.student.name ?? r.student.email}`}
                        aria-invalid={!!err}
                        value={r[c.key]} disabled={r.absent}
                        onChange={e => edit(sid, { [c.key]: e.target.value })}
                        onKeyDown={e => move(e, i, c.key)}
                        onBlur={() => void save()}
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-right tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" data-row={i} data-col="absent" checked={r.absent}
                      aria-label={`Absent: ${r.student.name ?? r.student.email}`}
                      onChange={e => edit(sid, { absent: e.target.checked })}
                      onKeyDown={e => move(e, i, 'absent')}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                  </td>
                  {grades.length > 0 && (
                    <td className="px-2 py-1.5">
                      <select data-row={i} data-col="grade" value={r.grade} disabled={r.absent}
                        aria-label={`Grade override for ${r.student.name ?? r.student.email}`}
                        onChange={e => edit(sid, { grade: e.target.value })}
                        className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-sm disabled:bg-slate-100">
                        <option value="">Auto</option>
                        {grades.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {unsaved
                      ? <span className="text-xs text-slate-400">{err ? 'Not saved' : 'Saving…'}</span>
                      : r.absent
                        ? <span className="font-medium text-slate-500">AB</span>
                        : r.result.percentage !== null && r.result.percentage !== undefined
                          ? <span className="text-slate-700">{r.result.grade ? <b className="mr-1.5 text-slate-900">{r.result.grade}</b> : null}{Number(r.result.percentage).toFixed(1)}%</span>
                          : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={markCols.length + (grades.length ? 4 : 3)} className="py-10 text-center text-sm text-slate-500">No student matches “{search}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      <p className="text-xs text-slate-500">
        {pattern
          ? <>Marks save automatically. Enter moves to the next question, then the next student; ↑ ↓ stay in a column. For (a)/(b) questions type the mark and the option, like <b>12b</b> (a plain number means (a)). Blank means not answered.</>
          : 'Marks save automatically. Press Enter or ↓ for the next student. Leave a row empty to clear it.'}
      </p>

      {preview && (
        <ImportPreview preview={preview} total={rows.length} onCancel={() => setPreview(null)} onApply={applyPreview} />
      )}
    </div>
  );
}

function SaveStatus({ state, pending, blocked, error, onRetry }: {
  state: SaveState; pending: number; blocked: number; error: string; onRetry: () => void;
}) {
  let body: React.ReactNode;
  if (state === 'error') {
    body = <span className="inline-flex items-center gap-1.5 text-red-700"><AlertCircle className="h-4 w-4" /> {error}
      <button onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw className="h-3.5 w-3.5" /> Retry</button></span>;
  } else if (state === 'saving') {
    body = <span className="inline-flex items-center gap-1.5 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span>;
  } else if (blocked > 0) {
    body = <span className="inline-flex items-center gap-1.5 text-red-700"><AlertCircle className="h-4 w-4" /> {blocked} {blocked === 1 ? 'row needs' : 'rows need'} fixing</span>;
  } else if (pending > 0) {
    body = <span className="text-slate-500">{pending} unsaved</span>;
  } else {
    body = <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> All changes saved</span>;
  }
  return <div className="ml-auto text-sm" role="status" aria-live="polite">{body}</div>;
}

function ImportPreview({ preview, total, onCancel, onApply }: {
  preview: MarksPreview; total: number; onCancel: () => void; onApply: () => void;
}) {
  const withErrors = preview.matched.filter(m => m.error);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="import-title" className="text-lg font-bold text-slate-900">Check the file before filling the grid</h2>
          <button onClick={onCancel} className="rounded-lg p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li><b className="tabular-nums">{preview.matched.length}</b> of {total} students found in the file</li>
          {preview.missing > 0 && <li><b className="tabular-nums">{preview.missing}</b> enrolled {preview.missing === 1 ? "student isn't" : "students aren't"} in the file; their marks stay as they are</li>}
          {withErrors.length > 0 && <li className="text-red-700"><b className="tabular-nums">{withErrors.length}</b> {withErrors.length === 1 ? 'row has values' : 'rows have values'} to fix; they'll be highlighted in the grid</li>}
          {preview.problems_total > 0 && <li className="text-amber-800"><b className="tabular-nums">{preview.problems_total}</b> {preview.problems_total === 1 ? "row couldn't" : "rows couldn't"} be matched and will be skipped</li>}
        </ul>
        {preview.problems.length > 0 && (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {preview.problems.map(p => <p key={p.row}>Row {p.row}: {p.reason}</p>)}
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">
          The file needs an <b>email</b> (or student_id) column and a <b>marks</b> column, or <b>internal</b> and <b>external</b>, or for question-wise papers <b>Q1</b>, <b>Q2</b>… columns (“Download sheet” gives you the layout). “AB” means absent.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">Cancel</button>
          <button onClick={onApply} disabled={preview.matched.length === 0}
            className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            Fill {preview.matched.length} students
          </button>
        </div>
      </div>
    </div>
  );
}
