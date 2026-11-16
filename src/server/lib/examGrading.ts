/**
 * Assessment marks: validation, percentage/band, and grades.
 *
 * Pure functions so the rules are unit-tested and shared by the grid save and
 * the file import. Nothing here touches the database.
 *
 * Grades are computed for end-semester assessments (or any assessment given an
 * explicit grade_scale). The default scale follows the common Anna University
 * pattern (Regulation 2021): O ≥ 91, A+ ≥ 81, A ≥ 71, B+ ≥ 61, B ≥ 56, C ≥ 50,
 * otherwise RA (re-appearance); AB for absent. When marks are split into
 * internal + external, a pass also needs the external part ≥ 45% of its
 * maximum. Colleges with other rules set unit_exams.grade_scale.
 */

export const ASSESSMENT_TYPES = ['unit_test', 'model', 'end_semester', 'quiz', 'lab', 'other'] as const;
export type AssessmentType = typeof ASSESSMENT_TYPES[number];

export interface GradeScale {
  /** Highest first. `min` is a percentage of max marks. */
  bands: { grade: string; min: number; point: number }[];
  fail: { grade: string; point: number };
  absent: { grade: string; point: number };
  /** Minimum external percentage to pass, when marks are split. 0 = no rule. */
  external_min_pct: number;
  /** Grades left out of SGPA/CGPA (not cleared yet). */
  gpa_excludes: string[];
}

export const DEFAULT_GRADE_SCALE: GradeScale = {
  bands: [
    { grade: 'O',  min: 91, point: 10 },
    { grade: 'A+', min: 81, point: 9 },
    { grade: 'A',  min: 71, point: 8 },
    { grade: 'B+', min: 61, point: 7 },
    { grade: 'B',  min: 56, point: 6 },
    { grade: 'C',  min: 50, point: 5 },
  ],
  fail:   { grade: 'RA', point: 0 },
  absent: { grade: 'AB', point: 0 },
  external_min_pct: 45,
  gpa_excludes: ['RA', 'AB', 'W'],
};

export interface ExamConfig {
  assessment_type: AssessmentType | string;
  max_marks: number | string;
  internal_max?: number | string | null;
  external_max?: number | string | null;
  grading_schema?: { strong: number; moderate: number } | null;
  grade_scale?: Partial<GradeScale> | null;
}

export interface ResultInput {
  student_id: number;
  absent?: boolean;
  marks?: number | string | null;
  internal?: number | string | null;
  external?: number | string | null;
  /** Optional grade override (end-semester), e.g. a moderation decision. */
  grade?: string | null;
  remarks?: string | null;
}

export interface ResultRow {
  student_id: number;
  is_absent: boolean;
  marks_obtained: number | null;
  internal_marks: number | null;
  external_marks: number | null;
  percentage: number | null;
  performance_band: 'strong' | 'moderate' | 'weak' | null;
  grade: string | null;
  grade_point: number | null;
  remarks: string | null;
}

export type ComputeOutcome =
  | { kind: 'row'; row: ResultRow }
  | { kind: 'clear'; student_id: number }
  | { kind: 'error'; student_id: number; error: string };

const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v)));
const round2 = (n: number) => Math.round(n * 100) / 100;
const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function resolveScale(exam: ExamConfig): GradeScale {
  const s = exam.grade_scale ?? {};
  return {
    bands: Array.isArray(s.bands) && s.bands.length > 0
      ? [...s.bands].sort((a, b) => b.min - a.min)
      : DEFAULT_GRADE_SCALE.bands,
    fail: s.fail ?? DEFAULT_GRADE_SCALE.fail,
    absent: s.absent ?? DEFAULT_GRADE_SCALE.absent,
    external_min_pct: typeof s.external_min_pct === 'number' ? s.external_min_pct : DEFAULT_GRADE_SCALE.external_min_pct,
    gpa_excludes: Array.isArray(s.gpa_excludes) ? s.gpa_excludes : DEFAULT_GRADE_SCALE.gpa_excludes,
  };
}

export function isSplit(exam: ExamConfig): boolean {
  return !blank(exam.internal_max) && !blank(exam.external_max);
}

export function usesGrades(exam: ExamConfig): boolean {
  return exam.assessment_type === 'end_semester' || !!exam.grade_scale;
}

/** Every grade a professor may type as an override. */
export function allowedGrades(exam: ExamConfig): string[] {
  const s = resolveScale(exam);
  return [...s.bands.map(b => b.grade), s.fail.grade, s.absent.grade, 'W'];
}

