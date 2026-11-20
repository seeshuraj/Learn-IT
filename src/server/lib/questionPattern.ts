/**
 * Question-paper patterns (Part A / B / C) and question-wise marks.
 *
 * Each assessment can carry its own pattern: parts with numbered questions
 * and marks per question, either/or questions ("11 (a) or (b)"), and parts
 * where only the best N answers count ("answer any 4 of 6"). These pure
 * functions validate a pattern, work out the paper total, read a typed cell
 * ("12b"), score a student's question marks, and derive per-unit percentages
 * for weak-topic detection. The client mirrors the arithmetic for live totals;
 * the server is the authority.
 */

export interface PatternQuestion {
  /** Question number as printed on the paper ("1", "11", "16"). */
  no: string;
  marks: number;
  /** "(a) or (b)": one mark per question plus which option was written. */
  either_or: boolean;
  /** Course module (unit) the question is from; option (a) for either/or. */
  module_id: number | null;
  /** Module of option (b), when it differs from (a). */
  module_id_b?: number | null;
}

export interface PatternPart {
  key: string;
  label: string;
  /** Only the best N answers count; null = every question counts. */
  answer_count: number | null;
  questions: PatternQuestion[];
}

export interface QuestionPattern {
  version: 1;
  parts: PatternPart[];
}

/** A stored mark: a number, or for either/or questions the mark and option. */
export type QuestionMark = number | { m: number; o: 'a' | 'b' };

const MAX_PARTS = 6;
const MAX_QUESTIONS = 60;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isHalfStep = (n: number) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
const valueOf = (m: QuestionMark) => (typeof m === 'number' ? m : m.m);

/** Anna University (R2021) end-semester paper: 10×2, 5×13 either/or, 1×15 either/or. */
export const ANNA_UNIV_SEMESTER: QuestionPattern = {
  version: 1,
  parts: [
    { key: 'A', label: 'Part A', answer_count: null,
      questions: Array.from({ length: 10 }, (_, i) => ({ no: String(i + 1), marks: 2, either_or: false, module_id: null })) },
    { key: 'B', label: 'Part B', answer_count: null,
      questions: Array.from({ length: 5 }, (_, i) => ({ no: String(i + 11), marks: 13, either_or: true, module_id: null })) },
    { key: 'C', label: 'Part C', answer_count: null,
      questions: [{ no: '16', marks: 15, either_or: true, module_id: null }] },
  ],
};

/** Highest marks a part can contribute (for "any N", the N largest questions). */
export function partMax(part: PatternPart): number {
  const marks = part.questions.map(q => q.marks).sort((a, b) => b - a);
  const n = part.answer_count ?? marks.length;
  return round2(marks.slice(0, n).reduce((s, m) => s + m, 0));
}

export function paperTotal(p: QuestionPattern): number {
  return round2(p.parts.reduce((s, part) => s + partMax(part), 0));
}

/** Validate and normalise a pattern sent by a client. */
export function validatePattern(raw: unknown): { pattern: QuestionPattern } | { error: string } {
  const r = raw as any;
  if (!r || typeof r !== 'object' || !Array.isArray(r.parts)) return { error: 'Add at least one part to the question paper' };
  if (r.parts.length === 0) return { error: 'Add at least one part to the question paper' };
  if (r.parts.length > MAX_PARTS) return { error: `A paper can have at most ${MAX_PARTS} parts` };

  const seen = new Set<string>();
  const keys = new Set<string>();
  let count = 0;
  const parts: PatternPart[] = [];
  for (const [i, p] of r.parts.entries()) {
    const key = String(p?.key ?? '').trim().toUpperCase().slice(0, 4) || String.fromCharCode(65 + i);
    const label = String(p?.label ?? '').trim().slice(0, 40) || `Part ${key}`;
    if (keys.has(key)) return { error: `Two parts are both called ${key}` };
    keys.add(key);
    if (!Array.isArray(p?.questions) || p.questions.length === 0) return { error: `${label} has no questions` };
    count += p.questions.length;
    if (count > MAX_QUESTIONS) return { error: `A paper can have at most ${MAX_QUESTIONS} questions` };

    const questions: PatternQuestion[] = [];
    for (const q of p.questions) {
      const no = String(q?.no ?? '').trim().slice(0, 8);
      if (!/^[0-9]{1,3}[a-z]?$/i.test(no)) return { error: `${label}: question numbers must be like 1, 11 or 12a` };
      if (seen.has(no.toLowerCase())) return { error: `Question ${no} appears twice` };
      seen.add(no.toLowerCase());
      const marks = Number(q?.marks);
      if (!Number.isFinite(marks) || marks <= 0 || marks > 100 || !isHalfStep(marks)) {
        return { error: `Q${no}: marks must be between 0.5 and 100` };
      }
      const mod = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
      const eitherOr = q?.either_or === true;
      questions.push({
        no, marks, either_or: eitherOr, module_id: mod(q?.module_id),
        ...(eitherOr && mod(q?.module_id_b) ? { module_id_b: mod(q?.module_id_b) } : {}),
      });
    }
    let answer = p?.answer_count === null || p?.answer_count === undefined || p?.answer_count === '' ? null : Number(p.answer_count);
    if (answer !== null) {
      if (!Number.isInteger(answer) || answer < 1 || answer > questions.length) {
        return { error: `${label}: "answer any" must be between 1 and ${questions.length}` };
      }
      if (answer === questions.length) answer = null;
    }
    parts.push({ key, label, answer_count: answer, questions });
  }
  return { pattern: { version: 1, parts } };
}

