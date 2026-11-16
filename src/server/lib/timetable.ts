/**
 * Exam timetable rows: reading dates, sessions and times the way Indian
 * college timetables write them, and matching rows to courses.
 *
 * Pure functions (tested). Spreadsheet rows and AI-read rows both end up as
 * `RawEntry` and go through `normaliseEntry`.
 */

export interface RawEntry {
  row?: number;
  date?: unknown;
  session?: unknown;   // FN / AN / "Forenoon"…
  time?: unknown;      // "10.00 AM - 1.00 PM", "9:30 to 12:30"
  start?: unknown;
  end?: unknown;
  course_code?: unknown;
  course_name?: unknown;
  department?: unknown;
  year?: unknown;
  semester?: unknown;
  venue?: unknown;
}

export interface Entry {
  row_number: number | null;
  exam_date: string | null;       // YYYY-MM-DD
  session: 'FN' | 'AN' | null;
  start_time: string | null;      // HH:MM (24 h)
  end_time: string | null;
  course_code: string | null;
  course_name: string | null;
  department_text: string | null;
  year_of_study: number | null;
  semester: number | null;
  venue: string | null;
  problems: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 Feb etc.
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Dates as written in timetables. Numeric dates are day-first (12/11/2026 is
 * 12 November), as in India. Excel serial numbers and Date objects work too.
 */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial (1900 system): day 25569 is 1970-01-01.
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  let s = str(v).toLowerCase();
  if (!s) return null;
  s = s.replace(/\(.*?\)/g, ' ')
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b\.?,?/g, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  const month = (w: string) => MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
  m = s.match(/^(\d{1,2})[-/.\s]+([a-z]{3,9})[-/.,\s]+(\d{2,4})$/);
  if (m && month(m[2])) return validYmd(+m[3], month(m[2]), +m[1]);
  m = s.match(/^([a-z]{3,9})[-/.\s]+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m && month(m[1])) return validYmd(+m[3], month(m[1]), +m[2]);
  return null;
}

function sessionWord(s: string): 'FN' | 'AN' | null {
  const t = s.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(fn|forenoon|morning|am|session1|i)$/.test(t)) return 'FN';
  if (/^(an|afternoon|evening|pm|session2|ii)$/.test(t)) return 'AN';
  return null;
}

/** "10", "10.30", "10:30 am", "1.30 PM" → minutes since midnight; hasMeridiem tells if am/pm was given. */
function clock(s: string): { min: number; meridiem: 'am' | 'pm' | null } | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  const mer = m[3]?.startsWith('p') ? 'pm' : m[3]?.startsWith('a') ? 'am' : m[3] === 'noon' ? 'pm' : null;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return { min: h * 60 + min, meridiem: mer };
}

const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * Session and times from a cell like "FN", "AN (2.00 - 5.00)",
 * "10.00 AM to 1.00 PM" or "9:30-12:30". Times without am/pm that would go
 * backwards (10.00 - 1.00) are read as running past noon.
 */