export function bandFor(percentage: number, schema?: { strong: number; moderate: number } | null) {
  const { strong, moderate } = schema ?? { strong: 75, moderate: 50 };
  if (percentage >= strong) return 'strong' as const;
  if (percentage >= moderate) return 'moderate' as const;
  return 'weak' as const;
}

export function gradeFor(
  exam: ExamConfig,
  percentage: number,
  externalPct: number | null,
): { grade: string; point: number } {
  const s = resolveScale(exam);
  const failsExternal = externalPct !== null && s.external_min_pct > 0 && externalPct < s.external_min_pct;
  if (!failsExternal) {
    for (const b of s.bands) if (percentage >= b.min) return { grade: b.grade, point: b.point };
  }
  return { grade: s.fail.grade, point: s.fail.point };
}

function pointForGrade(exam: ExamConfig, grade: string): number {
  const s = resolveScale(exam);
  const band = s.bands.find(b => b.grade === grade);
  if (band) return band.point;
  if (grade === s.absent.grade) return s.absent.point;
  return s.fail.point; // RA, W
}

function readMark(label: string, v: unknown, max: number): number | string {
  const n = num(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0 || n > max) return `${label} ${n} is outside 0–${max}`;
  if (Math.abs(round2(n) - n) > 1e-9) return `${label} can have at most 2 decimal places`;
  return n;
}

/**
 * Turn one entered row into what is stored. Blank row (no marks, not absent,
 * no grade) means "clear this student's result".
 */
export function computeResult(exam: ExamConfig, input: ResultInput): ComputeOutcome {
  const sid = input.student_id;
  const max = num(exam.max_marks);
  const remarks = blank(input.remarks) ? null : String(input.remarks).trim().slice(0, 500);
  const override = blank(input.grade) ? null : String(input.grade).trim().toUpperCase();
  const grades = usesGrades(exam);
  const scale = resolveScale(exam);

  if (override && !grades) return { kind: 'error', student_id: sid, error: 'Grades apply only to end-semester assessments' };
  if (override && !allowedGrades(exam).includes(override)) {
    return { kind: 'error', student_id: sid, error: `Grade must be one of ${allowedGrades(exam).join(', ')}` };
  }

  if (input.absent) {
    return {
      kind: 'row',
      row: {
        student_id: sid, is_absent: true, marks_obtained: null, internal_marks: null, external_marks: null,
        percentage: null, performance_band: null,
        grade: grades ? scale.absent.grade : null, grade_point: grades ? scale.absent.point : null,
        remarks,
      },
    };
  }

  let marks: number;
  let internal: number | null = null;
  let external: number | null = null;

  if (isSplit(exam)) {
    if (blank(input.internal) && blank(input.external)) {
      return override || remarks
        ? { kind: 'error', student_id: sid, error: 'Enter internal and external marks, or mark absent' }
        : { kind: 'clear', student_id: sid };
    }
    if (blank(input.internal) || blank(input.external)) {
      return { kind: 'error', student_id: sid, error: 'Enter both internal and external marks' };
    }
    const i = readMark('Internal', input.internal, num(exam.internal_max));
    if (typeof i === 'string') return { kind: 'error', student_id: sid, error: i };
    const e = readMark('External', input.external, num(exam.external_max));
    if (typeof e === 'string') return { kind: 'error', student_id: sid, error: e };
    internal = i; external = e;
    marks = round2(i + e);
  } else {
    if (blank(input.marks)) {
      return override || remarks
        ? { kind: 'error', student_id: sid, error: 'Enter marks, or mark absent' }
        : { kind: 'clear', student_id: sid };
    }
    const m = readMark('Marks', input.marks, max);
    if (typeof m === 'string') return { kind: 'error', student_id: sid, error: m };
    marks = m;
  }

  const percentage = round2((marks / max) * 100);
  let grade: string | null = null;
  let point: number | null = null;
  if (grades) {
    if (override) {
      grade = override;
      point = pointForGrade(exam, override);
    } else {
      const extPct = external !== null ? (external / num(exam.external_max)) * 100 : null;
      ({ grade, point } = gradeFor(exam, percentage, extPct));
    }
  }

  return {
    kind: 'row',
    row: {
      student_id: sid, is_absent: false, marks_obtained: marks, internal_marks: internal, external_marks: external,
      percentage, performance_band: bandFor(percentage, exam.grading_schema),
      grade, grade_point: point, remarks,
    },
  };
}

