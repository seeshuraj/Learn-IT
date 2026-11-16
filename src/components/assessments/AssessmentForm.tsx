import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api, type Assessment, type AssessmentType } from '../../services/api';
import { Field, inputCls, isSplit, TYPE_LABELS, TYPE_ORDER } from './shared';

interface Course { id: number; name: string; code?: string | null }

/** Create or edit an assessment. End-semester splits marks into internal + external. */
export function AssessmentForm({ courses, existing, defaultCourseId, onClose, onSaved }: {
  courses: Course[];
  existing?: Assessment;
  defaultCourseId?: number;
  onClose: () => void;
  onSaved: (a: Assessment) => void;
}) {
  const [courseId, setCourseId] = useState<number | ''>(existing?.course_id ?? defaultCourseId ?? (courses.length === 1 ? courses[0].id : ''));
  const [type, setType] = useState<AssessmentType>(existing?.assessment_type ?? 'unit_test');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.exam_date?.slice(0, 10) ?? '');
  const [maxMarks, setMaxMarks] = useState(existing ? String(Number(existing.max_marks)) : '50');
  const [split, setSplit] = useState(existing ? isSplit(existing) : false);
  const [internalMax, setInternalMax] = useState(existing?.internal_max != null ? String(Number(existing.internal_max)) : '40');
  const [externalMax, setExternalMax] = useState(existing?.external_max != null ? String(Number(existing.external_max)) : '60');
  const [credits, setCredits] = useState(existing?.credits != null ? String(Number(existing.credits)) : '');
  const [semester, setSemester] = useState(existing?.semester != null ? String(existing.semester) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const endSem = type === 'end_semester';

  const chooseType = (t: AssessmentType) => {
    setType(t);
    if (!existing) {
      if (t === 'end_semester') { setSplit(true); setMaxMarks('100'); }
      else { setSplit(false); if (maxMarks === '100') setMaxMarks('50'); }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) { setFields({ course_id: 'Choose a course' }); return; }
    setSaving(true); setError(''); setFields({});
    const body = {
      course_id: Number(courseId),
      title: title.trim(),
      assessment_type: type,
      exam_date: date || null,
      max_marks: split ? Number(internalMax) + Number(externalMax) : Number(maxMarks),
      internal_max: split ? Number(internalMax) : null,
      external_max: split ? Number(externalMax) : null,
      credits: endSem && credits !== '' ? Number(credits) : null,
      semester: endSem && semester !== '' ? Number(semester) : null,
    };
    try {
      const saved = existing
        ? await api.updateUnitExam(existing.id, body)
        : await api.createUnitExam(body);
      onSaved(saved);
    } catch (err: any) {
      setError(err.message);
      if (err.body?.fields) setFields(err.body.fields);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="assessment-form-title">
      <form onSubmit={submit} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="assessment-form-title" className="text-lg font-bold text-slate-900">
            {existing ? 'Edit assessment' : 'New assessment'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Course" error={fields.course_id}>
            <select className={inputCls} value={courseId} disabled={!!existing}
              onChange={e => setCourseId(Number(e.target.value) || '')}>
              <option value="">Choose a course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code}: ${c.name}` : c.name}</option>)}
            </select>
          </Field>

          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-slate-700">Type</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TYPE_ORDER.map(t => (
                <button key={t} type="button" onClick={() => chooseType(t)} aria-pressed={type === t}
                  className={`rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                    type === t ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Title" error={fields.title}>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}
              placeholder={endSem ? 'Nov/Dec 2026 university exam' : 'Unit test 1'} />
          </Field>

          <Field label="Date" error={fields.exam_date}>
            <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          </Field>

          {endSem && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600" />
              Separate internal and external marks
            </label>
          )}

          {split ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Internal out of" error={fields.internal_max}>
                <input inputMode="decimal" className={inputCls} value={internalMax} onChange={e => setInternalMax(e.target.value)} />
              </Field>
              <Field label="External out of" hint={`Total ${(Number(internalMax) || 0) + (Number(externalMax) || 0)}`}>
                <input inputMode="decimal" className={inputCls} value={externalMax} onChange={e => setExternalMax(e.target.value)} />
              </Field>
            </div>
          ) : (
            <Field label="Out of" error={fields.max_marks}>
              <input inputMode="decimal" className={inputCls} value={maxMarks} onChange={e => setMaxMarks(e.target.value)} />
            </Field>
          )}

          {endSem && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Credits" error={fields.credits} hint="Used for SGPA">
                <input inputMode="decimal" className={inputCls} value={credits} onChange={e => setCredits(e.target.value)} placeholder="3" />
              </Field>
              <Field label="Semester" error={fields.semester}>
                <input inputMode="numeric" className={inputCls} value={semester} onChange={e => setSemester(e.target.value)} placeholder="5" />
              </Field>
            </div>
          )}

          {endSem && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Grades are worked out from the total: O 91+, A+ 81+, A 71+, B+ 61+, B 56+, C 50+, otherwise RA.
              {split && ' A pass also needs at least 45% of the external marks.'} You can override a grade per student.
            </p>
          )}

          {existing && (existing.result_count ?? 0) > 0 && (
            <p className="text-xs text-slate-500">Marks already entered are re-checked and re-graded against the new settings.</p>
          )}

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-300">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? 'Save changes' : 'Create and enter marks'}
          </button>
        </div>
      </form>
    </div>
  );
}