export function parseTime(v: unknown): { session: 'FN' | 'AN' | null; start: string | null; end: string | null } {
  const s = str(v);
  if (!s) return { session: null, start: null, end: null };
  let session = sessionWord(s.split(/[\s(]/)[0] ?? '') ?? sessionWord(s);
  const range = s.replace(/^[^\d]*/, '').replace(/\).*$/, '').split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  let start: number | null = null, end: number | null = null;
  if (range.length >= 1) {
    const a = clock(range[0]);
    const b = range[1] ? clock(range[1]) : null;
    if (a) {
      start = a.min;
      if (b) {
        end = b.min;
        if (!b.meridiem && end <= start && end + 720 > start) end += 720;   // 10.00 - 1.00
        if (!a.meridiem && b.meridiem === 'pm' && start + 720 < end && a.min < 8 * 60) start += 720; // 2.00 - 5.00 PM
        if (end <= start) end = null;
      }
    }
  }
  // Plain "1.30 - 4.30" in an AN slot, or an exam "starting at 2", is afternoon.
  if (start !== null && !/[ap]\.?m|noon/i.test(s) && (start < 7 * 60 || (session === 'AN' && start < 12 * 60))) {
    start += 720;
    if (end !== null && end < 12 * 60) end += 720;
  }
  if (!session && start !== null) session = start < 12 * 60 ? 'FN' : 'AN';
  return { session, start: start === null ? null : hhmm(start), end: end === null ? null : hhmm(end) };
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** "III", "3rd year", "Year 2", "Sem V", "5" → number. */
export function parseOrdinal(v: unknown, max: number): number | null {
  const s = str(v).toLowerCase().replace(/\b(year|yr|sem|semester|st|nd|rd|th)\b|\./g, ' ').trim();
  if (!s) return null;
  const word = s.split(/\s+/).find(w => /^\d+$/.test(w) || ROMAN[w] !== undefined);
  const digits = s.match(/\d+/)?.[0];
  const n = word ? (ROMAN[word] ?? Number(word)) : digits ? Number(digits) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

const clean = (v: unknown, max: number) => {
  const s = str(v).replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};

export function normaliseEntry(raw: RawEntry): Entry {
  const problems: string[] = [];
  const exam_date = parseDate(raw.date);
  if (!exam_date) problems.push(str(raw.date) ? `Date "${str(raw.date)}" not understood` : 'Date missing');

  let t = parseTime(raw.time);
  if (raw.session !== undefined && str(raw.session)) {
    const s = parseTime(raw.session);
    t = { session: s.session ?? t.session, start: t.start ?? s.start, end: t.end ?? s.end };
  }
  if (raw.start !== undefined && str(raw.start)) {
    const a = parseTime(`${str(raw.start)}${str(raw.end) ? ` - ${str(raw.end)}` : ''}`);
    t = { session: t.session ?? a.session, start: a.start, end: a.end ?? t.end };
  }

  const course_code = clean(raw.course_code, 50)?.toUpperCase().replace(/\s+/g, '') ?? null;
  const course_name = clean(raw.course_name, 255);
  if (!course_code && !course_name) problems.push('Course code or name missing');

  return {
    row_number: Number.isInteger(raw.row) ? (raw.row as number) : null,
    exam_date,
    session: t.session,
    start_time: t.start,
    end_time: t.end,
    course_code,
    course_name,
    department_text: clean(raw.department, 200),
    year_of_study: parseOrdinal(raw.year, 10),
    semester: parseOrdinal(raw.semester, 12),
    venue: clean(raw.venue, 200),
    problems,
  };
}

// ── Spreadsheets in "one exam per row" layout ────────────────────────────────

const HEADERS: Record<keyof RawEntry, string[]> = {
  row: [],
  date: ['date', 'exam_date', 'date_of_exam', 'exam_day', 'day_date'],
  session: ['session', 'fn_an', 'slot', 'shift'],
  time: ['time', 'timing', 'timings', 'exam_time', 'time_slot'],
  start: ['start', 'start_time', 'from', 'time_from'],
  end: ['end', 'end_time', 'to', 'time_to'],
  course_code: ['course_code', 'subject_code', 'sub_code', 'paper_code', 'code', 'course_no', 'subject_no'],
  course_name: ['course_name', 'subject_name', 'subject', 'course', 'course_title', 'subject_title', 'paper', 'title'],
  department: ['department', 'dept', 'branch', 'programme', 'program', 'discipline'],
  year: ['year', 'year_of_study', 'class', 'yr'],
  semester: ['semester', 'sem'],
  venue: ['venue', 'hall', 'room', 'exam_hall', 'block'],
};

/** Map a row's (lower_snake) headers to RawEntry fields. */
export function readTimetableRow(row: Record<string, unknown>, rowNumber: number): RawEntry {
  const out: RawEntry = { row: rowNumber };
  for (const [field, names] of Object.entries(HEADERS) as [keyof RawEntry, string[]][]) {
    for (const n of names) {
      if (row[n] !== undefined && str(row[n]) !== '') { (out as any)[field] = row[n]; break; }
    }
  }
  return out;
}

/** True when the sheet's headers name a date and a course in each row. */
export function isRowPerExam(headers: string[]): boolean {
  const has = (f: keyof RawEntry) => HEADERS[f].some(h => headers.includes(h));
  return has('date') && (has('course_code') || has('course_name'));
}

// ── Matching rows to courses ─────────────────────────────────────────────────

export interface CourseRef { id: number; code: string | null; name: string | null; department_id: number | null; semester: number | null }

const nameKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

/**
 * Course for a row: by code first (exact, case/space-insensitive), then by
 * name when exactly one course has that name.
 */
export function matchCourse(e: Pick<Entry, 'course_code' | 'course_name'>, courses: CourseRef[]): { course: CourseRef | null; how: 'code' | 'name' | null; problem?: string } {
  if (e.course_code) {
    const byCode = courses.filter(c => c.code && c.code.toUpperCase().replace(/\s+/g, '') === e.course_code);
    if (byCode.length === 1) return { course: byCode[0], how: 'code' };
  }
  if (e.course_name) {
    const k = nameKey(e.course_name);
    const byName = courses.filter(c => c.name && nameKey(c.name) === k);
    if (byName.length === 1) return { course: byName[0], how: 'name' };
    if (byName.length > 1) return { course: null, how: null, problem: 'Several courses have this name; add the course code' };
  }
  return { course: null, how: null, problem: e.course_code ? `No course with code ${e.course_code}` : 'No course with this name' };
}

/** Default marks for an assessment created from the timetable; professors can change them. */
export function defaultMarks(type: string): { max: number; internal: number | null; external: number | null } {
  switch (type) {
    case 'unit_test': return { max: 50, internal: null, external: null };
    case 'end_semester': return { max: 100, internal: 40, external: 60 };
    case 'quiz': return { max: 20, internal: null, external: null };
    case 'lab': return { max: 50, internal: null, external: null };
    default: return { max: 100, internal: null, external: null };
  }
}

/** Times used when a row only says FN or AN (calendar entries need a time). */
export const SESSION_TIMES = { FN: { start: '09:30', end: '12:30' }, AN: { start: '13:30', end: '16:30' } } as const;
/** What still needs the admin's attention on a row. */
export function entryProblems(e: { exam_date: string | null; course_id: number | null; department_id: number | null; year_of_study: number | null }): string[] {
  const p: string[] = [];
  if (!e.exam_date) p.push('Date missing');
  if (!e.course_id && !(e.department_id && e.year_of_study)) p.push('Not matched to a course, department or year: nobody would be told');
  else if (!e.course_id) p.push('No matching course: students are told, no professor is');
  return p;
}
