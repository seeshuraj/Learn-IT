import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, type AssessmentType, type PatternPart, type QuestionPattern, type SavedPattern } from '../../services/api';
import { paperTotal, partMax } from '../../server/lib/questionPattern';
import { inputCls } from './shared';

/**
 * Builds a question paper: parts (A, B, C…) with a number of questions and
 * marks per question, either/or choices and "answer any N". Questions are
 * numbered continuously across parts (1–10, 11–15, 16), as on university
 * papers; each question's marks and unit can be changed individually.
 */

const numCls = `${inputCls} w-20 text-right tabular-nums`;

/** Renumber questions 1…n across parts, keeping each question's settings. */
function renumber(parts: PatternPart[]): PatternPart[] {
  let n = 0;
  return parts.map(p => ({ ...p, questions: p.questions.map(q => ({ ...q, no: String(++n) })) }));
}

export function newPart(index: number, count = 5, marks = 2, eitherOr = false): PatternPart {
  const key = String.fromCharCode(65 + index);
  return {
    key, label: `Part ${key}`, answer_count: null,
    questions: Array.from({ length: count }, () => ({ no: '', marks, either_or: eitherOr, module_id: null })),
  };
}

/** A starting paper for a new assessment of this type. */
export function defaultPattern(type: AssessmentType): QuestionPattern {
  const parts = type === 'end_semester'
    ? [newPart(0, 10, 2), newPart(1, 5, 13, true), newPart(2, 1, 15, true)]
    : [newPart(0, 5, 2), newPart(1, 2, 13, true), newPart(2, 1, 14, true)];
  return { version: 1, parts: renumber(parts) };
}

