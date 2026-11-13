/**
 * AI usage metering and per-college monthly budgets.
 *
 * Every chat-model call made while handling a request is attributed to the
 * request's (or queued job's) college, user, feature and (when known) course, and written to
 * ai_usage_events in small batches off the request path. Before each call
 * the college's month-to-date tokens are checked against its allowance
 * (institutions.ai_monthly_token_budget, else AI_MONTHLY_TOKEN_BUDGET;
 * unset or 0 means unlimited).
 *
 * Attribution uses AsyncLocalStorage, so route handlers and the LLM client
 * need no extra parameters. Calls outside a request (startup probe,
 * background re-embedding) carry no college and are not recorded.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { LlmUsage } from './llm.js';
import { log, errorFields } from './log.js';

// ── Request context ──────────────────────────────────────────────────────────

interface Store { req?: Request; feature: string; courseId?: number; job?: { institutionId: string; userId: number | null } }
const als = new AsyncLocalStorage<Store>();

const FEATURES: Array<[RegExp, string]> = [
  [/^\/api\/ai\/chat/, 'tutor_chat'],
  [/^\/api\/ai\/analytics-summary/, 'analytics_summary'],
  [/^\/api\/ai\//, 'ai_other'],
  [/^\/api\/submissions\/[^/]+\/(ai-)?grade|^\/api\/submissions/, 'grading'],
  [/^\/api\/roadmaps/, 'roadmap'],
  [/^\/api\/unit-exams/, 'exam_analysis'],
  [/^\/api\/notes/, 'notes'],
];

export function featureForPath(path: string): string {
  const clean = path.split('?')[0];
  return FEATURES.find(([re]) => re.test(clean))?.[1] ?? 'other';
}

/** Mount before the API routes. */
export function aiContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  als.run({ req, feature: featureForPath(req.originalUrl || req.url) }, next);
}

/** Lets a handler attribute its AI calls to a course (e.g. the module's course). */
export function setAiCourse(courseId: number | null | undefined): void {
  const store = als.getStore();
  if (store && Number.isInteger(courseId)) store.courseId = courseId as number;
}

export interface AiContext { institutionId: string; userId: number | null; feature: string; courseId: number | null }

/**
 * Runs background work (a queued job) with the same attribution as a request:
 * its AI calls are metered to the college and checked against its allowance.
 */
export function runWithAiContext<T>(ctx: Omit<AiContext, 'courseId'> & { courseId?: number | null }, fn: () => Promise<T>): Promise<T> {
  return als.run({
    feature: ctx.feature,
    courseId: ctx.courseId ?? undefined,
    job: { institutionId: ctx.institutionId, userId: ctx.userId },
  }, fn);
}

export function currentAiContext(): AiContext | null {
  const store = als.getStore();
  if (store?.job) {
    return { institutionId: store.job.institutionId, userId: store.job.userId, feature: store.feature, courseId: store.courseId ?? null };
  }
  const auth = (store?.req as any)?.auth as { institutionId?: string; legacyUserId?: number } | undefined;
  if (!store || !auth?.institutionId) return null;
  return {
    institutionId: auth.institutionId,
    userId: Number.isInteger(auth.legacyUserId) ? auth.legacyUserId! : null,
    feature: store.feature,
    courseId: store.courseId ?? null,
  };
}

// ── Recording ────────────────────────────────────────────────────────────────

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

interface Row extends AiContext, LlmUsage {}

/** Buffers usage rows and inserts them in batches; never throws into the caller. */
export class AiUsageRecorder {
  private buffer: Row[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly opts: { flushMs?: number; maxBatch?: number; maxBuffer?: number } = {},
  ) {}

