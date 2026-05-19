/**
 * ExamAnalyticsModal
 * Instructor drill-down for a single unit exam.
 * Opens when the instructor clicks an exam row in AssessmentsPage.
 *
 * Fetches GET /api/unit-exams/:id/analytics and renders:
 *   - KPI stats (avg, pass rate, median, high, low)
 *   - Band distribution bar
 *   - Weakest / strongest topics (from topic_breakdown)
 *   - Per-student results table (sorted by marks desc)
 *   - AI-extracted topic analysis (from exam paper PDF, if available)
 */

import React, { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Users, BarChart2, Award } from 'lucide-react';

interface AnalyticsStats {
  total:             number;
  avg:               number;
  avg_pct:           number;
  max_marks:         number;
  min_marks:         number;
  median_pct:        number;
  pass_rate:         number;
  bands:             { strong: number; moderate: number; weak: number };
  weakest_topics:    string[];
  strongest_topics:  string[];
}

interface StudentResult {
  student_name:     string;
  student_email:    string;
  marks_obtained:   string;
  percentage:       string;
  performance_band: 'strong' | 'moderate' | 'weak';
  topic_breakdown:  Record<string, number> | null;
}

interface TopicAnalysis {
  topic_name:  string;
  weight:      number | null;
  difficulty:  string | null;
}

interface AnalyticsPayload {
  exam:     any;
  results:  StudentResult[];
  topics:   TopicAnalysis[];
  stats:    AnalyticsStats | null;
}

interface Props {
  examId:  number;
  onClose: () => void;
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

export function ExamAnalyticsModal({ examId, onClose }: Props) {
  const [data,    setData]    = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tab,     setTab]     = useState<'overview' | 'students' | 'topics'>('overview');