export function PatternEditor({ value, onChange, modules, assessmentType, error }: {
  value: QuestionPattern;
  onChange: (p: QuestionPattern) => void;
  modules: { id: number; name: string }[] | null;
  assessmentType: AssessmentType;
  error?: string;
}) {
  const [saved, setSaved] = useState<SavedPattern[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    let live = true;
    api.getExamPatterns().then(p => live && setSaved(p)).catch(() => live && setSaved([]));
    return () => { live = false; };
  }, []);

  const parts = value.parts;
  const set = (next: PatternPart[]) => onChange({ version: 1, parts: renumber(next) });
  const patch = (i: number, p: Partial<PatternPart>) => set(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const setCount = (i: number, raw: string) => {
    const n = Math.max(1, Math.min(40, Math.floor(Number(raw) || 1)));
    const part = parts[i];
    const proto = part.questions[part.questions.length - 1] ?? { no: '', marks: 2, either_or: false, module_id: null };
    const questions = n <= part.questions.length
      ? part.questions.slice(0, n)
      : [...part.questions, ...Array.from({ length: n - part.questions.length }, () => ({ ...proto, module_id: null, module_id_b: null }))];
    patch(i, { questions, answer_count: part.answer_count !== null && part.answer_count >= n ? null : part.answer_count });
  };
  const setMarksEach = (i: number, raw: string) => {
    const m = Number(raw);
    if (!(m > 0)) return;
    patch(i, { questions: parts[i].questions.map(q => ({ ...q, marks: m })) });
  };
  const setEitherOr = (i: number, on: boolean) =>
    patch(i, { questions: parts[i].questions.map(q => ({ ...q, either_or: on, ...(on ? {} : { module_id_b: null }) })) });
  const setQuestion = (i: number, qi: number, q: Partial<PatternPart['questions'][number]>) =>
    patch(i, { questions: parts[i].questions.map((x, j) => (j === qi ? { ...x, ...q } : x)) });

  const applyTemplate = (id: string) => {
    const t = saved?.find(s => String(s.id) === id);
    if (t) onChange({ version: 1, parts: renumber(t.pattern.parts.map(p => ({ ...p, questions: p.questions.map(q => ({ ...q })) }))) });
  };

  const saveTemplate = async () => {
    if (!saveName.trim()) return;
    setSaving(true); setSaveMsg('');
    try {
      const s = await api.saveExamPattern(saveName.trim(), value, assessmentType);
      setSaved(prev => [...(prev ?? []), s]);
      setSaveName('');
      setSaveMsg(`Saved as “${s.name}”`);
    } catch (e: any) {
      setSaveMsg(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (id: number | string, name: string) => {
    if (!window.confirm(`Delete the saved pattern “${name}”? Assessments that used it keep their questions.`)) return;
    setSaveMsg('');
    try {
      await api.deleteExamPattern(id);
      setSaved(prev => (prev ?? []).filter(p => p.id !== id));
      setSaveMsg(`Deleted “${name}”`);
    } catch (e: any) {
      setSaveMsg(e.message || 'Could not delete');
    }
  };
  const ownSaved = (saved ?? []).filter(s => !s.built_in);

  const total = paperTotal(value);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      {saved && saved.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Start from a saved pattern</span>
          <select className={inputCls} value="" onChange={e => applyTemplate(e.target.value)}>
            <option value="">Choose…</option>
            {saved.map(s => <option key={s.id} value={String(s.id)}>{s.name} · {s.total} marks</option>)}
          </select>
        </label>
      )}
      {ownSaved.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer select-none font-medium">Manage saved patterns</summary>
          <ul className="mt-2 space-y-1">
            {ownSaved.map(s => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                <span className="truncate">{s.name} · {s.total} marks{s.created_by_name ? ` · ${s.created_by_name}` : ''}</span>
                <button type="button" onClick={() => void removeTemplate(s.id, s.name)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Delete saved pattern ${s.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {parts.map((part, i) => {
        const first = part.questions[0]?.no;
        const last = part.questions[part.questions.length - 1]?.no;
        const mixed = new Set(part.questions.map(q => q.marks)).size > 1;
        const eitherOr = part.questions.every(q => q.either_or);
        const open = expanded === part.key;
        return (
          <fieldset key={part.key} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-sm font-semibold text-slate-900">
                {part.label} <span className="font-normal text-slate-500">· Q{first}{first !== last ? `–${last}` : ''} · {partMax(part)} marks</span>
              </legend>
              {parts.length > 1 && (
                <button type="button" onClick={() => set(parts.filter((_, j) => j !== i))}
                  className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${part.label}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-600">Questions</span>
                <input inputMode="numeric" className={numCls} value={part.questions.length}
                  onChange={e => setCount(i, e.target.value)} aria-label={`${part.label}: number of questions`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-600">Marks each</span>
                <input inputMode="decimal" className={numCls} placeholder={mixed ? 'mixed' : undefined}
                  defaultValue={mixed ? '' : part.questions[0]?.marks} key={`${part.key}-${mixed ? 'm' : part.questions[0]?.marks}`}
                  onBlur={e => setMarksEach(i, e.target.value)} aria-label={`${part.label}: marks per question`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-600">Students answer</span>
                <select className={`${inputCls} w-28`} value={part.answer_count ?? ''}
                  onChange={e => patch(i, { answer_count: e.target.value === '' ? null : Number(e.target.value) })}
                  aria-label={`${part.label}: how many to answer`}>
                  <option value="">all</option>
                  {Array.from({ length: Math.max(0, part.questions.length - 1) }, (_, k) => k + 1).map(n =>
                    <option key={n} value={n}>any {n}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={eitherOr} onChange={e => setEitherOr(i, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600" />
                Either (a) or (b)
              </label>
            </div>

            <button type="button" onClick={() => setExpanded(open ? null : part.key)} aria-expanded={open}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Hide questions' : modules?.length ? 'Change a question’s marks or unit' : 'Change a question’s marks'}
            </button>
            {open && (
              <div className="mt-2 space-y-1.5">
                {part.questions.map((q, qi) => (
                  <div key={q.no} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-10 font-medium tabular-nums text-slate-700">Q{q.no}</span>
                    <input inputMode="decimal" className={`${inputCls} w-16 py-1 text-right tabular-nums`} defaultValue={q.marks}
                      onBlur={e => { const m = Number(e.target.value); if (m > 0) setQuestion(i, qi, { marks: m }); }}
                      aria-label={`Q${q.no} marks`} />
                    {modules && modules.length > 0 && (
                      <>
                        <select className={`${inputCls} w-auto min-w-0 flex-1 py-1`} value={q.module_id ?? ''}
                          onChange={e => setQuestion(i, qi, { module_id: e.target.value ? Number(e.target.value) : null })}
                          aria-label={`Q${q.no}${q.either_or ? '(a)' : ''} unit`}>
                          <option value="">{q.either_or ? '(a) unit' : 'Unit'}</option>
                          {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {q.either_or && (
                          <select className={`${inputCls} w-auto min-w-0 flex-1 py-1`} value={q.module_id_b ?? ''}
                            onChange={e => setQuestion(i, qi, { module_id_b: e.target.value ? Number(e.target.value) : null })}
                            aria-label={`Q${q.no}(b) unit`}>
                            <option value="">(b) same unit</option>
                            {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {parts.length < 6 && (
          <button type="button" onClick={() => set([...parts, newPart(parts.length, 1, 10)])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300">
            <Plus className="h-4 w-4" /> Add a part
          </button>
        )}
        <p className="text-sm font-semibold text-slate-900">Paper total: <span className="tabular-nums">{total}</span></p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <input value={saveName} onChange={e => setSaveName(e.target.value)} maxLength={80} placeholder="Name, e.g. CSE unit test 50"
          className={`${inputCls} min-w-0 flex-1`} aria-label="Pattern name" />
        <button type="button" onClick={() => void saveTemplate()} disabled={saving || !saveName.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save pattern
        </button>
        {saveMsg && <span className="w-full text-xs text-slate-600" role="status">{saveMsg}</span>}
      </div>
    </div>
  );
}
