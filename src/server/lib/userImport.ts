/**
 * Bulk user import: validation and normalisation of rows from an admin's
 * CSV/XLSX. Pure functions only, so the rules are unit-tested; the route does
 * the parsing, account creation and email.
 */

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_BATCH_SIZE = 50;

/** Roles a college admin may create in bulk. Admins are added one at a time. */
export const IMPORTABLE_ROLES = ['student', 'instructor'] as const;
export type ImportRole = (typeof IMPORTABLE_ROLES)[number];

export interface ImportRow {
  /** Spreadsheet row number (header is row 1), for error messages. */
  row: number;
  name: string;
  email: string;
  role: ImportRole;
  year: number | null;
  major: string | null;
}

export interface ImportIssue {
  row: number;
  email?: string;
  reason: string;
}

const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, 'row'>> = {
  name: 'name', full_name: 'name', student_name: 'name',
  email: 'email', e_mail: 'email', email_address: 'email', email_id: 'email', college_email: 'email', mail: 'email',
  role: 'role', type: 'role', user_type: 'role',
  year: 'year', year_of_study: 'year', semester_year: 'year',
  major: 'major', department: 'major', dept: 'major', branch: 'major', programme: 'major', program: 'major',
};

const ROLE_ALIASES: Record<string, ImportRole> = {
  student: 'student', students: 'student', learner: 'student',
  instructor: 'instructor', faculty: 'instructor', teacher: 'instructor',
  professor: 'instructor', lecturer: 'instructor', staff: 'instructor',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Email Address" → "email_address". */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function cell(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Maps a raw spreadsheet row (any header spelling) onto the import fields. */
function mapRow(raw: Record<string, unknown>): Partial<Record<keyof Omit<ImportRow, 'row'>, string>> {
  const out: Partial<Record<keyof Omit<ImportRow, 'row'>, string>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = HEADER_ALIASES[normaliseHeader(key)];
    if (field && out[field] === undefined) out[field] = cell(value);
  }
  return out;
}

/**
 * Validates spreadsheet rows. `existingEmails` (lower-case) are accounts that
 * already exist anywhere on the platform; those rows are reported, not created.
 */
export function validateImportRows(
  rawRows: Array<Record<string, unknown>>,
  existingEmails: ReadonlySet<string> = new Set(),
): { valid: ImportRow[]; issues: ImportIssue[] } {
  const valid: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  if (rawRows.length > IMPORT_MAX_ROWS) {
    return { valid, issues: [{ row: 0, reason: `File has ${rawRows.length} rows; the limit is ${IMPORT_MAX_ROWS} per import.` }] };
  }

  rawRows.forEach((raw, i) => {
    const row = i + 2;
    const f = mapRow(raw);
    if (!Object.values(f).some(Boolean)) return; // blank line

    const email = (f.email ?? '').toLowerCase();
    const name = (f.name ?? '').replace(/\s+/g, ' ');
    const roleText = (f.role ?? '').toLowerCase();
    const role: ImportRole | undefined = roleText ? ROLE_ALIASES[roleText] : 'student';

    if (!email) return void issues.push({ row, reason: 'Email is missing' });
    if (!EMAIL_RE.test(email) || email.length > 254) return void issues.push({ row, email, reason: 'Email is not valid' });
    if (!name) return void issues.push({ row, email, reason: 'Name is missing' });
    if (name.length > 255) return void issues.push({ row, email, reason: 'Name is longer than 255 characters' });
    if (!role) {
      return void issues.push({ row, email, reason: `Role "${f.role}" is not recognised; use student or instructor` });
    }
    if (seen.has(email)) return void issues.push({ row, email, reason: 'Email appears more than once in this file' });
    if (existingEmails.has(email)) return void issues.push({ row, email, reason: 'An account with this email already exists' });

    let year: number | null = null;
    if (f.year) {
      const y = Number(f.year);
      if (!Number.isInteger(y) || y < 1 || y > 10) return void issues.push({ row, email, reason: 'Year must be a whole number from 1 to 10' });
      year = y;
    }
    const major = f.major ? f.major.slice(0, 255) : null;

    seen.add(email);
    valid.push({ row, name, email, role, year: role === 'student' ? year : null, major });
  });

  return { valid, issues };
}

/** Header line of the downloadable template. */
export const IMPORT_TEMPLATE_HEADER = 'name,email,role,year,department';
