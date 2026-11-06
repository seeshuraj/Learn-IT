/**
 * ExamPerformanceCard
 * Student-facing card: shows unit exam performance summary.
 * Used in AssessmentsPage (student role) and student dashboard.
 *
 * Props:
 *   studentId — the logged-in student's ID
 *
 * API: GET /api/unit-exams/student/:studentId/insights
 *
 * Data shape returned:
 *   { results, latest, overall_avg, weak_topics }
 */

import React, { useEffect, useState } from 'react';

interface ExamResult {
  exam_title:       string;
  exam_date:        string | null;
  course_name:      string;
  course_code:      string;
  marks_obtained:   string;
  percentage:       string;
  performance_band: 'strong' | 'moderate' | 'weak';
  max_marks:        string;
}

interface InsightsPayload {
  results:     ExamResult[];
  latest:      ExamResult | null;
  overall_avg: number | null;
  weak_topics: string[];
}

interface Props {
  studentId: number;
}

const BAND_COLOR: Record<string, string> = {
  strong:   '#437a22',
  moderate: '#d19900',
  weak:     '#C8102E',
};
const BAND_BG: Record<string, string> = {
  strong:   '#d4dfcc',
  moderate: '#e9e0c6',
  weak:     '#FBE7EA',
};
const BAND_LABEL: Record<string, string> = {
  strong:   'Strong',
  moderate: 'Moderate',
  weak:     'Needs Focus',
};

export function ExamPerformanceCard({ studentId }: Props) {
  const [data,     setData]     = useState<InsightsPayload | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
    fetch(`/api/unit-exams/student/${studentId}/insights`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [studentId]);

  const s: Record<string, React.CSSProperties> = {
    card:   { background: '#F6F8FB', border: '1px solid #D9E3EE', borderRadius: 10, padding: '1.25rem', fontFamily: 'inherit' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title:  { fontSize: '1rem', fontWeight: 600, color: '#13203B' },
    avg:    { fontSize: '2rem', fontWeight: 700, color: '#2448B8', lineHeight: 1 },
    avgLbl: { fontSize: '0.75rem', color: '#56667F', marginTop: 2 },
    band:   (b: string) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: BAND_BG[b] ?? '#eee', color: BAND_COLOR[b] ?? '#333' }),
    latest: { background: '#fff', border: '1px solid #D9E3EE', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: 12 },
    lKey:   { fontSize: '0.75rem', color: '#56667F' },
    lVal:   { fontSize: '0.9375rem', fontWeight: 600, color: '#13203B' },
    chips:  { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
    chip:   { padding: '2px 8px', borderRadius: 10, background: '#FBE7EA', color: '#C8102E', fontSize: '0.75rem', fontWeight: 500 },
    toggle: { background: 'none', border: 'none', cursor: 'pointer', color: '#2448B8', fontSize: '0.8125rem', padding: 0, marginTop: 8 },
    histRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #EEF2F7', fontSize: '0.8125rem' },
  };

  if (loading) {
    return (
      <div style={s.card}>
        <p style={{ color: '#56667F', fontSize: '0.875rem' }}>Loading exam results…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div style={s.card}>
        <p style={{ color: '#C8102E', fontSize: '0.875rem' }}>Could not load exam data.</p>
      </div>
    );
  }
  if (!data || data.results.length === 0) {
    return (
      <div style={s.card}>
        <p style={s.title}>Unit Exam Performance</p>
        <p style={{ color: '#56667F', fontSize: '0.875rem', marginTop: 8 }}>No exam results yet.</p>
      </div>
    );
  }

  const { latest, overall_avg, weak_topics, results } = data;

  return (
    <div style={s.card}>
      <div style={s.header}>
        <span style={s.title}>Unit Exam Performance</span>
        {latest && <span style={s.band(latest.performance_band)}>{BAND_LABEL[latest.performance_band]}</span>}
      </div>

      {/* Overall average */}
      <div style={{ marginBottom: 14 }}>
        <div style={s.avg}>{overall_avg !== null ? `${overall_avg}%` : '—'}</div>
        <div style={s.avgLbl}>Overall average across {results.length} exam{results.length !== 1 ? 's' : ''}</div>
      </div>

      {/* Latest exam */}
      {latest && (
        <div style={s.latest}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={s.lKey}>{latest.exam_title}</span>
            <span style={s.lKey}>{latest.exam_date ? new Date(latest.exam_date).toLocaleDateString() : ''}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={s.lVal}>
              {parseFloat(latest.marks_obtained).toFixed(1)} / {parseFloat(latest.max_marks).toFixed(0)}
            </span>
            <span style={s.lVal}>{parseFloat(latest.percentage).toFixed(1)}%</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#56667F', marginTop: 2 }}>
            {latest.course_code} — {latest.course_name}
          </div>
        </div>
      )}

      {/* Weak topics (consistently weak across exams) */}
      {weak_topics.length > 0 && (
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#56667F', marginBottom: 4 }}>
            Consistently Weak Topics
          </p>
          <div style={s.chips}>
            {weak_topics.map(t => <span key={t} style={s.chip}>{t}</span>)}
          </div>
        </div>
      )}

      {/* Expand to show all exams history */}
      {results.length > 1 && (
        <>
          <button style={s.toggle} onClick={() => setExpanded(x => !x)}>
            {expanded ? '▲ Hide history' : `▼ Show all ${results.length} exams`}
          </button>
          {expanded && (
            <div style={{ marginTop: 8 }}>
              {results.map((r, i) => (
                <div key={i} style={s.histRow}>
                  <span>{r.exam_title}</span>
                  <span>{parseFloat(r.percentage).toFixed(1)}%</span>
                  <span style={s.band(r.performance_band)}>{BAND_LABEL[r.performance_band]}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ExamPerformanceCard;
