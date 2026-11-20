import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, BarChart3, CheckCircle2, Loader2, TrendingDown, TrendingUp, Upload, Users,
} from 'lucide-react';
import { api, type Assessment } from '../../services/api';

type Exam = Assessment;
interface Analytics {
  exam: Exam;
  stats: {
    total: number; avg: number; avg_pct: number; max_marks: number;
    min_marks: number; median_pct: number; pass_rate: number;
    bands: { strong: number; moderate: number; weak: number };
    absent?: number; grades?: Record<string, number>;
    weakest_topics: string[]; strongest_topics: string[];
    topic_averages?: { topic: string; avg: number }[];
    questions?: { no: string; part: string; max: number; attempted_pct: number | null; avg_pct: number | null; option_b?: number }[] | null;
    parts?: { key: string; label: string; max: number; avg_pct: number | null }[] | null;
  } | null;
  results: any[];
  topics: any[];
}

const BAND_COLORS: Record<string, string> = {
  strong:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  moderate: 'bg-amber-100   text-amber-700   border-amber-200',
  weak:     'bg-red-100     text-red-700     border-red-200',
};

const BAND_ICONS: Record<string, React.ReactNode> = {
  strong:   <TrendingUp  className="w-3 h-3" />,
  moderate: <BarChart3   className="w-3 h-3" />,
  weak:     <TrendingDown className="w-3 h-3" />,
};

