/** Pure helpers for the rate limiters (kept free of express-rate-limit for testing). */

interface KeyedRequest {
  ip?: string;
  auth?: { legacyUserId?: number; institutionId?: string };
}

/** Reads RATE_<NAME>_MAX, falling back to the default for invalid values. */
export function limitFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[`RATE_${name}_MAX`];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Signed-in requests are counted per user; anything else falls back to the client IP. */
export function userKey(req: KeyedRequest): string {
  const auth = req.auth;
  if (auth?.legacyUserId !== undefined) return `u:${auth.institutionId}:${auth.legacyUserId}`;
  return `ip:${req.ip ?? "unknown"}`;
}

