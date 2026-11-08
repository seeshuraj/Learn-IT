/**
 * Learner profile for the notes tutor: a short, bounded summary of one
 * student's own record in one course, so answers can focus on what that
 * student actually got wrong.
 *
 * Sources (all scoped to the student, the course and the college):
 *   - unit exam results: percentage, band and per-topic marks
 *   - graded submissions: final grade, instructor feedback and the AI
 *     grading notes (strengths / improvements). Only submissions an
 *     instructor has graded are used, so unreviewed AI drafts never reach
 *     the student.
 *   - the student's study roadmap: steps not yet completed
 *
 * The formatter is pure and size-capped so the prompt cost stays predictable.
 */
import { TtlCache } from './ttlCache.js';

export interface ExamRecord {
  title: string;
  date: string | null;
  percentage: number | null;
  band: string | null;
  /** Topic → marks, as imported from the marks sheet. */
  topics: Record<string, number> | null;
}

export interface GradedWork {
  title: string;
  grade: number;
  maxPoints: number | null;
  instructorFeedback: string | null;
  strengths: string[];
  improvements: string[];
}

export interface LearnerProfile {
  exams: ExamRecord[];
  graded: GradedWork[];
  pendingSteps: string[];
}

export const PROFILE_MAX_CHARS = 1800;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Topics the student scored lowest on in their exams, most recent exam first, deduplicated. */
export function weakTopicsOf(profile: LearnerProfile, limit = 4): string[] {
  const out: string[] = [];
  for (const exam of profile.exams) {
    if (!exam.topics) continue;
    const entries = Object.entries(exam.topics).filter(([, v]) => Number.isFinite(v));
    if (entries.length < 2) continue;
    entries.sort((a, b) => a[1] - b[1]);
    // The lower half of topics in each exam counts as weak.
    for (const [topic] of entries.slice(0, Math.max(1, Math.floor(entries.length / 2)))) {
      const t = oneLine(topic);
      if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Recurring improvement points from graded work, most frequent first. */
export function improvementThemes(profile: LearnerProfile, limit = 4): string[] {
  const counts = new Map<string, { text: string; n: number }>();
  for (const g of profile.graded) {
    for (const raw of g.improvements) {
      const text = clip(oneLine(raw), 140);
      if (!text) continue;
      const key = text.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { text, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(c => c.text);
}

export function isEmptyProfile(p: LearnerProfile): boolean {
  return !p.exams.length && !p.graded.length && !p.pendingSteps.length;
}

/**
 * Renders the profile as plain text for the system prompt. Returns '' when
 * there is nothing to say. Output never exceeds PROFILE_MAX_CHARS.
 */
export function formatLearnerProfile(p: LearnerProfile): string {
  if (isEmptyProfile(p)) return '';
  const lines: string[] = [];

  if (p.exams.length) {
    lines.push('Unit exams (most recent first):');
    for (const e of p.exams.slice(0, 3)) {
      const pct = e.percentage == null ? '' : ` ${Math.round(e.percentage)}%`;
      const band = e.band ? ` (${e.band})` : '';
      let topics = '';
      if (e.topics && Object.keys(e.topics).length) {
        const sorted = Object.entries(e.topics).sort((a, b) => a[1] - b[1]).slice(0, 6);
        topics = '; topic marks, lowest first: ' + sorted.map(([t, v]) => `${clip(oneLine(t), 40)} ${v}`).join(', ');
      }
      lines.push(`- ${clip(oneLine(e.title), 80)}:${pct}${band}${topics}`);
    }
  }

  const weak = weakTopicsOf(p);
  if (weak.length) lines.push(`Weakest exam topics: ${weak.join(', ')}`);

  if (p.graded.length) {
    lines.push('Recently graded work:');
    for (const g of p.graded.slice(0, 4)) {
      const score = g.maxPoints ? `${g.grade}/${g.maxPoints}` : `${g.grade}`;
      const fb = g.instructorFeedback ? ` — instructor: "${clip(oneLine(g.instructorFeedback), 160)}"` : '';
      lines.push(`- ${clip(oneLine(g.title), 80)}: ${score}${fb}`);
    }
  }

  const themes = improvementThemes(p);
  if (themes.length) lines.push(`Recurring points to improve: ${themes.join('; ')}`);

  const strengths = [...new Set(p.graded.flatMap(g => g.strengths.map(s => clip(oneLine(s), 100))))].slice(0, 3);
  if (strengths.length) lines.push(`Strengths: ${strengths.join('; ')}`);

  if (p.pendingSteps.length) {
    lines.push(`Open study-plan steps: ${p.pendingSteps.slice(0, 3).map(s => clip(oneLine(s), 90)).join('; ')}`);
  }

  // Keep whole lines within the budget.
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > PROFILE_MAX_CHARS) break;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

/** Questions about what to study or how they are doing benefit from the weak topics in retrieval too. */
export function wantsStudyGuidance(question: string): boolean {
  return /\b(revis\w*|weak\w*|improv\w*|exam|test|study|focus|prepar\w*|mistake\w*|wrong|struggl\w*|marks?|grade\w*|feedback|practi[cs]e\w*|plan)\b/i
    .test(question);
}

// ── Loading ────────────────────────────────────────────────────────────────

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}

function stringList(value: unknown): string[] {
  const parsed = typeof value === 'string' ? parseJson<unknown>(value) ?? value : value;
  if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (typeof parsed === 'string' && parsed.trim()) return [parsed];
  return [];
}

// Profiles change only when an instructor grades or imports marks; a short
// cache saves three queries on every chat message in a session.
const cache = new TtlCache<LearnerProfile>(5 * 60_000, 2_000);

export async function loadLearnerProfile(
  db: Queryable,
  args: { studentId: number; courseId: number; institutionId: string },
): Promise<LearnerProfile> {
  const key = `${args.institutionId}:${args.studentId}:${args.courseId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const params = [args.studentId, args.courseId, args.institutionId];
  const [exams, graded, steps] = await Promise.all([
    db.query(
      `SELECT ue.title, ue.exam_date, r.percentage, r.performance_band, r.topic_breakdown
       FROM unit_exam_results r
       JOIN unit_exams ue ON ue.id = r.unit_exam_id
       WHERE r.student_id = $1 AND ue.course_id = $2 AND r.institution_id = $3
       ORDER BY ue.exam_date DESC NULLS LAST, r.created_at DESC
       LIMIT 3`,
      params,
    ),
    db.query(
      `SELECT a.title, a.max_points, s.grade, s.feedback, s.ai_feedback, s.ai_strengths, s.ai_improvements
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN modules m     ON m.id = a.module_id
       WHERE s.student_id = $1 AND m.course_id = $2 AND s.institution_id = $3
         AND s.grade IS NOT NULL
       ORDER BY COALESCE(s.graded_at, s.updated_at, s.submitted_at) DESC NULLS LAST
       LIMIT 5`,
      params,
    ),
    db.query(
      `SELECT rm.title
       FROM roadmap_milestones rm
       JOIN student_roadmaps sr ON sr.id = rm.roadmap_id
       WHERE sr.student_id = $1 AND sr.course_id = $2 AND sr.institution_id = $3
         AND COALESCE(rm.status, 'pending') <> 'completed'
       ORDER BY sr.updated_at DESC NULLS LAST, rm.step_order ASC
       LIMIT 3`,
      params,
    ),
  ]);

  const profile: LearnerProfile = {
    exams: exams.rows.map(r => ({
      title: String(r.title ?? 'Unit exam'),
      date: r.exam_date ? String(r.exam_date) : null,
      percentage: r.percentage == null ? null : Number(r.percentage),
      band: r.performance_band ?? null,
      topics: (() => {
        const t = parseJson<Record<string, unknown>>(r.topic_breakdown);
        if (!t) return null;
        const numeric = Object.entries(t).filter(([, v]) => Number.isFinite(Number(v)));
        return numeric.length ? Object.fromEntries(numeric.map(([k, v]) => [k, Number(v)])) : null;
      })(),
    })),
    graded: graded.rows.map(r => {
      const ai = parseJson<{ strengths?: unknown; improvements?: unknown }>(r.ai_feedback);
      return {
        title: String(r.title ?? 'Assignment'),
        grade: Number(r.grade),
        maxPoints: r.max_points == null ? null : Number(r.max_points),
        instructorFeedback: r.feedback ? String(r.feedback) : null,
        strengths: [...stringList(ai?.strengths), ...stringList(r.ai_strengths)],
        improvements: [...stringList(ai?.improvements), ...stringList(r.ai_improvements)],
      };
    }),
    pendingSteps: steps.rows.map(r => String(r.title ?? '')).filter(Boolean),
  };

  cache.set(key, profile);
  return profile;
}
