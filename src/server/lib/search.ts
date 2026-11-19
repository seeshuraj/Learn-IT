/**
 * The search box's query as an ILIKE pattern: at least 2 characters, at most
 * 80, with LIKE wildcards (% _ \) matched literally. null means "no search".
 */
export function readSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return null;
  return `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}
