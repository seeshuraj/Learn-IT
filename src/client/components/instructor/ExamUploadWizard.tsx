/**
 * ExamUploadWizard
 * 4-step wizard for instructors:
 *   1. Create exam (title, date, max marks, grading thresholds)
 *   2. Upload marks CSV/XLSX
 *   3. Upload exam paper PDF (optional)
 *   4. Review analytics preview
 *
 * Usage:
 *   <ExamUploadWizard courseId={courseId} onComplete={() => refetch()} />
 */

import React, { useState, useRef } from 'react';

interface Props {
  courseId: number;
  onComplete?: (examId: number) => void;
}

interface ExamMeta {
  id: number;
  title: string;
  max_marks: number;
  grading_schema: { strong: number; moderate: number };
}

interface ImportResult {
  import_id: number;
  rows_total: number;
  rows_matched: number;
  rows_failed: number;
  errors: any[];
  preview: { studentId: number; marks: number; band: string; pct: number }[];
}

const BAND_COLORS: Record<string, string> = {
  strong:   '#437a22',
  moderate: '#d19900',
  weak:     '#a12c7b',
};

const BAND_BG: Record<string, string> = {
  strong:   '#d4dfcc',
  moderate: '#e9e0c6',
  weak:     '#e0ced7',
};

export default function ExamUploadWizard({ courseId, onComplete }: Props) {
  const [step,     setStep]     = useState<1 | 2 | 3 | 4>(1);
  const [exam,     setExam]     = useState<ExamMeta | null>(null);
  const [result,   setResult]   = useState<ImportResult | null>(null);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Step 1 fields
  const [title,     setTitle]     = useState('');
  const [examDate,  setExamDate]  = useState('');
  const [maxMarks,  setMaxMarks]  = useState('100');
  const [strongThr, setStrongThr] = useState('75');
  const [modThr,    setModThr]    = useState('50');

  const marksRef = useRef<HTMLInputElement>(null);
  const paperRef = useRef<HTMLInputElement>(null);

  async function apiFetch(url: string, opts: RequestInit = {}) {
    const token = localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
    const res   = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
    return data;
  }

  // ── Step 1: Create exam ──────────────────────────────────────────────────
  async function handleCreateExam(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch('/api/unit-exams', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id:      courseId,
          title:          title.trim(),
          exam_date:      examDate || null,
          max_marks:      parseFloat(maxMarks),
          grading_schema: { strong: parseFloat(strongThr), moderate: parseFloat(modThr) },
        }),
      });
      setExam({
        id: data.id, title: title.trim(),
        max_marks: parseFloat(maxMarks),
        grading_schema: { strong: parseFloat(strongThr), moderate: parseFloat(modThr) },
      });
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Upload marks ─────────────────────────────────────────────────
  async function handleUploadMarks() {
    if (!exam || !marksRef.current?.files?.[0]) {
      setError('Please select a CSV or XLSX file');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', marksRef.current.files[0]);
      const data = await apiFetch(`/api/unit-exams/${exam.id}/upload-marks`, {
        method: 'POST',
        body:   fd,
      });
      setResult(data);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: Upload paper (optional) ─────────────────────────────────────
  async function handleUploadPaper(skip = false) {
    if (!exam) return;
    setError(null);
    if (!skip && paperRef.current?.files?.[0]) {
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append('file', paperRef.current.files[0]);
        await apiFetch(`/api/unit-exams/${exam.id}/upload-paper`, {
          method: 'POST',
          body:   fd,
        });
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }
    // Load analytics preview
    setLoading(true);
    try {
      const data = await apiFetch(`/api/unit-exams/${exam.id}/analytics`);
      setAnalytics(data);
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 4: Publish / finish ─────────────────────────────────────────────
  function handleFinish() {
    if (exam) onComplete?.(exam.id);
  }

  const s: Record<string, React.CSSProperties> = {
    wrap:    { maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' },
    stepper: { display: 'flex', gap: 8, marginBottom: 24 },
    stepDot: (active: boolean, done: boolean) => ({
      flex: 1, height: 4, borderRadius: 2,
      background: done ? '#437a22' : active ? '#01696f' : '#dcd9d5',
      transition: 'background 0.2s',
    }),
    label:   { fontSize: '0.75rem', color: '#7a7974', marginBottom: 16 },
    card:    { background: '#f9f8f5', border: '1px solid #d4d1ca', borderRadius: 8, padding: '1.5rem' },
    h2:      { fontSize: '1.125rem', fontWeight: 600, marginBottom: 16 },
    group:   { marginBottom: 14 },
    lbl:     { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 4, color: '#28251d' },
    input:   { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d4d1ca', borderRadius: 6, fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' as const },
    row:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    btn:     { padding: '0.625rem 1.25rem', background: '#01696f', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' },
    ghost:   { padding: '0.625rem 1.25rem', background: 'none', color: '#7a7974', border: '1px solid #d4d1ca', borderRadius: 6, fontSize: '0.875rem', cursor: 'pointer' },
    err:     { color: '#a12c7b', fontSize: '0.8125rem', marginTop: 10 },
    band:    (b: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: BAND_BG[b] ?? '#eee', color: BAND_COLORS[b] ?? '#333' }),
    stat:    { background: '#fff', border: '1px solid #d4d1ca', borderRadius: 8, padding: '0.75rem 1rem', textAlign: 'center' as const },
    statNum: { fontSize: '1.5rem', fontWeight: 700, color: '#01696f' },
    statLbl: { fontSize: '0.75rem', color: '#7a7974', marginTop: 2 },
    grid3:   { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 },
  };

  return (
    <div style={s.wrap}>
      {/* Progress bar */}
      <div style={s.stepper}>
        {([1,2,3,4] as const).map(n => (
          <div key={n} style={s.stepDot(step === n, step > n)} />
        ))}
      </div>
      <p style={s.label}>
        Step {step} of 4 — {['Create Exam', 'Upload Marks', 'Upload Paper', 'Review Analytics'][step - 1]}
      </p>

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div style={s.card}>
          <h2 style={s.h2}>Create Unit Exam</h2>
          <form onSubmit={handleCreateExam}>
            <div style={s.group}>
              <label style={s.lbl}>Exam Title *</label>
              <input style={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Unit Test 2" required />
            </div>
            <div style={{ ...s.group, ...s.row }}>
              <div>
                <label style={s.lbl}>Exam Date</label>
                <input style={s.input} type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
              </div>
              <div>
                <label style={s.lbl}>Max Marks *</label>
                <input style={s.input} type="number" min="1" max="1000" value={maxMarks} onChange={e => setMaxMarks(e.target.value)} required />
              </div>
            </div>
            <div style={{ ...s.group, ...s.row }}>
              <div>
                <label style={s.lbl}>Strong threshold (%)</label>
                <input style={s.input} type="number" min="1" max="100" value={strongThr} onChange={e => setStrongThr(e.target.value)} />
              </div>
              <div>
                <label style={s.lbl}>Moderate threshold (%)</label>
                <input style={s.input} type="number" min="1" max="100" value={modThr} onChange={e => setModThr(e.target.value)} />
              </div>
            </div>
            {error && <p style={s.err}>{error}</p>}
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create & Continue →'}
            </button>
          </form>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && exam && (
        <div style={s.card}>
          <h2 style={s.h2}>Upload Marks — {exam.title}</h2>
          <p style={{ fontSize: '0.875rem', color: '#7a7974', marginBottom: 16 }}>
            Upload a CSV or XLSX with columns: <code>student_email</code> (or <code>student_id</code>),
            {' '}<code>marks_obtained</code>. Optional topic columns (e.g. <code>algebra</code>, <code>recursion</code>)
            will be parsed as topic breakdown.
          </p>
          <div style={s.group}>
            <label style={s.lbl}>Marks File (.csv / .xlsx)</label>
            <input style={s.input} type="file" accept=".csv,.xlsx,.xls" ref={marksRef} />
          </div>
          {error && <p style={s.err}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.ghost} onClick={() => setStep(1)}>← Back</button>
            <button style={s.btn} onClick={handleUploadMarks} disabled={loading}>
              {loading ? 'Uploading…' : 'Upload & Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && exam && result && (
        <div style={s.card}>
          <h2 style={s.h2}>Upload Exam Paper (Optional)</h2>
          <p style={{ fontSize: '0.875rem', color: '#7a7974', marginBottom: 12 }}>
            Matched <strong>{result.rows_matched}</strong> of {result.rows_total} rows.
            {result.rows_failed > 0 && (
              <span style={{ color: '#a12c7b' }}> {result.rows_failed} rows failed — check below.</span>
            )}
          </p>
          {result.errors.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: '0.8125rem', cursor: 'pointer', color: '#7a7974' }}>Show row errors</summary>
              <ul style={{ fontSize: '0.8125rem', color: '#a12c7b', paddingLeft: 16, marginTop: 6 }}>
                {result.errors.map((e: any, i: number) => (
                  <li key={i}>Row {e.row}: {e.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <div style={s.group}>
            <label style={s.lbl}>Exam Paper PDF (used for topic analysis)</label>
            <input style={s.input} type="file" accept=".pdf" ref={paperRef} />
          </div>
          {error && <p style={s.err}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.ghost} onClick={() => handleUploadPaper(true)} disabled={loading}>Skip →</button>
            <button style={s.btn} onClick={() => handleUploadPaper(false)} disabled={loading}>
              {loading ? 'Processing…' : 'Upload & Review →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4 ── */}
      {step === 4 && exam && analytics && (
        <div style={s.card}>
          <h2 style={s.h2}>Analytics Preview — {exam.title}</h2>
          {analytics.stats ? (
            <>
              <div style={s.grid3}>
                <div style={s.stat}><div style={s.statNum}>{analytics.stats.avg_pct}%</div><div style={s.statLbl}>Average</div></div>
                <div style={s.stat}><div style={s.statNum}>{analytics.stats.pass_rate}%</div><div style={s.statLbl}>Pass Rate</div></div>
                <div style={s.stat}><div style={s.statNum}>{analytics.stats.total}</div><div style={s.statLbl}>Students</div></div>
              </div>
              <div style={s.grid3}>
                {(['strong','moderate','weak'] as const).map(b => (
                  <div key={b} style={s.stat}>
                    <div style={{ ...s.statNum, color: BAND_COLORS[b] }}>{analytics.stats.bands[b]}</div>
                    <div style={s.statLbl}>{b.charAt(0).toUpperCase() + b.slice(1)}</div>
                  </div>
                ))}
              </div>
              {analytics.stats.weakest_topics.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 6 }}>Weakest Topics</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {analytics.stats.weakest_topics.map((t: string) => (
                      <span key={t} style={s.band('weak')}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <p style={{ fontSize: '0.8125rem', color: '#7a7974', marginBottom: 16 }}>
                Median: {analytics.stats.median_pct}% | High: {analytics.stats.max_marks} | Low: {analytics.stats.min_marks}
              </p>
            </>
          ) : (
            <p style={{ color: '#7a7974', marginBottom: 16 }}>No results to preview yet.</p>
          )}
          <button style={s.btn} onClick={handleFinish}>Finish & Publish ✓</button>
        </div>
      )}
    </div>
  );
}
