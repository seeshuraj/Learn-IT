/**
 * College performance roll-ups for admins: per-course figures (from SQL)
 * combined into per-professor and per-department figures. Sums are carried
 * so averages are weighted by results written, not by course.
 */

export interface TopicAvg {
  topic: string;
  avg_pct: number;
  /** Results that scored this topic. */
  n: number;
}

/** One course's figures, as the performance query returns them. */
export interface CourseStats {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  semester: number | null;
  instructor_id: number | null;
  instructor_name: string | null;
  enrolled: number;
  /** What's been taught: units, course material uploaded by staff, assignments set, assessments published. */
  modules: number;
  notes: number;
  assignments: number;
  assessments: number;
  /** Published assessment results that were written (absent excluded). */
  written: number;
  pct_sum: number;
  passed: number;
  absent: number;
  /** Enrolled students averaging under 50% across the course's published assessments. */
  at_risk: number;
  submissions: number;
  graded: number;
  pending: number;
  /** Hours from submission to grade, summed over `timed` graded submissions that have both times. */
  turnaround_hours_sum: number;
  timed: number;
  weak_topics: TopicAvg[];
}

export interface RollUp<K> {
  key: K;
  courses: number;
  enrolled: number;
  materials: number;
  assignments: number;
  assessments: number;
  written: number;
  absent: number;
  at_risk: number;
  avg_pct: number | null;
  pass_rate: number | null;
  submissions: number;
  graded: number;
  pending: number;
  avg_turnaround_hours: number | null;
  weak_topics: TopicAvg[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const WEAK_TOPICS = 3;

/** Weakest topics across courses, each averaged over all results that scored it. */
export function mergeTopics(lists: TopicAvg[][], limit = WEAK_TOPICS): TopicAvg[] {
  const acc = new Map<string, { topic: string; sum: number; n: number }>();
  for (const list of lists) {
    for (const t of list) {
      const key = t.topic.toLowerCase();
      const a = acc.get(key) ?? { topic: t.topic, sum: 0, n: 0 };
      a.sum += t.avg_pct * t.n;
      a.n += t.n;
      acc.set(key, a);
    }
  }
  return [...acc.values()]
    .filter(a => a.n > 0)
    .map(a => ({ topic: a.topic, avg_pct: round1(a.sum / a.n), n: a.n }))
    .sort((a, b) => a.avg_pct - b.avg_pct || b.n - a.n)
    .slice(0, limit);
}

/** Courses grouped by `keyOf` (first-seen order), with weighted averages. */
export function rollUp<K>(courses: CourseStats[], keyOf: (c: CourseStats) => K): RollUp<K>[] {
  const groups = new Map<K, CourseStats[]>();
  for (const c of courses) {
    const k = keyOf(c);
    const list = groups.get(k) ?? [];
    list.push(c);
    groups.set(k, list);
  }
  return [...groups].map(([key, list]) => {
    const sum = (f: (c: CourseStats) => number) => list.reduce((s, c) => s + (Number(f(c)) || 0), 0);
    const written = sum(c => c.written);
    const graded = sum(c => c.graded);
    const timed = sum(c => c.timed);
    return {
      key,
      courses: list.length,
      enrolled: sum(c => c.enrolled),
      materials: sum(c => c.modules) + sum(c => c.notes),
      assignments: sum(c => c.assignments),
      assessments: sum(c => c.assessments),
      written,
      absent: sum(c => c.absent),
      at_risk: sum(c => c.at_risk),
      avg_pct: written ? round1(sum(c => c.pct_sum) / written) : null,
      pass_rate: written ? round1((100 * sum(c => c.passed)) / written) : null,
      submissions: sum(c => c.submissions),
      graded,
      pending: sum(c => c.pending),
      avg_turnaround_hours: timed ? round1(sum(c => c.turnaround_hours_sum) / timed) : null,
      weak_topics: mergeTopics(list.map(c => c.weak_topics)),
    };
  });
}
