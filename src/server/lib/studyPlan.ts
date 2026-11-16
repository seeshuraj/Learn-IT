/**
 * Turning an AI-suggested study plan into dated, checked milestones that
 * count down to an exam. Pure functions (tested); the AI proposes, these
 * rules decide dates.
 *
 * - Study days run from today to the day before the exam.
 * - The last day or two before an exam are kept for revision.
 * - Nothing is scheduled on a day the student has another exam; it moves
 *   to the nearest earlier free day.
 * - The exam itself is added as the final milestone.
 */

export const MILESTONE_KINDS = ['learn', 'practice', 'revise', 'assignment', 'exam', 'other'] as const;
export type MilestoneKind = typeof MILESTONE_KINDS[number];

export interface TargetExam {
  unit_exam_id: number;
  title: string;
  exam_date: string;              // YYYY-MM-DD
  session: 'FN' | 'AN' | null;
  start_time: string | null;      // HH:MM
  venue: string | null;
}

export interface RawMilestone {
  title?: unknown;
  description?: unknown;
  resource_hint?: unknown;
  date?: unknown;
  kind?: unknown;
  topic?: unknown;
  module?: unknown;
  minutes?: unknown;
}

export interface PlannedMilestone {
  title: string;
  description: string | null;
  resource_hint: string | null;
  due_date: string | null;
  kind: MilestoneKind;
  topic: string | null;
  module_id: number | null;
  est_minutes: number | null;
}

