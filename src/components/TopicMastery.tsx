import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, Target } from 'lucide-react';
import type { TopicMasteryRow } from '../services/api';

const SHOWN = 8;

/** "7b" → "Q7(b)", "3" → "Q3". */
export const questionLabel = (ref: string) => {
  const m = /^(\d+)([ab])$/i.exec(ref);
  return m ? `Q${m[1]}(${m[2].toLowerCase()})` : `Q${ref}`;
};

const barColor = (pct: number) => (pct < 50 ? 'bg-red-500' : pct < 75 ? 'bg-amber-500' : 'bg-emerald-500');
const pctColor = (pct: number) => (pct < 50 ? 'text-red-600' : pct < 75 ? 'text-amber-600' : 'text-emerald-600');
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Trend({ trend }: { trend: TopicMasteryRow['trend'] }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700"><ArrowUpRight className="w-3.5 h-3.5" />Improving</span>;
  if (trend === 'down') return <span className="inline-flex items-center gap-0.5 text-xs text-red-700"><ArrowDownRight className="w-3.5 h-3.5" />Dropped</span>;
  if (trend === 'same') return <span className="inline-flex items-center gap-0.5 text-xs text-slate-500"><Minus className="w-3.5 h-3.5" />Steady</span>;
  return null;
}

interface Props {
  topics: TopicMasteryRow[];
  /** Whose topics these are, for the heading ("Your topics", "Topics for Sarah"). */
  title?: string;
  /** Hide the course code when every row is from one course. */
  singleCourse?: boolean;
}

/**
 * Per-topic mastery from question-wise marks, weakest first: the latest
 * score, class average marker, trend against the previous assessment, and
 * the questions where marks were lost.
 */
export function TopicMastery({ topics, title = 'Topic mastery', singleCourse = false }: Props) {
  const [all, setAll] = useState(false);
  if (!topics.length) return null;
  const shown = all ? topics : topics.slice(0, SHOWN);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden" aria-labelledby="topic-mastery-title">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Target className="w-4 h-4 text-teal-600" />
        <h2 id="topic-mastery-title" className="text-sm font-semibold text-slate-800">{title}</h2>
        <span className="ml-auto text-xs text-slate-400">From question-wise marks, weakest first</span>
      </div>
      <ul className="divide-y divide-slate-50" data-testid="topic-mastery">
        {shown.map(t => (
          <li key={`${t.course_id}:${t.topic}`} className="px-5 py-3 space-y-1.5" data-topic={t.topic}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex items-baseline gap-2">
                {!singleCourse && (
                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">{t.course_code}</span>
                )}
                <span className="text-sm font-medium text-slate-800 truncate">{t.topic}</span>
              </div>
              <div className="flex items-baseline gap-3 shrink-0">
                <Trend trend={t.trend} />
                <span className={`text-sm font-bold tabular-nums ${pctColor(t.latest_pct)}`}>{fmt(t.latest_pct)}%</span>
              </div>
            </div>
            <div className="relative h-2 bg-slate-100 rounded-full" role="img"
              aria-label={`${fmt(t.latest_pct)}%${t.class_avg !== null ? `, class average ${fmt(t.class_avg)}%` : ''}`}>
              <div className={`h-2 rounded-full ${barColor(t.latest_pct)}`} style={{ width: `${Math.min(100, t.latest_pct)}%` }} />
              {t.class_avg !== null && (
                <div className="absolute -top-0.5 h-3 w-0.5 bg-slate-700 rounded" style={{ left: `calc(${Math.min(100, t.class_avg)}% - 1px)` }}
                  title={`Class average ${fmt(t.class_avg)}%`} />
              )}
            </div>
            <p className="text-xs text-slate-500">
              {t.latest.lost.length > 0
                ? <>Marks lost in {t.latest.lost.map(questionLabel).join(', ')} of {t.latest.title}</>
                : t.latest_pct >= 100 ? <>Full marks in {t.latest.title}</> : <>Latest: {t.latest.title}</>}
              {t.tests > 1 && <> · average {fmt(t.avg_pct)}% over {t.tests} assessments</>}
              {t.class_avg !== null && <> · class {fmt(t.class_avg)}%</>}
            </p>
          </li>
        ))}
      </ul>
      {topics.length > SHOWN && (
        <button type="button" onClick={() => setAll(v => !v)}
          className="w-full px-5 py-2.5 text-xs font-medium text-teal-700 hover:bg-slate-50 border-t border-slate-100">
          {all ? 'Show fewer' : `Show all ${topics.length} topics`}
        </button>
      )}
    </section>
  );
}