/**
 * Read one typed cell. Either/or cells take "12b", "12 B" or "12" (= option a).
 * Blank = not attempted.
 */
export function parseCell(v: unknown, eitherOr: boolean): { mark: QuestionMark | null } | { error: string } {
  if (v === null || v === undefined) return { mark: null };
  if (typeof v === 'object') {
    const o = v as any;
    return parseCell(o.o === 'b' ? `${o.m}b` : o.m, eitherOr);
  }
  const s = String(v).trim().toLowerCase();
  if (s === '') return { mark: null };
  const m = /^(\d+(?:\.\d+)?)\s*([ab])?$/.exec(s);
  if (!m) return { error: eitherOr ? 'Type a mark like 12 or 12b' : 'Marks must be a number' };
  if (m[2] && !eitherOr) return { error: 'This question has no (a)/(b) choice' };
  const n = Number(m[1]);
  if (!isHalfStep(n)) return { error: 'Marks go in halves (like 7.5)' };
  return { mark: eitherOr ? { m: n, o: (m[2] as 'a' | 'b') ?? 'a' } : n };
}

export interface ScoredPaper {
  total: number;
  parts: { key: string; score: number; max: number }[];
}

/** Total of a student's question marks; errors name the question. */
export function scoreQuestions(p: QuestionPattern, marks: Record<string, QuestionMark>): ScoredPaper | { error: string } {
  const byNo = new Map(p.parts.flatMap(part => part.questions.map(q => [q.no.toLowerCase(), q] as const)));
  for (const [no, m] of Object.entries(marks)) {
    const q = byNo.get(no.toLowerCase());
    if (!q) return { error: `Q${no} isn't on this paper` };
    const v = valueOf(m);
    if (!Number.isFinite(v) || v < 0) return { error: `Q${no}: marks must be a number` };
    if (!isHalfStep(v)) return { error: `Q${no}: marks go in halves (like 7.5)` };
    if (v > q.marks) return { error: `Q${no} is out of ${q.marks}` };
  }
  const lookup = new Map(Object.entries(marks).map(([k, m]) => [k.toLowerCase(), valueOf(m)]));
  const parts = p.parts.map(part => {
    const got = part.questions.map(q => lookup.get(q.no.toLowerCase()) ?? 0).sort((a, b) => b - a);
    const n = part.answer_count ?? got.length;
    return { key: part.key, score: round2(got.slice(0, n).reduce((s, v) => s + v, 0)), max: partMax(part) };
  });
  return { total: round2(parts.reduce((s, x) => s + x.score, 0)), parts };
}

/**
 * Percentage scored per unit, from questions tagged with a module. Questions
 * a student skipped in an "answer any N" part are left out (they chose other
 * questions); skipped questions elsewhere count as 0. Null when nothing is tagged.
 */
export function topicBreakdown(
  p: QuestionPattern, marks: Record<string, QuestionMark>, moduleNames: Map<number, string>,
): Record<string, number> | null {
  const lookup = new Map(Object.entries(marks).map(([k, m]) => [k.toLowerCase(), m]));
  const acc = new Map<string, { got: number; max: number }>();
  for (const part of p.parts) {
    for (const q of part.questions) {
      const m = lookup.get(q.no.toLowerCase());
      if (m === undefined && part.answer_count !== null) continue;
      const mod = q.either_or && m !== undefined && typeof m === 'object' && m.o === 'b' && q.module_id_b ? q.module_id_b : q.module_id;
      const name = mod ? moduleNames.get(mod) : undefined;
      if (!name) continue;
      const a = acc.get(name) ?? { got: 0, max: 0 };
      a.got += m === undefined ? 0 : valueOf(m);
      a.max += q.marks;
      acc.set(name, a);
    }
  }
  if (!acc.size) return null;
  return Object.fromEntries([...acc].map(([k, { got, max }]) => [k, round2((got / max) * 100)]));
}

