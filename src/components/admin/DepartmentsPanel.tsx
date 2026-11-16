import React, { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, type Department } from '../../services/api';

/**
 * The college's departments. Exam timetables go out per department and year,
 * so every course and student should sit in one.
 */
export function DepartmentsPanel({ departments, onChange }: {
  departments: Department[];
  onChange: (next: Department[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = (d?: Department) => {
    setError('');
    setEditing(d?.id ?? null);
    setAdding(!d);
    setCode(d?.code ?? '');
    setName(d?.name ?? '');
  };
  const stop = () => { setAdding(false); setEditing(null); setError(''); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (editing) {
        const d = await api.updateDepartment(editing, { code, name });
        onChange(departments.map(x => x.id === editing ? { ...x, ...d } : x));
      } else {
        const d = await api.createDepartment({ code, name });
        onChange([...departments, d].sort((a, b) => a.code.localeCompare(b.code)));
      }
      stop();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (d: Department) => {
    if (!window.confirm(`Delete ${d.code}? Its ${d.students} students and ${d.courses} courses stay, without a department.`)) return;
    try {
      await api.deleteDepartment(d.id);
      onChange(departments.filter(x => x.id !== d.id));
    } catch (err: any) { setError(err.message); }
  };

  const form = (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-5 py-3">
      <label className="w-28">
        <span className="mb-1 block text-xs font-medium text-slate-600">Code</span>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} required maxLength={20} placeholder="CSE"
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm uppercase" />
      </label>
      <label className="min-w-[12rem] flex-1">
        <span className="mb-1 block text-xs font-medium text-slate-600">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} required maxLength={200} placeholder="Computer Science and Engineering"
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? 'Save' : 'Add department'}
      </button>
      <button type="button" onClick={stop} className="rounded-lg p-1.5 text-slate-500 hover:text-slate-800" aria-label="Cancel"><X className="h-4 w-4" /></button>
    </form>
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm" aria-labelledby="departments-heading">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 id="departments-heading" className="font-bold text-slate-900">Departments</h2>
          <p className="text-xs text-slate-500">Exam timetables reach students and professors by department and year.</p>
        </div>
        {!adding && !editing && (
          <button onClick={() => start()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300">
            <Plus className="h-4 w-4" /> Add
          </button>
        )}
      </div>
      {error && <p className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {adding && form}
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {departments.map(d => editing === d.id ? <li key={d.id}>{form}</li> : (
          <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
            <span className="w-24 font-mono text-xs font-bold text-indigo-700">{d.code}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{d.name}</span>
            <span className="text-xs tabular-nums text-slate-500">{d.students} students · {d.professors} professors · {d.courses} courses</span>
            <button onClick={() => start(d)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label={`Edit ${d.code}`}><Pencil className="h-4 w-4" /></button>
            <button onClick={() => remove(d)} className="rounded p-1 text-slate-400 hover:text-red-700" aria-label={`Delete ${d.code}`}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {departments.length === 0 && !adding && (
          <li className="px-5 py-6 text-center text-sm text-slate-500">No departments yet. Add them here, or they're created from the department column when you bulk import users.</li>
        )}
      </ul>
    </section>
  );
}
