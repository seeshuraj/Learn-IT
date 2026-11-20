/**
 * Topic mastery for one student: what they scored on each topic of each
 * question paper, and how that tracks across the assessments of a course.
 * Topics come from the paper's analysis (question-mapped) where there is one,
 * otherwise from the units tagged on the questions. Pure functions; the
 * insights route loads the rows.
 */
import type { MappedTopic, QuestionMark, QuestionPattern } from './questionPattern.js';

export type { QuestionPattern } from './questionPattern.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const valueOf = (m: QuestionMark) => (typeof m === 'number' ? m : m.m);

export interface TopicDetail {
  topic: string;
  pct: number;
  got: number;
  max: number;
  /** Questions counted for this topic, as written ("3", "7b"). */
  questions: string[];
  /** Counted questions where the student didn't get full marks. */
  lost: string[];
}

/**
 * Per-topic marks for one student on one paper. Same rules as
 * paperTopicBreakdown: an option of an (a)/(b) question counts only for
 * students who wrote it (a plain number means (a)); unanswered questions are 0,
 * except in "answer any N" parts. Topics with nothing counted are left out.
 */
export function topicDetails(
  p: QuestionPattern, marks: Record<string, QuestionMark> | null | undefined, topics: MappedTopic[],
): TopicDetail[] {
  const lookup = new Map(Object.entries(marks ?? {}).map(([k, m]) => [k.toLowerCase(), m]));
  const questions = p.parts.flatMap(part => part.questions.map(q => ({ q, anyN: part.answer_count !== null })));
  const out: TopicDetail[] = [];
  for (const t of topics) {
    const refs = new Set(t.questions.map(r => r.toLowerCase()));
    const d: TopicDetail = { topic: t.topic, pct: 0, got: 0, max: 0, questions: [], lost: [] };
    for (const { q, anyN } of questions) {
      const no = q.no.toLowerCase();
      const m = lookup.get(no);
      if (m === undefined && anyN) continue;
      const option = q.either_or ? (m !== undefined && typeof m === 'object' ? m.o : 'a') : null;
      if (!refs.has(no) && !(option && refs.has(`${no}${option}`))) continue;
      const got = m === undefined ? 0 : valueOf(m);
      d.got += got;
      d.max += q.marks;
      // Show the option the student wrote, so "where marks were lost" points at what they answered.
      const shown = option ? `${no}${option}` : no;
      d.questions.push(shown);
      if (got < q.marks) d.lost.push(shown);
    }
    if (d.max > 0) out.push({ ...d, got: round2(d.got), max: round2(d.max), pct: round2((d.got / d.max) * 100) });
  }
  return out;
}

/**
 * Topics from the units tagged on questions. An (a)/(b) question whose options
 * are from different units goes to each unit as "11a" / "11b"; otherwise the
 * whole question goes to its unit. Topics keep the paper's order.
 */
export function topicsFromUnits(p: QuestionPattern, moduleNames: Map<number, string>): MappedTopic[] {
  const byTopic = new Map<string, string[]>();
  const add = (mod: number | null | undefined, ref: string) => {
    const name = mod ? moduleNames.get(mod) : undefined;
    if (!name) return;
    const list = byTopic.get(name) ?? [];
    if (!list.includes(ref)) list.push(ref);
    byTopic.set(name, list);
  };
  for (const part of p.parts) {
    for (const q of part.questions) {
      const no = q.no.toLowerCase();
      const b = q.either_or ? q.module_id_b ?? null : null;
      if (b && b !== q.module_id) {
        add(q.module_id, `${no}a`);
        add(b, `${no}b`);
      } else {
        add(q.module_id ?? b, no);
      }
    }
  }
  return [...byTopic].map(([topic, questions]) => ({ topic, questions }));
}

export interface ExamTopicScores {
  examId: number;
  title: string;
  courseId: number;
  courseCode: string;
  scores: TopicDetail[];
  /** Class average per topic, only where enough students wrote the paper. */
  classAvg: Record<string, number>;
}

export interface TopicMasteryRow {
  course_id: number;
  course_code: string;
  topic: string;
  latest_pct: number;
  avg_pct: number;
  tests: number;
  /** Latest against the previous test with this topic; null when there's only one. */
  trend: 'up' | 'down' | 'same' | null;
  class_avg: number | null;
  latest: { exam_id: number; title: string; lost: string[] };
}

const TREND_POINTS = 5;

/** Mastery per course topic across a student's assessments (given newest first), weakest first. */
export function topicMastery(exams: ExamTopicScores[]): TopicMasteryRow[] {
  const groups = new Map<string, { exam: ExamTopicScores; score: TopicDetail }[]>();
  for (const exam of exams) {
    for (const score of exam.scores) {
      const key = `${exam.courseId}\u0000${score.topic.toLowerCase()}`;
      const list = groups.get(key) ?? [];
      list.push({ exam, score });
      groups.set(key, list);
    }
  }
  const rows: TopicMasteryRow[] = [];
  for (const list of groups.values()) {
    const [latest, previous] = list;
    const diff = previous ? latest.score.pct - previous.score.pct : null;
    rows.push({
      course_id: latest.exam.courseId,
      course_code: latest.exam.courseCode,
      topic: latest.score.topic,
      latest_pct: latest.score.pct,
      avg_pct: round2(list.reduce((s, x) => s + x.score.pct, 0) / list.length),
      tests: list.length,
      trend: diff === null ? null : diff >= TREND_POINTS ? 'up' : diff <= -TREND_POINTS ? 'down' : 'same',
      class_avg: latest.exam.classAvg[latest.score.topic] ?? null,
      latest: { exam_id: latest.exam.examId, title: latest.exam.title, lost: latest.score.lost },
    });
  }
  return rows.sort((a, b) => a.latest_pct - b.latest_pct || a.topic.localeCompare(b.topic));
}