const DAY = 86_400_000;
const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`);
const fromDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fromDay(toDay(s) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toDay(to) - toDay(from)) / DAY);

/** Today in India (YYYY-MM-DD). */
export const todayIst = (now = Date.now()) => new Date(now + 330 * 60_000).toISOString().slice(0, 10);

/** Days kept for revision before an exam that is `daysLeft` days away. */
export function revisionDays(daysLeft: number): number {
  if (daysLeft >= 10) return 2;
  if (daysLeft >= 4) return 1;
  return 0;
}

/** How many steps a plan should have: more time, more (smaller) steps. */
export function milestoneCount(daysLeft: number | null): { min: number; max: number } {
  if (daysLeft === null) return { min: 5, max: 8 };
  const n = Math.max(3, Math.min(14, Math.round(daysLeft * 0.8)));
  return { min: Math.max(3, n - 2), max: n };
}

const str = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, max) : null;
};

function moduleIdFor(name: string | null, modules: { id: number; name: string }[]): number | null {
  if (!name) return null;
  const k = name.toLowerCase();
  const exact = modules.find(m => m.name.toLowerCase() === k);
  if (exact) return exact.id;
  const partial = modules.filter(m => m.name.toLowerCase().includes(k) || k.includes(m.name.toLowerCase()));
  return partial.length === 1 ? partial[0].id : null;
}

function examLabel(exam: TargetExam): string {
  const when = exam.start_time ? `at ${exam.start_time}` : exam.session === 'FN' ? 'forenoon (FN)' : exam.session === 'AN' ? 'afternoon (AN)' : '';
  return [when, exam.venue ? `hall ${exam.venue}` : ''].filter(Boolean).join(', ');
}

/**
 * Validate, date and order the AI's milestones.
 * `busyDays`: dates of the student's other exams (nothing else is put there).
 */
export function schedulePlan(
  raw: RawMilestone[],
  opts: { today: string; exam: TargetExam | null; busyDays?: string[]; modules?: { id: number; name: string }[] },
): PlannedMilestone[] {
  const { today, exam } = opts;
  const busy = new Set((opts.busyDays ?? []).filter(d => !exam || d !== exam.exam_date));
  const modules = opts.modules ?? [];
  const lastDay = exam ? addDays(exam.exam_date, -1) : null;
  const span = exam ? Math.max(0, daysBetween(today, lastDay!)) : 0;
  const items = raw.filter(r => str(r?.title, 200)).slice(0, 20);

  const planned = items.map((r, i) => {
    const kind = (MILESTONE_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as MilestoneKind) : 'learn';
    let due: string | null = null;
    if (exam && kind !== 'exam') {
      const given = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
      // Missing dates are spread evenly over the study days.
      due = given ?? addDays(today, items.length > 1 ? Math.round((span * i) / (items.length - 1)) : 0);
      if (due < today) due = today;
      if (due > lastDay!) due = lastDay!;
      if (daysBetween(today, lastDay!) < 0) due = today;   // exam is today: everything today
      // Step back off another exam's day, never before today.
      for (let d = due; d >= today; d = addDays(d, -1)) {
        if (!busy.has(d)) { due = d; break; }
      }
    }
    const minutes = Number(r.minutes);
    const topic = str(r.topic, 200);
    const module = str(r.module, 200);
    return {
      order: i,
      m: {
        title: str(r.title, 200)!,
        description: str(r.description, 1000),
        resource_hint: str(r.resource_hint, 300),
        due_date: due,
        kind,
        topic,
        module_id: moduleIdFor(module, modules),
        est_minutes: Number.isFinite(minutes) ? Math.max(10, Math.min(240, Math.round(minutes))) : null,
      } as PlannedMilestone,
    };
  }).filter(x => x.m.kind !== 'exam');

  planned.sort((a, b) => (a.m.due_date ?? '').localeCompare(b.m.due_date ?? '') || a.order - b.order);
  const out = planned.map(x => x.m);

  if (exam) {
    out.push({
      title: `${exam.title}`,
      description: `Exam day${examLabel(exam) ? `: ${examLabel(exam)}` : ''}. Sleep well, carry your ID card and hall ticket, and reach early.`,
      resource_hint: null,
      due_date: exam.exam_date,
      kind: 'exam',
      topic: null,
      module_id: null,
      est_minutes: null,
    });
  }
  return out;
}

/**
 * Weak topics, most important first. From each published exam's topic
 * breakdown, the lowest third of topics count as weak (more if the whole
 * exam was in the weak band); grading feedback adds its improvement areas.
 * Topics inside the coming exam's portion are ranked first.
 */
export function rankWeakTopics(
  exams: { performance_band: string | null; topic_breakdown: Record<string, number> | string | null }[],
  improvements: string[],
  portionModuleNames: string[],
): { topic: string; inPortion: boolean; score: number }[] {
  const score = new Map<string, number>();
  for (const e of exams) {
    if (!e.topic_breakdown) continue;
    let td: Record<string, number>;
    try { td = typeof e.topic_breakdown === 'string' ? JSON.parse(e.topic_breakdown) : e.topic_breakdown; }
    catch { continue; }
    const entries = Object.entries(td).filter(([, v]) => Number.isFinite(Number(v))).sort((a, b) => Number(a[1]) - Number(b[1]));
    if (!entries.length) continue;
    const take = e.performance_band === 'weak' ? Math.ceil(entries.length / 2) : Math.ceil(entries.length / 3);
    entries.slice(0, take).forEach(([t], i) => score.set(t, (score.get(t) ?? 0) + (e.performance_band === 'weak' ? 3 : 2) - i * 0.1));
  }
  for (const imp of improvements) if (imp) score.set(imp.slice(0, 200), (score.get(imp.slice(0, 200)) ?? 0) + 1);

  // In the portion when the topic shares a real word with a portion module
  // ("Graph search" ~ "Graph Algorithms").
  const STOP = new Set(['and', 'the', 'for', 'with', 'unit', 'module', 'chapter', 'part', 'intro', 'introduction', 'basics']);
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
  const portionWords = new Set(portionModuleNames.flatMap(words));
  const inPortion = (t: string) => words(t).some(w => portionWords.has(w));
  return [...score.entries()]
    .map(([topic, s]) => ({ topic, inPortion: inPortion(topic), score: s }))
    .sort((a, b) => Number(b.inPortion) - Number(a.inPortion) || b.score - a.score)
    .slice(0, 8);
}