/** Values that mean "absent" in a marks cell or an absent column. */
const ABSENT_WORDS = new Set(['ab', 'a', 'abs', 'absent', 'aa']);
const TRUE_WORDS = new Set(['y', 'yes', 'true', '1', 'x', ...ABSENT_WORDS]);

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (row[k] !== undefined && !blank(row[k])) return row[k];
  return undefined;
}

export interface SheetRow {
  email: string | null;
  studentId: number | null;
  input: Omit<ResultInput, 'student_id'>;
}

/**
 * Read one spreadsheet row (headers already lower_snake_cased). Accepts the
 * usual college headers: email / student_id, marks / total, internal / cia,
 * external / ese, absent, grade, remarks. "AB" in a marks cell means absent.
 */
export function readSheetRow(row: Record<string, unknown>): SheetRow {
  const emailRaw = pick(row, ['email', 'student_email', 'email_id', 'mail']);
  const idRaw = pick(row, ['student_id', 'id', 'user_id']);
  const id = idRaw === undefined ? NaN : Number(idRaw);

  const marks = pick(row, ['marks', 'marks_obtained', 'total', 'score', 'obtained', 'total_marks']);
  const internal = pick(row, ['internal', 'internal_marks', 'cia', 'ia', 'internal_assessment']);
  const external = pick(row, ['external', 'external_marks', 'ese', 'end_semester', 'university', 'theory']);
  const absentCol = pick(row, ['absent', 'is_absent']);
  const grade = pick(row, ['grade', 'result_grade']);

  const isAbsentWord = (v: unknown) => v !== undefined && ABSENT_WORDS.has(String(v).trim().toLowerCase());
  const absent =
    (absentCol !== undefined && TRUE_WORDS.has(String(absentCol).trim().toLowerCase())) ||
    isAbsentWord(marks) || isAbsentWord(external) ||
    (grade !== undefined && String(grade).trim().toUpperCase() === 'AB');

  const clean = (v: unknown) => (v === undefined || isAbsentWord(v) ? null : (v as number | string));
  const remarks = pick(row, ['remarks', 'comments', 'remark']);

  return {
    email: emailRaw === undefined ? null : String(emailRaw).trim().toLowerCase(),
    studentId: Number.isInteger(id) && id > 0 ? id : null,
    input: {
      absent,
      marks: clean(marks),
      internal: clean(internal),
      external: clean(external),
      // "A" is a real grade here, so the grade column is never read as absent.
      grade: grade === undefined ? null : String(grade),
      remarks: remarks === undefined ? null : String(remarks),
    },
  };
}

export function isAssessmentType(v: unknown): v is AssessmentType {
  return typeof v === 'string' && (ASSESSMENT_TYPES as readonly string[]).includes(v);
}

export interface GpaRow {
  semester: number | null;
  credits: number | string | null;
  grade: string | null;
  grade_point: number | string | null;
  /** The assessment's own scale, if it has one. */
  grade_scale?: Partial<GradeScale> | null;
}

export interface GpaSummary {
  semesters: { semester: number; sgpa: number | null; credits: number; courses: number }[];
  cgpa: number | null;
}

/**
 * SGPA per semester and CGPA: Σ(credits × grade point) / Σ credits over
 * graded end-semester courses. Grades not yet cleared (RA, AB, W by default)
 * are left out, as Anna University does. Rows without credits or a semester
 * can't be placed and are skipped.
 */
export function gpaSummary(rows: GpaRow[]): GpaSummary {
  const bySem = new Map<number, { points: number; credits: number; courses: number }>();
  for (const r of rows) {
    const credits = num(r.credits);
    const gp = num(r.grade_point);
    if (r.semester === null || r.semester === undefined || !(credits > 0) || !r.grade || !Number.isFinite(gp)) continue;
    const excludes = resolveScale({ assessment_type: 'end_semester', max_marks: 100, grade_scale: r.grade_scale }).gpa_excludes;
    const s = bySem.get(r.semester) ?? { points: 0, credits: 0, courses: 0 };
    s.courses += 1;
    if (!excludes.includes(r.grade)) { s.points += credits * gp; s.credits += credits; }
    bySem.set(r.semester, s);
  }
  const semesters = [...bySem.entries()].sort((a, b) => a[0] - b[0]).map(([semester, s]) => ({
    semester,
    sgpa: s.credits > 0 ? round2(s.points / s.credits) : null,
    credits: s.credits,
    courses: s.courses,
  }));
  const tp = [...bySem.values()].reduce((a, s) => a + s.points, 0);
  const tc = [...bySem.values()].reduce((a, s) => a + s.credits, 0);
  return { semesters, cgpa: tc > 0 ? round2(tp / tc) : null };
}
