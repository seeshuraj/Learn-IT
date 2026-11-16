import React from 'react';
import type { Assessment, AssessmentType } from '../../services/api';

export const TYPE_LABELS: Record<AssessmentType, string> = {
  unit_test: 'Unit test / CIA',
  model: 'Model exam',
  end_semester: 'End-semester',
  quiz: 'Quiz',
  lab: 'Lab',
  other: 'Other',
};

export const TYPE_ORDER: AssessmentType[] = ['unit_test', 'model', 'end_semester', 'quiz', 'lab', 'other'];

export const isSplit = (a: Pick<Assessment, 'internal_max' | 'external_max'>) =>
  a.internal_max !== null && a.internal_max !== undefined && a.external_max !== null && a.external_max !== undefined;

export const fmtNum = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v);
};

export const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';

export function StatusPill({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
      Draft
    </span>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500';

export function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
