import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api, type Assessment, type AssessmentType, type QuestionPattern } from '../../services/api';
import { paperTotal } from '../../server/lib/questionPattern';
import { Field, inputCls, isSplit, TYPE_LABELS, TYPE_ORDER } from './shared';
import { PatternEditor, defaultPattern } from './PatternEditor';

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
  const [portion, setPortion] = useState<number[]>(existing?.portion_module_ids ?? []);
  const [portionNotes, setPortionNotes] = useState(existing?.portion_notes ?? '');
  // New assessments default to question-wise entry; existing ones keep theirs.
  const [questionWise, setQuestionWise] = useState(existing ? !!existing.question_pattern : true);
  const [pattern, setPattern] = useState<QuestionPattern>(existing?.question_pattern ?? defaultPattern(existing?.assessment_type ?? 'unit_test'));
  const [countsAs, setCountsAs] = useState(existing?.counted_out_of != null ? String(Number(existing.counted_out_of)) : '');
  const [modules, setModules] = useState<{ id: number; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const endSem = type === 'end_semester';

  // The course's modules, for choosing the exam portion.
  useEffect(() => {
    if (!courseId) { setModules(null); return; }
    let live = true;
    api.getCourseModules(Number(courseId))
      .then((m: any) => { if (live) setModules(Array.isArray(m) ? m.map((x: any) => ({ id: x.id, name: x.name })) : []); })
      .catch(() => live && setModules([]));
    return () => { live = false; };
  }, [courseId]);
  const togglePortion = (id: number) => setPortion(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const chooseType = (t: AssessmentType) => {
    setType(t);
    if (!existing) {
      if (t === 'end_semester') { setSplit(true); setMaxMarks('100'); }
      else { setSplit(false); if (maxMarks === '100') setMaxMarks('50'); }
      setPattern(defaultPattern(t));
    }
  };
  const total = paperTotal(pattern);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) { setFields({ course_id: 'Choose a course' }); return; }
    setSaving(true); setError(''); setFields({});
    const body = {
      course_id: Number(courseId),
      title: title.trim(),
      assessment_type: type,
      exam_date: date || null,
      max_marks: questionWise
        ? (split ? Number(internalMax) + total : total)
        : split ? Number(internalMax) + Number(externalMax) : Number(maxMarks),
      internal_max: split ? Number(internalMax) : null,
      external_max: split ? (questionWise ? total : Number(externalMax)) : null,
      question_pattern: questionWise ? pattern : null,
      counted_out_of: !split && countsAs.trim() !== '' ? Number(countsAs) : null,
      credits: endSem && credits !== '' ? Number(credits) : null,
      semester: endSem && semester !== '' ? Number(semester) : null,
      portion_module_ids: portion.length ? portion : null,
      portion_notes: portionNotes.trim() || null,
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
      <form onSubmit={submit} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
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

          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-slate-700">Marks entry</legend>
            <div className="grid grid-cols-2 gap-2">
              {[{ v: true, label: 'Question-wise', sub: 'Part A, B, C' }, { v: false, label: 'One total', sub: 'per student' }].map(o => (
                <button key={o.label} type="button" onClick={() => setQuestionWise(o.v)} aria-pressed={questionWise === o.v}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    questionWise === o.v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-xs opacity-80">{o.sub}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {questionWise && (
            <div>
              {split && <p className="mb-2 text-xs text-slate-600">The question paper is the external part. Internal marks are entered separately.</p>}
              <PatternEditor value={pattern} onChange={setPattern} modules={modules} assessmentType={type} error={fields.question_pattern} />
            </div>
          )}

          {split ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Internal out of" error={fields.internal_max}>
                <input inputMode="decimal" className={inputCls} value={internalMax} onChange={e => setInternalMax(e.target.value)} />
              </Field>
              {questionWise ? (
                <Field label="External out of" hint={`Total ${(Number(internalMax) || 0) + total}`}>
                  <input className={`${inputCls} bg-slate-100`} value={total} readOnly aria-readonly="true" />
                </Field>
              ) : (
                <Field label="External out of" hint={`Total ${(Number(internalMax) || 0) + (Number(externalMax) || 0)}`}>
                  <input inputMode="decimal" className={inputCls} value={externalMax} onChange={e => setExternalMax(e.target.value)} />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {!questionWise && (
                <Field label="Out of" error={fields.max_marks}>
                  <input inputMode="decimal" className={inputCls} value={maxMarks} onChange={e => setMaxMarks(e.target.value)} />
                </Field>
              )}
              <Field label="Counts as (optional)" error={fields.counted_out_of}
                hint={countsAs ? `${questionWise ? total : Number(maxMarks) || 0} marks are scaled to ${countsAs}` : 'E.g. a 50-mark test counted out of 20'}>
                <input inputMode="decimal" className={inputCls} value={countsAs} onChange={e => setCountsAs(e.target.value)} placeholder="20" />
              </Field>
            </div>
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

          {modules && modules.length > 0 && (
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">Portion (modules this exam covers)</legend>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {modules.map(m => (
                  <label key={m.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input type="checkbox" checked={portion.includes(m.id)} onChange={() => togglePortion(m.id)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600" />
                    {m.name}
                  </label>
                ))}
              </div>
              <input value={portionNotes} onChange={e => setPortionNotes(e.target.value)} maxLength={1000}
                placeholder="Optional note, e.g. Unit 3 up to Dijkstra's algorithm"
                className={`${inputCls} mt-2`} aria-label="Portion note" />
              <span className="mt-1 block text-xs text-slate-500">Students' study plans focus on these modules before the exam.</span>
            </fieldset>
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