export function BandBadge({ band }: { band: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${BAND_COLORS[band] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {BAND_ICONS[band]}
      {band.charAt(0).toUpperCase() + band.slice(1)}
    </span>
  );
}

// ── Drop zone ──────────────────────────────────────────────────────────────────
function DropZone({
  accept, label, hint, onFile, loading,
}: { accept: string; label: string; hint: string; onFile: (f: File) => void; loading: boolean; }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handle = (f: File | null) => { if (f) onFile(f); };

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 hover:border-teal-400 bg-slate-50 hover:bg-teal-50'
      }`}
      onClick={() => !loading && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0] ?? null); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => handle(e.target.files?.[0] ?? null)}
      />
      {loading
        ? <Loader2 className="w-8 h-8 text-teal-500 animate-spin mx-auto mb-2" />
        : <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />}
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-400 mt-1">{hint}</p>
    </div>
  );
}

/** Optional: the question paper PDF, used to work out topics and weights. */
export function PaperUpload({ exam, onUploaded }: { exam: Exam; onUploaded?: (analysisStatus: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [err, setErr] = useState('');
  const hasPaper = !!exam.paper_storage_path || uploaded;

  const handleFile = async (file: File) => {
    setLoading(true); setErr('');
    try {
      const r: any = await api.uploadExamPaper(exam.id, file);
      setUploaded(true);
      onUploaded?.(r?.analysis_status ?? 'processing');
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-slate-600">
        Optional. Upload the question paper and LearnIT works out which topics it covered and how much each was worth,
        so the analysis can show the topics students found hardest.
      </p>
      {hasPaper && exam.analysis_status === 'failed' ? (
        <PaperUnreadable />
      ) : hasPaper && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {exam.analysis_status === 'done' ? 'Question paper analysed.' : 'Question paper uploaded. Topics are being worked out.'}
        </div>
      )}
      <DropZone
        accept=".pdf"
        label={hasPaper ? 'Replace the question paper (PDF)' : 'Drop the question paper PDF here, or click to choose'}
        hint="PDF, up to 20 MB"
        onFile={handleFile}
        loading={loading}
      />
      {err && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}
    </div>
  );
}

const DIFFICULTY_STYLE: Record<string, string> = {
  easy: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  hard: 'bg-red-50 text-red-700 border-red-200',
};

interface PaperTopic {
  topic_name: string;
  weight: number | null;
  difficulty: string | null;
  questions?: string[];
  marks?: number | null;
  class_avg?: number | null;
}

/** "7b" → "Q7(b)", "3" → "Q3". */
const questionLabel = (ref: string) => {
  const m = ref.match(/^(\d+)([ab])?$/i);
  return m ? `Q${m[1]}${m[2] ? `(${m[2].toLowerCase()})` : ''}` : ref;
};

const avgTone = (v: number) => (v < 50 ? 'text-red-700' : v < 75 ? 'text-amber-700' : 'text-emerald-700');

/**
 * The topics the question paper covers: the questions on each (worked out by
 * AI from the paper), the marks they carry, and how the class did on them.
 */
function PaperTopics({ topics }: { topics: PaperTopic[] }) {
  const mapped = topics.some(t => t.questions && t.questions.length);
  return (
    <section aria-labelledby="paper-topics-h" className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 id="paper-topics-h" className="text-sm font-semibold text-slate-800">Topics in the question paper</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {mapped
          ? 'Topics and their questions were worked out from the paper by AI; marks and class averages come from the marks entered. Check the topics against the paper.'
          : 'Worked out from the paper by AI. Check them against the paper before relying on them.'}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">Topic</th>
              {mapped && <th scope="col" className="py-2 pr-3 font-medium">Questions</th>}
              <th scope="col" className="py-2 pr-3 font-medium">Share of paper</th>
              {mapped && <th scope="col" className="py-2 pr-3 text-right font-medium">Class average</th>}
              <th scope="col" className="py-2 text-right font-medium">Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {topics.map(t => {
              const w = t.weight == null ? null : Math.max(0, Math.min(100, Number(t.weight)));
              return (
                <tr key={t.topic_name} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-slate-800">{t.topic_name}</td>
                  {mapped && (
                    <td className="py-2 pr-3 text-xs text-slate-600 whitespace-nowrap">
                      {t.questions && t.questions.length ? t.questions.map(questionLabel).join(', ') : '—'}
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                        {w != null && <span className="block h-full rounded-full bg-teal-600" style={{ width: `${w}%` }} />}
                      </span>
                      <span className="text-xs tabular-nums text-slate-600 whitespace-nowrap">
                        {w == null ? '—' : `${Math.round(w)}%`}{t.marks ? ` · ${t.marks} marks` : ''}
                      </span>
                    </span>
                  </td>
                  {mapped && (
                    <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${t.class_avg == null ? 'text-slate-400' : avgTone(t.class_avg)}`}>
                      {t.class_avg == null ? '—' : `${Math.round(t.class_avg)}%`}
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {t.difficulty
                      ? <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_STYLE[t.difficulty] ?? 'border-slate-200 text-slate-600'}`}>{t.difficulty}</span>
                      : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mapped && (
        <p className="mt-2 text-xs text-slate-500">
          An (a)/(b) option counts the question's full marks, so shares can add up to more than 100%. Students are
          scored only on the option they wrote.
        </p>
      )}
    </section>
  );
}

/** The paper was uploaded but its topics couldn't be worked out. */
function PaperUnreadable() {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        LearnIT couldn't work out the topics from this question paper. A scanned or photographed paper has no text to
        read: upload the typed PDF the paper was printed from. Marks and the rest of the analysis are not affected.
      </span>
    </div>
  );
}

/** Class results for one assessment. Absent students are listed but not averaged. */
export function AnalyticsView({ exam }: { exam: Exam }) {
  const [data,    setData]    = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    api.getExamAnalytics(exam.id)
      .then((d: Analytics) => setData(d))
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [exam.id, exam.analysis_status]);

  if (loading) return (
    <div className="flex items-center gap-3 text-slate-500 py-12 justify-center">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading analytics…
    </div>
  );

  if (err) return (
    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
      <AlertCircle className="w-4 h-4" /> {err}
    </div>
  );

  if (!data) return null;
  const { stats, results, topics } = data;
  if (!stats && results.length === 0) return (
    <p className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-600">
      No marks entered yet. Enter marks to see how the class did.
    </p>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      {/* KPI row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: stats.absent ? `Wrote (${stats.absent} absent)` : 'Wrote', value: stats.total, suffix: '' },
            { label: 'Average',    value: Number(stats.avg_pct).toFixed(1),    suffix: '%' },
            { label: 'Pass rate',  value: Number(stats.pass_rate).toFixed(0),  suffix: '%' },
            { label: 'Median',     value: Number(stats.median_pct).toFixed(1), suffix: '%' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{k.value}{k.suffix}</p>
              <p className="text-xs text-slate-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Band distribution */}
      {stats && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-slate-700">How the class did</p>
          <div className="flex gap-4">
            {(['strong','moderate','weak'] as const).map(band => (
              <div key={band} className="flex-1 text-center">
                <p className={`text-2xl font-bold tabular-nums ${
                  band === 'strong' ? 'text-emerald-600' :
                  band === 'moderate' ? 'text-amber-600' : 'text-red-600'
                }`}>{stats.bands[band]}</p>
                <BandBadge band={band} />
              </div>
            ))}
          </div>
          {/* bar */}
          <div className="h-3 rounded-full overflow-hidden flex gap-0.5 bg-slate-100">
            {(['strong','moderate','weak'] as const).map(band => {
              const pct = stats.total ? (stats.bands[band] / stats.total) * 100 : 0;
              return pct > 0 ? (
                <div
                  key={band}
                  style={{ width: `${pct}%` }}
                  className={`h-full rounded-full ${
                    band === 'strong' ? 'bg-emerald-500' :
                    band === 'moderate' ? 'bg-amber-400' : 'bg-red-400'
                  }`}
                />
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Grade distribution (end-semester) */}
      {stats?.grades && Object.keys(stats.grades).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-slate-700 mb-3">Grades</p>
          <div className="flex flex-wrap gap-2">
            {['O', 'A+', 'A', 'B+', 'B', 'C', 'RA', 'W', 'AB']
              .concat(Object.keys(stats.grades).filter(g => !['O', 'A+', 'A', 'B+', 'B', 'C', 'RA', 'W', 'AB'].includes(g)))
              .filter(g => stats.grades![g])
              .map(g => (
                <div key={g} className="min-w-[3.5rem] rounded-lg border border-slate-200 px-3 py-2 text-center">
                  <p className="text-lg font-bold tabular-nums text-slate-900">{stats.grades![g]}</p>
                  <p className="text-xs font-medium text-slate-500">{g}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Topic insights */}
      {stats?.questions && stats.questions.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="qwise-title">
          <h3 id="qwise-title" className="font-semibold text-slate-900">Question by question</h3>
          <p className="mt-0.5 text-xs text-slate-500">Class average as a share of each question's marks, among students who answered it.</p>
          {stats.parts && (
            <div className="mt-3 flex flex-wrap gap-2">
              {stats.parts.map(p => (
                <span key={p.key} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                  {p.label}: <b className="tabular-nums">{p.avg_pct === null ? '—' : `${p.avg_pct}%`}</b>
                  <span className="text-xs text-slate-500"> of {p.max}</span>
                </span>
              ))}
            </div>
          )}
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {stats.questions.map(q => {
              const pct = q.avg_pct ?? 0;
              return (
                <li key={q.no} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-800">Q{q.no} <span className="text-xs font-normal text-slate-500">/{q.max}</span></span>
                    <span className="text-xs tabular-nums text-slate-600">
                      {q.avg_pct === null ? 'not answered' : `${q.avg_pct}%`}
                      {q.attempted_pct !== null && q.attempted_pct < 100 ? ` · ${q.attempted_pct}% answered` : ''}
                      {q.option_b ? ` · ${q.option_b} chose (b)` : ''}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {stats.topic_averages && stats.topic_averages.length > 0 && (
            <p className="mt-3 text-xs text-slate-600">
              By unit: {stats.topic_averages.map(t => `${t.topic} ${Math.round(t.avg)}%`).join(' · ')}
            </p>
          )}
        </section>
      )}

      {stats && (stats.weakest_topics.length > 0 || stats.strongest_topics.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.weakest_topics.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Weakest Topics</p>
              <div className="flex flex-wrap gap-2">
                {stats.weakest_topics.map(t => (
                  <span key={t} className="text-xs bg-white border border-red-200 text-red-700 px-2.5 py-1 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
          {stats.strongest_topics.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Strongest Topics</p>
              <div className="flex flex-wrap gap-2">
                {stats.strongest_topics.map(t => (
                  <span key={t} className="text-xs bg-white border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {topics.length > 0 && <PaperTopics topics={topics} />}

      {/* Student results table */}
      {results.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Student results</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Student</th>
                  <th className="px-4 py-2.5 text-right">Marks</th>
                  <th className="px-4 py-2.5 text-right">%</th>
                  <th className="px-4 py-2.5 text-center">{exam.assessment_type === 'end_semester' ? 'Grade' : 'Band'}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{r.student_name ?? r.student_email ?? r.student_id}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.is_absent ? 'AB' : Number(r.marks_obtained)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.is_absent ? '' : Number(r.percentage).toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-center">{r.grade ? <b className="text-slate-900">{r.grade}</b> : r.performance_band ? <BandBadge band={r.performance_band} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analysis status notice */}
      {exam.paper_storage_path && exam.analysis_status === 'failed' && <PaperUnreadable />}
      {exam.paper_storage_path && exam.analysis_status === 'processing' && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-700 text-sm">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Topics from the question paper are still being worked out. They'll appear here when ready.
        </div>
      )}
    </div>
  );
}