/** True when two patterns describe the same paper (Postgres jsonb reorders keys, so compare normalised forms). */
export function samePattern(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  const na = validatePattern(a), nb = validatePattern(b);
  if ('error' in na || 'error' in nb) return JSON.stringify(a) === JSON.stringify(b);
  return JSON.stringify(na.pattern) === JSON.stringify(nb.pattern);
}

// ── Topics from the question paper ───────────────────────────────────────────
// The paper's analysis names topics and the questions each covers ("3", "7b",
// "8"). Weights and per-student scores come from the marks, not from the model.

/** A topic with the questions it covers: "7b" is option (b) of Q7, "8" either option. */
export interface MappedTopic { topic: string; questions: string[] }

/**
 * Question references normalised against the paper: "Q3" → "3", "7(b)" → "7b".
 * Unknown questions and options on plain questions are dropped (the plain
 * question is kept); duplicates removed; order kept.
 */
export function resolveQuestionRefs(refs: unknown[], p: QuestionPattern): string[] {
  const byNo = new Map(p.parts.flatMap(part => part.questions.map(q => [q.no.toLowerCase(), q] as const)));
  const out: string[] = [];
  for (const raw of refs) {
    const m = String(raw ?? '').trim().toLowerCase().match(/^(?:q(?:uestion)?\.?\s*)?(\d+[a-z]?\d*?)\s*\(?\s*([ab])?\s*\)?$/);
    if (!m) continue;
    let [, no, opt] = m;
    if (!byNo.has(no) && /^\d+[ab]$/.test(no) && byNo.has(no.slice(0, -1))) { opt = no.slice(-1); no = no.slice(0, -1); }
    const q = byNo.get(no);
    if (!q) continue;
    const ref = q.either_or && opt ? `${q.no.toLowerCase()}${opt}` : q.no.toLowerCase();
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/**
 * Marks each topic is worth and its share of the paper total. An option of an
 * (a)/(b) question counts the question's full marks (it's what a student who
 * writes it can earn). Topics without questions are left out.
 */
export function paperTopicWeights(p: QuestionPattern, topics: MappedTopic[]): Map<string, { marks: number; share: number }> {
  const byNo = new Map(p.parts.flatMap(part => part.questions.map(q => [q.no.toLowerCase(), q] as const)));
  const total = paperTotal(p);
  const out = new Map<string, { marks: number; share: number }>();
  for (const t of topics) {
    const seen = new Set<string>();
    let marks = 0;
    for (const ref of t.questions) {
      const no = ref.replace(/[ab]$/, '');
      const q = byNo.get(no) ?? byNo.get(ref);
      if (!q || seen.has(q.no)) continue;
      seen.add(q.no);
      marks += q.marks;
    }
    if (marks > 0) out.set(t.topic, { marks, share: total > 0 ? round2((marks / total) * 100) : 0 });
  }
  return out;
}

/**
 * Percentage a student scored per paper topic. A topic on one option of an
 * (a)/(b) question counts only for students who wrote that option (a plain
 * number means (a), as in the marks grid). Unanswered questions count as 0,
 * except in "answer any N" parts. Null when no topic applies.
 */
export function paperTopicBreakdown(
  p: QuestionPattern, marks: Record<string, QuestionMark>, topics: MappedTopic[],
): Record<string, number> | null {
  const lookup = new Map(Object.entries(marks ?? {}).map(([k, m]) => [k.toLowerCase(), m]));
  const questions = p.parts.flatMap(part => part.questions.map(q => ({ q, anyN: part.answer_count !== null })));
  const out: Record<string, number> = {};
  for (const t of topics) {
    const refs = new Set(t.questions.map(r => r.toLowerCase()));
    let got = 0, max = 0;
    for (const { q, anyN } of questions) {
      const no = q.no.toLowerCase();
      const m = lookup.get(no);
      if (m === undefined && anyN) continue;
      const option = q.either_or ? (m !== undefined && typeof m === 'object' ? m.o : 'a') : null;
      const applies = refs.has(no) || (option !== null && refs.has(`${no}${option}`));
      if (!applies) continue;
      got += m === undefined ? 0 : valueOf(m);
      max += q.marks;
    }
    if (max > 0) out[t.topic] = round2((got / max) * 100);
  }
  return Object.keys(out).length ? out : null;
}