  useEffect(() => {
    const token = localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? '';
    fetch(`/api/unit-exams/${examId}/analytics`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [examId]);

  const s: Record<string, React.CSSProperties> = {
    wrap:    { fontFamily: 'inherit', padding: '1.5rem' },
    header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    title:   { fontSize: '1.125rem', fontWeight: 600, color: '#28251d' },
    sub:     { fontSize: '0.8125rem', color: '#7a7974', marginTop: 2 },
    tabs:    { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #dcd9d5', paddingBottom: 0 },
    tab:     (active: boolean) => ({
      padding: '0.375rem 0.875rem',
      fontSize: '0.875rem',
      fontWeight: active ? 600 : 400,
      color: active ? '#01696f' : '#7a7974',
      borderBottom: active ? '2px solid #01696f' : '2px solid transparent',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      borderBottomStyle: 'solid',
    }),
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 },
    kpi:     { background: '#f9f8f5', border: '1px solid #d4d1ca', borderRadius: 8, padding: '0.875rem 1rem', textAlign: 'center' as const },
    kpiNum:  { fontSize: '1.5rem', fontWeight: 700, color: '#01696f' },
    kpiLbl:  { fontSize: '0.75rem', color: '#7a7974', marginTop: 2 },
    band:    (b: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: BAND_BG[b] ?? '#eee', color: BAND_COLORS[b] ?? '#333' }),
    chip:    (b: string) => ({ padding: '3px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 500, background: BAND_BG[b] ?? '#f3f0ec', color: BAND_COLORS[b] ?? '#28251d', display: 'inline-block' }),
    tbl:     { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.8125rem' },
    th:      { textAlign: 'left' as const, padding: '0.5rem 0.75rem', borderBottom: '2px solid #dcd9d5', fontSize: '0.75rem', fontWeight: 600, color: '#7a7974', textTransform: 'uppercase' as const, letterSpacing: '0.03em' },
    td:      { padding: '0.5rem 0.75rem', borderBottom: '1px solid #edeae5', color: '#28251d', verticalAlign: 'middle' as const },
  };

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <p style={s.title}>{data?.exam?.title ?? 'Exam Analytics'}</p>
          {data?.exam?.exam_date && (
            <p style={s.sub}>{new Date(data.exam.exam_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Max: {data.exam.max_marks} marks</p>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7a7974', padding: 4 }}>
          <X size={20} />
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(n => <div key={n} style={{ height: 60, borderRadius: 8, background: '#f3f0ec', animation: 'pulse 1.5s ease-in-out infinite' }} />)}
        </div>
      )}

      {error && (
        <div style={{ background: '#e0ced7', border: '1px solid #a12c7b', borderRadius: 8, padding: '0.75rem 1rem', color: '#a12c7b', fontSize: '0.875rem' }}>
          Failed to load analytics: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Tabs */}
          <div style={s.tabs}>
            {(['overview', 'students', 'topics'] as const).map(t => (
              <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* ── Overview tab ── */}
          {tab === 'overview' && (
            <>
              {data.stats ? (
                <>
                  {/* KPIs */}
                  <div style={s.kpiGrid}>
                    <div style={s.kpi}><div style={s.kpiNum}>{data.stats.avg_pct}%</div><div style={s.kpiLbl}>Class Average</div></div>
                    <div style={s.kpi}><div style={s.kpiNum}>{data.stats.pass_rate}%</div><div style={s.kpiLbl}>Pass Rate</div></div>
                    <div style={s.kpi}><div style={s.kpiNum}>{data.stats.total}</div><div style={s.kpiLbl}>Students</div></div>
                  </div>
                  <div style={s.kpiGrid}>
                    <div style={s.kpi}><div style={{ ...s.kpiNum, color: BAND_COLORS.strong }}>{data.stats.bands.strong}</div><div style={s.kpiLbl}>Strong</div></div>
                    <div style={s.kpi}><div style={{ ...s.kpiNum, color: BAND_COLORS.moderate }}>{data.stats.bands.moderate}</div><div style={s.kpiLbl}>Moderate</div></div>
                    <div style={s.kpi}><div style={{ ...s.kpiNum, color: BAND_COLORS.weak }}>{data.stats.bands.weak}</div><div style={s.kpiLbl}>Weak</div></div>
                  </div>

                  {/* Distribution bar */}
                  <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 6 }}>
                    <div style={{ width: `${(data.stats.bands.strong / data.stats.total) * 100}%`, background: '#6daa45' }} />
                    <div style={{ width: `${(data.stats.bands.moderate / data.stats.total) * 100}%`, background: '#e8af34' }} />
                    <div style={{ width: `${(data.stats.bands.weak / data.stats.total) * 100}%`, background: '#d163a7' }} />
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#7a7974', marginBottom: 16 }}>
                    Median: {data.stats.median_pct}% &nbsp;·&nbsp; High: {data.stats.max_marks} &nbsp;·&nbsp; Low: {data.stats.min_marks}
                  </p>

                  {/* Topic chips */}
                  {data.stats.weakest_topics.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#7a7974', marginBottom: 6 }}>Weakest Topics (from CSV topic columns)</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {data.stats.weakest_topics.map(t => <span key={t} style={s.chip('weak')}>{t}</span>)}
                      </div>
                    </div>
                  )}
                  {data.stats.strongest_topics.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#7a7974', marginBottom: 6 }}>Strongest Topics</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {data.stats.strongest_topics.map(t => <span key={t} style={s.chip('strong')}>{t}</span>)}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#7a7974' }}>
                  <BarChart2 size={36} style={{ margin: '0 auto 12px', color: '#bab9b4' }} />
                  <p>No results uploaded yet.</p>
                </div>
              )}
            </>
          )}

          {/* ── Students tab ── */}
          {tab === 'students' && (
            <div style={{ overflowX: 'auto' }}>
              {data.results.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#7a7974' }}>
                  <Users size={36} style={{ margin: '0 auto 12px', color: '#bab9b4' }} />
                  <p>No student results yet.</p>
                </div>
              ) : (
                <table style={s.tbl}>
                  <thead>
                    <tr>
                      <th style={s.th}>Student</th>
                      <th style={s.th}>Marks</th>
                      <th style={s.th}>%</th>
                      <th style={s.th}>Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r, i) => (
                      <tr key={i}>
                        <td style={s.td}>
                          <span style={{ fontWeight: 500 }}>{r.student_name}</span>
                          <br />
                          <span style={{ fontSize: '0.75rem', color: '#7a7974' }}>{r.student_email}</span>
                        </td>
                        <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.marks_obtained).toFixed(1)}</td>
                        <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.percentage).toFixed(1)}%</td>
                        <td style={s.td}><span style={s.band(r.performance_band)}>{r.performance_band}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Topics tab (AI paper analysis) ── */}
          {tab === 'topics' && (
            <>
              {data.topics.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#7a7974' }}>
                  <Award size={36} style={{ margin: '0 auto 12px', color: '#bab9b4' }} />
                  <p style={{ fontWeight: 500 }}>No AI topic analysis yet</p>
                  <p style={{ fontSize: '0.875rem', marginTop: 6 }}>
                    Upload an exam paper PDF in Step 3 to extract topics, weights, and difficulty ratings.
                  </p>
                </div>
              ) : (
                <table style={s.tbl}>
                  <thead>
                    <tr>
                      <th style={s.th}>Topic</th>
                      <th style={s.th}>Weight (%)</th>
                      <th style={s.th}>Difficulty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topics.map((t, i) => (
                      <tr key={i}>
                        <td style={{ ...s.td, fontWeight: 500 }}>{t.topic_name}</td>
                        <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{t.weight ?? '—'}</td>
                        <td style={s.td}>
                          {t.difficulty ? (
                            <span style={s.band(
                              t.difficulty === 'easy' ? 'strong' :
                              t.difficulty === 'medium' ? 'moderate' : 'weak'
                            )}>
                              {t.difficulty}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default ExamAnalyticsModal;
