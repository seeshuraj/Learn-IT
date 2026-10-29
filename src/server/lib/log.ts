/**
 * log.ts — structured JSON logger for the API and workers.
 *
 * One JSON object per line on stdout (info/warn) or stderr (error), so
 * Render's log pipeline and any drain can parse it. Pretty-printed in dev.
 *
 * Never pass secrets, tokens, request bodies, file contents, or student PII
 * as fields. Known-sensitive keys are redacted defensively anyway.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const REDACT = /pass(word)?|secret|token|authorization|api[_-]?key|cookie|jwt|service[_-]?role/i;
const isProduction = () => process.env.NODE_ENV === 'production';

function sanitize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACT.test(key) ? '[redacted]' : value;
  }
  return out;
}

/** Reduce an unknown thrown value to loggable, non-sensitive fields. */
export function errorFields(err: unknown): Fields {
  if (err instanceof Error) {
    const pg = err as Error & { code?: string; constraint?: string; table?: string };
    return {
      errName: err.name,
      errMessage: err.message,
      ...(pg.code ? { pgCode: pg.code } : {}),
      ...(pg.constraint ? { pgConstraint: pg.constraint } : {}),
      ...(pg.table ? { pgTable: pg.table } : {}),
      ...(isProduction() ? {} : { stack: err.stack }),
    };
  }
  return { errMessage: String(err) };
}

function write(level: Level, msg: string, fields: Fields = {}): void {
  if (level === 'debug' && isProduction()) return;
  const entry = { level, ts: new Date().toISOString(), msg, ...sanitize(fields) };
  if (!isProduction()) {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(sanitize(fields))}` : '';
    (level === 'error' ? console.error : console.log)(`[${level}] ${msg}${extra}`);
    return;
  }
  (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(entry) + '\n');
}

export const log = {
  debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
  info:  (msg: string, fields?: Fields) => write('info', msg, fields),
  warn:  (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
