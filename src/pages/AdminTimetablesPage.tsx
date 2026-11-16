/**
 * AdminTimetablesPage — upload an exam timetable (Excel/CSV, image or PDF),
 * check every row, publish. Publishing schedules each exam for its course's
 * professor (a draft assessment with the date) and notifies students.
 *
 * Route: /admin/timetables (admin)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Download, ExternalLink, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  api, type AssessmentType, type Department, type TimetableDetail, type TimetableEntry, type TimetableSummary,
} from '../services/api';
import { TYPE_LABELS, TYPE_ORDER, fmtDate } from '../components/assessments/shared';

interface Course { id: number; code: string; name: string }

const STATUS: Record<TimetableSummary['status'], { label: string; cls: string }> = {
  extracting: { label: 'Reading file…', cls: 'bg-sky-100 text-sky-800' },
  draft:      { label: 'Draft',         cls: 'bg-amber-100 text-amber-800' },
  published:  { label: 'Published',     cls: 'bg-emerald-100 text-emerald-800' },
  failed:     { label: "Couldn't read", cls: 'bg-red-100 text-red-800' },
};

const TEMPLATE = 'date,session,time,course_code,course_name,department,year,venue\r\n12/12/2026,FN,09:30-12:30,CS3401,Design and Analysis of Algorithms,CSE,II,B-201\r\n';

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'exam-timetable-template.csv' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function StatusPill({ status }: { status: TimetableSummary['status'] }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export default function AdminTimetablesPage() {
  const [list, setList] = useState<TimetableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    setErr('');
    return api.getTimetables().then(setList).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (openId) return <TimetableReview id={openId} onBack={() => { setOpenId(null); void load(); }} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <CalendarDays className="h-6 w-6 text-indigo-600" /> Exam timetables
          </h1>
          <p className="mt-1 text-sm text-slate-600">Upload a timetable, check it, publish. Professors and students see their own exams.</p>
        </div>
        <button onClick={() => setUploading(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
          <Upload className="h-4 w-4" /> Upload timetable
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
      ) : err ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
          <p>No timetables yet. Upload an Excel sheet, a PDF or a photo of the timetable.</p>
          <button onClick={downloadTemplate} className="mt-3 inline-flex items-center gap-1.5 font-semibold text-indigo-700 underline underline-offset-2">
            <Download className="h-4 w-4" /> Excel template
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {list.map(t => (
            <li key={t.id}>
              <button onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{t.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {TYPE_LABELS[t.assessment_type]} · {t.first_date ? `${fmtDate(t.first_date)} to ${fmtDate(t.last_date)}` : 'No dates yet'}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-slate-600">{t.exams} exams · {t.matched} matched to courses</span>
                <StatusPill status={t.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploading && <UploadDialog onClose={() => setUploading(false)} onDone={d => { setUploading(false); setOpenId(d.timetable.id); }} />}
    </div>
  );
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (d: TimetableDetail) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<AssessmentType>('unit_test');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Choose the timetable file'); return; }
    setBusy(true); setError('');
    try { onDone(await api.uploadTimetable(file, title.trim(), type)); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const isSheet = file && /\.(xlsx|xls|csv)$/i.test(file.name);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="upload-tt">
      <form onSubmit={submit} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="upload-tt" className="text-lg font-bold text-slate-900">Upload exam timetable</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} placeholder="Unit test 2"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-slate-500">Becomes the assessment name professors see, e.g. "Unit test 2" or "Model exam".</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Exam type</span>
            <select value={type} onChange={e => setType(e.target.value as AssessmentType)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">File</span>
            <input type="file" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
          </label>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            {file && !isSheet
              ? 'LearnIT will read this file with AI, which takes up to a minute. You check every row before anything is published.'
              : <>Excel with one exam per row is read exactly: columns <b>date</b>, <b>session</b> (FN/AN) or <b>time</b>, <b>course code</b>, <b>course name</b>, <b>department</b>, <b>year</b>, <b>venue</b>. Other layouts, PDFs and photos are read with AI. </>}
            {!file && <button type="button" onClick={downloadTemplate} className="font-semibold text-indigo-700 underline underline-offset-2">Download the template</button>}
          </p>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Upload and check
          </button>
        </div>
      </form>
    </div>
  );
}

function TimetableReview({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<TimetableDetail | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>('');
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(() => api.getTimetable(id).then(setData).catch(e => setErr(e.message)), [id]);

  useEffect(() => {
    void load();
    api.getAdminCourses().then((c: any) => setCourses(Array.isArray(c) ? c : [])).catch(() => {});
    api.getDepartments().then(setDepartments).catch(() => {});
  }, [load]);

  // While the AI reads the file, check back every few seconds.
  useEffect(() => {
    if (data?.timetable.status !== 'extracting') return;
    timer.current = window.setTimeout(() => void load(), 3000);
    return () => window.clearTimeout(timer.current);
  }, [data, load]);

  const save = async (entry: TimetableEntry, patch: Record<string, unknown>) => {
    setRowErr(r => ({ ...r, [entry.id]: '' }));
    try {
      const next = await api.updateTimetableEntry(id, entry.id, patch);
      setData(d => d && ({ ...d, entries: d.entries.map(e => e.id === entry.id ? next : e) }));
    } catch (e: any) { setRowErr(r => ({ ...r, [entry.id]: e.message })); }
  };
  const remove = async (entry: TimetableEntry) => {
    await api.deleteTimetableEntry(id, entry.id).catch(() => {});
    setData(d => d && ({ ...d, entries: d.entries.filter(e => e.id !== entry.id) }));
  };
  const addRow = async () => {
    const lastDate = data?.entries.slice(-1)[0]?.exam_date ?? new Date().toISOString().slice(0, 10);
    try { setData(await api.addTimetableEntry(id, { exam_date: lastDate })); }
    catch (e: any) { setErr(e.message); }
  };
  const openSource = async () => {
    try { window.open((await api.getTimetableSource(id)).url, '_blank', 'noopener'); }
    catch (e: any) { setErr(e.message); }
  };
  const publish = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.publishTimetable(id);
      setData(r);
      setDone(`Published. ${r.result.created} assessments created${r.result.moved ? `, ${r.result.moved} moved to new dates` : ''}; ${r.result.professors} professors and ${r.result.students} students notified.`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); setConfirm(false); }
  };
  const del = async () => {
    if (!window.confirm('Delete this draft timetable?')) return;
    try { await api.deleteTimetable(id); onBack(); } catch (e: any) { setErr(e.message); }
  };

  const stats = useMemo(() => {
    const e = data?.entries ?? [];
    return {
      total: e.length,
      matched: e.filter(x => x.course_id).length,
      attention: e.filter(x => x.problems.length).length,
      undated: e.filter(x => !x.exam_date).length,
    };
  }, [data]);

  if (!data) return (
    <div className="flex items-center justify-center py-24 text-slate-500">
      {err ? <span className="text-red-700">{err}</span> : <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</>}
    </div>
  );

  const t = data.timetable;
  const cell = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> All timetables
      </button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <StatusPill status={t.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">{TYPE_LABELS[t.assessment_type]} · {t.source_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.has_source && (
            <button onClick={openSource} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
              <ExternalLink className="h-4 w-4" /> Uploaded file
            </button>
          )}
          {t.status !== 'published' && (
            <button onClick={del} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-red-700">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          {t.status !== 'extracting' && t.status !== 'failed' && (
            <button onClick={() => setConfirm(true)} disabled={busy || stats.total === 0 || stats.undated > 0}
              title={stats.undated ? 'Every row needs a date' : undefined}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {t.status === 'published' ? 'Publish changes' : 'Publish timetable'}
            </button>
          )}
        </div>
      </div>

      {t.status === 'extracting' && (
        <p className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the timetable. This usually takes under a minute.
        </p>
      )}
      {t.extraction_note && (
        <p className={`rounded-xl border px-4 py-3 text-sm ${t.status === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {t.extraction_note}
        </p>
      )}
      {err && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      {done && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" /> {done}</p>}

      {confirm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="alertdialog" aria-labelledby="pub-text">
          <p id="pub-text">
            {t.status === 'published'
              ? `Publish the changes? Moved exams get their new dates, and everyone affected is told the timetable changed.`
              : `Publish ${stats.total} exams? ${stats.matched} are matched to courses: each gets a draft assessment for its professor to enter marks, and the course's students are told.`}
            {stats.total - stats.matched > 0 && ` ${stats.total - stats.matched} have no matching course; students of that department and year are still told.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={publish} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Publish
            </button>
            <button onClick={() => setConfirm(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium">Cancel</button>
          </div>
        </div>
      )}

      {t.status !== 'extracting' && (
        <>
          <p className="text-sm text-slate-700">
            <b className="tabular-nums">{stats.total}</b> exams · <b className="tabular-nums">{stats.matched}</b> matched to a course
            {stats.attention > 0 && <> · <span className="text-amber-800"><b className="tabular-nums">{stats.attention}</b> to check</span></>}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <tr>
                  <th className="w-36 px-2 py-2.5">Date</th>
                  <th className="w-20 px-2 py-2.5">Session</th>
                  <th className="w-32 px-2 py-2.5">Time</th>
                  <th className="w-28 px-2 py-2.5">Code</th>
                  <th className="px-2 py-2.5">Course in LearnIT</th>
                  <th className="w-28 px-2 py-2.5">Department</th>
                  <th className="w-20 px-2 py-2.5">Year</th>
                  <th className="w-24 px-2 py-2.5">Hall</th>
                  <th className="w-10 px-2 py-2.5"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map(e => {
                  const problem = rowErr[e.id] || e.problems[0];
                  return (
                    <React.Fragment key={e.id}>
                      <tr className={`border-t border-slate-100 align-top ${e.problems.length ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-2 py-1.5">
                          <input type="date" defaultValue={e.exam_date ?? ''} aria-label="Date" className={cell}
                            onBlur={ev => ev.target.value !== (e.exam_date ?? '') && save(e, { exam_date: ev.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={e.session ?? ''} aria-label="Session" className={cell} onChange={ev => save(e, { session: ev.target.value })}>
                            <option value="">—</option><option value="FN">FN</option><option value="AN">AN</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={e.start_time ? `${e.start_time}${e.end_time ? `-${e.end_time}` : ''}` : ''} placeholder="09:30-12:30" aria-label="Time" className={cell}
                            onBlur={ev => save(e, { session: e.session ?? '', time: ev.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={e.course_code ?? ''} aria-label="Course code" className={`${cell} uppercase`}
                            onBlur={ev => ev.target.value.toUpperCase().replace(/\s+/g, '') !== (e.course_code ?? '') && save(e, { course_code: ev.target.value })} />
                          {e.course_name && <span className="mt-0.5 block truncate text-xs text-slate-500" title={e.course_name}>{e.course_name}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={e.course_id ?? ''} aria-label="Course in LearnIT" className={cell} onChange={ev => save(e, { course_id: ev.target.value || null })}>
                            <option value="">No matching course</option>
                            {courses.map(c => <option key={c.id} value={c.id}>{c.code}: {c.name}</option>)}
                          </select>
                          {e.professor_name && <span className="mt-0.5 block text-xs text-slate-500">{e.professor_name}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={e.department_id ?? ''} aria-label="Department" className={cell} onChange={ev => save(e, { department_id: ev.target.value || null })}>
                            <option value="">{e.department_text ? `? ${e.department_text}` : '—'}</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={e.year_of_study ?? ''} aria-label="Year" className={cell} onChange={ev => save(e, { year_of_study: ev.target.value || null })}>
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={e.venue ?? ''} aria-label="Hall" className={cell}
                            onBlur={ev => ev.target.value !== (e.venue ?? '') && save(e, { venue: ev.target.value })} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button onClick={() => remove(e)} className="rounded p-1.5 text-slate-400 hover:text-red-700" aria-label="Remove row"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                      {problem && (
                        <tr className="bg-amber-50/60">
                          <td colSpan={9} className="px-3 pb-2 text-xs text-amber-900">
                            <AlertCircle className="mr-1 inline h-3.5 w-3.5" />{problem}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {data.entries.length === 0 && (
                  <tr><td colSpan={9} className="py-10 text-center text-sm text-slate-500">No exams in this timetable yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <button onClick={addRow} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
            <Plus className="h-4 w-4" /> Add an exam
          </button>
        </>
      )}
    </div>
  );
}
