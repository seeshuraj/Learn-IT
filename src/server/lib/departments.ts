/**
 * Departments: matching the free text people type ("CSE", "Computer Science
 * and Engineering", "cse ") to one department of a college.
 */

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** "Computer Science & Engg." → "COMPUTERSCIENCE&ENGG." (≤ 20 chars, schema-safe). */
export function codeFromText(text: string): string | null {
  const code = text.trim().toUpperCase().replace(/[^A-Z0-9&.\-]/g, '').replace(/^[^A-Z0-9]+/, '').slice(0, 20);
  return code || null;
}

export function cleanName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * The department matching `text` by code or name (case-insensitive). With
 * `create`, an unknown one is added (bulk import: admins type department names).
 */
export async function resolveDepartmentId(
  db: Db, institutionId: string, text: string | null | undefined, opts: { create?: boolean } = {},
): Promise<number | null> {
  if (!text || !text.trim()) return null;
  const name = cleanName(text);
  const code = codeFromText(text);
  const found = await db.query(
    `SELECT id FROM departments
     WHERE institution_id = $1 AND (code = $2 OR lower(name) = lower($3))
     ORDER BY (code = $2) DESC LIMIT 1`,
    [institutionId, code, name],
  );
  if (found.rows[0]) return found.rows[0].id;
  if (!opts.create || !code) return null;
  const made = await db.query(
    `INSERT INTO departments (institution_id, code, name) VALUES ($1, $2, $3)
     ON CONFLICT (institution_id, code) DO UPDATE SET updated_at = departments.updated_at
     RETURNING id`,
    [institutionId, code, name],
  );
  return made.rows[0]?.id ?? null;
}

/** Year of study for a semester: 1–2 → 1, 3–4 → 2… */
export const yearOfSemester = (semester: number) => Math.ceil(semester / 2);

export type Placement =
  | { hasDept: boolean; dept: number | null; hasSem: boolean; sem: number | null }
  | { error: string };

/**
 * A course placement edit. Only the fields sent change; a field that isn't
 * sent is never turned into a value (an earlier version sent NaN to Postgres).
 */
export function readPlacement(body: any): Placement {
  const b = body ?? {};
  const hasDept = b.department_id !== undefined;
  const hasSem = b.semester !== undefined;
  if (!hasDept && !hasSem) return { error: 'Nothing to change' };
  const blank = (v: unknown) => v === null || v === '';
  const dept = hasDept && !blank(b.department_id) ? Number(b.department_id) : null;
  const sem = hasSem && !blank(b.semester) ? Number(b.semester) : null;
  if (dept !== null && !(Number.isInteger(dept) && dept > 0)) return { error: 'Invalid department' };
  if (sem !== null && !(Number.isInteger(sem) && sem >= 1 && sem <= 12)) return { error: 'Semester must be 1–12' };
  return { hasDept, dept, hasSem, sem };
}