  record(ctx: AiContext, usage: LlmUsage): void {
    const maxBuffer = this.opts.maxBuffer ?? 5_000;
    if (this.buffer.length >= maxBuffer) {
      log.warn('ai usage buffer full; dropping event', { feature: ctx.feature });
      return;
    }
    this.buffer.push({ ...ctx, ...usage });
    if (this.buffer.length >= (this.opts.maxBatch ?? 50)) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.flushMs ?? 5_000);
      this.timer.unref?.();
    }
  }

  get pending(): number { return this.buffer.length; }

  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flushing = (async () => {
      const cols = 10;
      const values: unknown[] = [];
      const tuples = batch.map((r, i) => {
        values.push(r.institutionId, r.userId, r.courseId, r.feature.slice(0, 40), r.model.slice(0, 120),
          Math.max(0, Math.round(r.promptTokens)), Math.max(0, Math.round(r.completionTokens)),
          r.estimated, Math.max(0, Math.round(r.latencyMs)), r.status);
        return `(${Array.from({ length: cols }, (_, k) => `$${i * cols + k + 1}`).join(', ')})`;
      });
      try {
        await this.db.query(
          `INSERT INTO ai_usage_events
             (institution_id, user_id, course_id, feature, model, prompt_tokens, completion_tokens, estimated, latency_ms, status)
           VALUES ${tuples.join(', ')}`,
          values,
        );
      } catch (e) {
        // Metering must never break the product; the events are lost and logged.
        log.error('ai usage flush failed', { events: batch.length, ...errorFields(e) });
      }
    })();
    try { await this.flushing; } finally { this.flushing = null; }
  }
}

// ── Budgets ──────────────────────────────────────────────────────────────────

export class AiBudgetExceeded extends Error {
  readonly status = 429;
  constructor() {
    super("Your college's AI allowance for this month has been used up. AI features will be available again next month, or ask your college administrator to contact LearnIT.");
    this.name = 'AiBudgetExceeded';
  }
}

/** First instant of the current month in UTC. */
export function monthStart(nowMs: number): Date {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

interface BudgetState { budget: number | null; usedAtLoad: number; addedSince: number; loadedAt: number; month: number }

/**
 * Month-to-date token check per college. The DB total is cached for
 * `cacheMs` and topped up in memory with this instance's own calls, so the
 * check costs one query per college per minute rather than one per call.
 */
export class AiBudgetGuard {
  private state = new Map<string, BudgetState>();

  constructor(
    private readonly db: Queryable,
    private readonly opts: { defaultBudget: number | null; cacheMs?: number; now?: () => number },
  ) {}

  private now() { return (this.opts.now ?? Date.now)(); }

  private async load(institutionId: string): Promise<BudgetState> {
    const t = this.now();
    const month = monthStart(t).getTime();
    const cached = this.state.get(institutionId);
    if (cached && cached.month === month && t - cached.loadedAt < (this.opts.cacheMs ?? 60_000)) return cached;

    const { rows } = await this.db.query(
      `SELECT i.ai_monthly_token_budget AS budget,
              COALESCE((SELECT SUM(prompt_tokens + completion_tokens) FROM ai_usage_events e
                         WHERE e.institution_id = i.id AND e.created_at >= $2), 0) AS used
       FROM institutions i WHERE i.id = $1`,
      [institutionId, new Date(month).toISOString()],
    );
    const own = rows[0]?.budget;
    const budget = own != null ? Number(own) : this.opts.defaultBudget;
    const next: BudgetState = {
      budget: budget && budget > 0 ? budget : null,
      usedAtLoad: Number(rows[0]?.used ?? 0),
      addedSince: 0,
      loadedAt: t,
      month,
    };
    this.state.set(institutionId, next);
    return next;
  }

  /** Throws AiBudgetExceeded when the college has no allowance left this month. */
  async check(institutionId: string): Promise<void> {
    const s = await this.load(institutionId);
    if (s.budget !== null && s.usedAtLoad + s.addedSince >= s.budget) throw new AiBudgetExceeded();
  }

  /** Counts a finished call against the cached total until the next reload. */
  add(institutionId: string, tokens: number): void {
    const s = this.state.get(institutionId);
    if (s && s.month === monthStart(this.now()).getTime()) s.addedSince += Math.max(0, tokens);
  }

  async status(institutionId: string): Promise<{ budget: number | null; used: number }> {
    const s = await this.load(institutionId);
    return { budget: s.budget, used: s.usedAtLoad + s.addedSince };
  }
}

/** Parses AI_MONTHLY_TOKEN_BUDGET; unset, invalid or 0 means unlimited. */
export function defaultBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.AI_MONTHLY_TOKEN_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
