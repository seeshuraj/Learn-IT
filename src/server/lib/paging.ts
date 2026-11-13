/**
 * Paging helpers for list endpoints.
 *
 * Lists that grow with a college (submissions, users) are returned a page at a
 * time. Keyset cursors are used where rows arrive continuously (submissions),
 * so a page never repeats or skips rows while new ones come in; offsets are
 * fine for bounded, alphabetical lists (users of one college).
 */

export function parseLimit(raw: unknown, def: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

export function parseOffset(raw: unknown, max = 100_000): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

export interface TimeCursor { at: string; id: number }

/** Opaque cursor for (timestamp DESC, id DESC) ordering. */
export function encodeCursor(c: TimeCursor): string {
  return Buffer.from(`${c.at}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: unknown): TimeCursor | null {
  if (typeof raw !== 'string' || !raw || raw.length > 200) return null;
  try {
    const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || Number.isNaN(Date.parse(at))) return null;
    return { at: new Date(at).toISOString(), id: n };
  } catch {
    return null;
  }
}

/** Search text for ILIKE: trimmed, capped, with LIKE wildcards escaped. */
export function likePattern(raw: unknown): string | null {
  const q = String(raw ?? '').trim().slice(0, 100);
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}
