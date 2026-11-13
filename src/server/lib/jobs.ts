/**
 * Background jobs on Postgres (no extra infrastructure).
 *
 * Slow work (note text extraction and embedding, AI grading drafts, study
 * roadmaps) is queued in the `jobs` table and run by workers, so API requests
 * return in milliseconds and a burst of uploads queues instead of exhausting
 * the API process.
 *
 * - Claiming uses FOR UPDATE SKIP LOCKED: any number of workers (the API
 *   process itself, or separate Render background workers with
 *   PROCESS_ROLE=worker) share the queue without double-running a job.
 * - At-least-once: a job whose worker died is reclaimed after `staleMs`.
 *   Handlers must be idempotent (each one replaces its own output).
 * - Failures retry with exponential backoff up to max_attempts; a handler can
 *   throw PermanentJobError to fail at once (bad input, access revoked).
 * - dedupe_key prevents queuing the same work twice while one is pending.
 * - Payloads hold ids, never document text or credentials.
 */
import { log, errorFields } from './log.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job<P = any> {
  id: number;
  kind: string;
  payload: P;
  institution_id: string | null;
  created_by: number | null;
  attempts: number;
  max_attempts: number;
}

export interface JobView { id: number; kind: string; status: JobStatus; result: unknown; error: string | null; attempts: number }

/**
 * Throw from a handler to fail the job without retrying. Its message is shown
 * to the user who queued the job, so it must be written for them; any other
 * error is logged and the user sees a generic message.
 */
export class PermanentJobError extends Error {
  constructor(message: string) { super(message); this.name = 'PermanentJobError'; }
}

export const GENERIC_JOB_ERROR = 'This could not be completed. Please try again.';

export type JobHandler = (job: Job) => Promise<unknown>;

export interface EnqueueOptions {
  institutionId?: string | null;
  createdBy?: number | null;
  /** While a job with this key is queued or running, enqueue returns it instead of a new one. */
  dedupeKey?: string;
  maxAttempts?: number;
  delayMs?: number;
}

/** Backoff before attempt n+1 (n = attempts so far): 10 s, 40 s, 2.5 min, 10 min, capped at 30 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 10_000 * 4 ** Math.max(0, attempts - 1));
}

/** Error text stored on a job: one line, bounded, no stack. */
function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 500);
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private draining: Promise<void> | null = null;
  private lastReclaim = 0;

  constructor(
    private readonly db: Queryable,
    private readonly opts: {
      workerId?: string;
      concurrency?: number;
      pollMs?: number;
      staleMs?: number;
      now?: () => number;
    } = {},
  ) {}

  register(kind: string, handler: JobHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  async enqueue(kind: string, payload: Record<string, unknown>, o: EnqueueOptions = {}): Promise<{ id: number; deduped: boolean }> {
    const params = [
      kind, JSON.stringify(payload), o.institutionId ?? null, o.createdBy ?? null,
      o.dedupeKey ?? null, Math.max(1, o.maxAttempts ?? 5), Math.max(0, o.delayMs ?? 0),
    ];
    const { rows } = await this.db.query(
      `INSERT INTO jobs (kind, payload, institution_id, created_by, dedupe_key, max_attempts, run_after)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, now() + ($7::int * interval '1 millisecond'))
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING
       RETURNING id`,
      params,
    );
    if (rows[0]) {
      this.kick();
      return { id: Number(rows[0].id), deduped: false };
    }
    const existing = await this.db.query(
      `SELECT id FROM jobs WHERE dedupe_key = $1 AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`,
      [o.dedupeKey],
    );
    if (!existing.rows[0]) throw new Error('job dedupe conflict could not be resolved');
    return { id: Number(existing.rows[0].id), deduped: true };
  }

  /** Status for the API; scoped to a college so one cannot read another's jobs. */
  async get(id: number, institutionId: string): Promise<JobView | null> {
    const { rows } = await this.db.query(
      `SELECT id, kind, status, result, last_error, attempts, created_by FROM jobs WHERE id = $1 AND institution_id = $2`,
      [id, institutionId],
    );
    const r = rows[0];
    if (!r) return null;
    const failed = r.status === 'failed';
    return {
      id: Number(r.id), kind: r.kind, status: r.status,
      result: failed ? null : r.result ?? null,
      // Only messages written for users (PermanentJobError) are shown; internal errors stay in logs.
      error: failed ? (r.result?.userError ?? GENERIC_JOB_ERROR) : null,
      attempts: Number(r.attempts),
    };
  }

  /** Owner of a job (to check that a caller may read it). */
  async ownerOf(id: number, institutionId: string): Promise<number | null> {
    const { rows } = await this.db.query(`SELECT created_by FROM jobs WHERE id = $1 AND institution_id = $2`, [id, institutionId]);
    return rows[0] ? (rows[0].created_by == null ? null : Number(rows[0].created_by)) : null;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
    log.info('job worker started', { workerId: this.workerId, concurrency: this.concurrency, kinds: [...this.handlers.keys()] });
  }

  /** Stop claiming new jobs and wait (up to timeoutMs) for running ones. */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const until = Date.now() + timeoutMs;
    while (this.running > 0 && Date.now() < until) await new Promise(r => setTimeout(r, 100));
  }

  /** Claim and run whatever is due now; returns how many jobs ran. Used by the loop and by tests. */
  async drain(): Promise<number> {
    if (this.draining) { await this.draining; return 0; }
    let ran = 0;
    this.draining = (async () => {
      await this.reclaimStale();
      while (this.running < this.concurrency) {
        const free = this.concurrency - this.running;
        const jobs = await this.claim(free);
        if (!jobs.length) break;
        ran += jobs.length;
        await Promise.all(jobs.map(j => this.execute(j)));
        if (this.stopped) break;
      }
    })();
    try { await this.draining; } finally { this.draining = null; }
    return ran;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private get concurrency() { return Math.max(1, this.opts.concurrency ?? 2); }
  private get workerId() { return this.opts.workerId ?? `pid-${process.pid}`; }

  private kick() {
    if (!this.stopped && this.running < this.concurrency) this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try { await this.drain(); }
      catch (err) { log.error('job worker loop failed', errorFields(err)); }
      this.schedule(this.opts.pollMs ?? 2_000);
    }, ms);
    this.timer.unref?.();
  }

  private async claim(n: number): Promise<Job[]> {
    const kinds = [...this.handlers.keys()];
    if (!kinds.length) return [];
    const { rows } = await this.db.query(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $1, updated_at = now()
       WHERE id IN (
         SELECT id FROM jobs
         WHERE status = 'queued' AND run_after <= now() AND kind = ANY($2::text[])
         ORDER BY run_after, id
         FOR UPDATE SKIP LOCKED
         LIMIT $3)
       RETURNING id, kind, payload, institution_id, created_by, attempts, max_attempts`,
      [this.workerId, kinds, n],
    );
    return rows.map(r => ({ ...r, id: Number(r.id), attempts: Number(r.attempts), max_attempts: Number(r.max_attempts) }));
  }

  private async execute(job: Job): Promise<void> {
    this.running++;
    const started = Date.now();
    try {
      const handler = this.handlers.get(job.kind);
      if (!handler) throw new PermanentJobError(`no handler for ${job.kind}`);
      const result = await handler(job);
      await this.db.query(
        `UPDATE jobs SET status = 'done', result = $2::jsonb, last_error = NULL, locked_at = NULL, locked_by = NULL,
                         finished_at = now(), updated_at = now()
         WHERE id = $1`,
        [job.id, JSON.stringify(result ?? null)],
      );
      log.info('job done', { id: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started });
    } catch (err) {
      const permanent = err instanceof PermanentJobError || job.attempts >= job.max_attempts;
      await this.db.query(
        permanent
          ? `UPDATE jobs SET status = 'failed', last_error = $2, result = $3::jsonb, locked_at = NULL, locked_by = NULL, finished_at = now(), updated_at = now() WHERE id = $1`
          : `UPDATE jobs SET status = 'queued', last_error = $2, locked_at = NULL, locked_by = NULL,
                             run_after = now() + ($3::int * interval '1 millisecond'), updated_at = now() WHERE id = $1`,
        permanent
          ? [job.id, errorText(err), JSON.stringify(err instanceof PermanentJobError ? { userError: err.message.slice(0, 300) } : null)]
          : [job.id, errorText(err), retryDelayMs(job.attempts)],
      ).catch(e => log.error('job status update failed', { id: job.id, ...errorFields(e) }));
      (permanent ? log.error : log.warn)(permanent ? 'job failed' : 'job will retry', {
        id: job.id, kind: job.kind, attempt: job.attempts, maxAttempts: job.max_attempts, reason: errorText(err),
      });
      if (permanent) await this.onFailed(job, err);
    } finally {
      this.running--;
    }
  }

  /** Runs a kind's failure hook (e.g. mark the note as failed) when a job gives up. */
  private failureHooks = new Map<string, (job: Job, err: unknown) => Promise<void>>();
  onFailure(kind: string, hook: (job: Job, err: unknown) => Promise<void>): this {
    this.failureHooks.set(kind, hook);
    return this;
  }
  private async onFailed(job: Job, err: unknown) {
    try { await this.failureHooks.get(job.kind)?.(job, err); }
    catch (e) { log.error('job failure hook failed', { id: job.id, kind: job.kind, ...errorFields(e) }); }
  }

  /** Requeue jobs whose worker stopped heartbeating (crash, deploy) at most once a minute. */
  private async reclaimStale(): Promise<void> {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.lastReclaim < 60_000) return;
    this.lastReclaim = now;
    const { rowCount } = await this.db.query(
      `UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
                       last_error = COALESCE(last_error, 'worker stopped while running'),
                       locked_at = NULL, locked_by = NULL, updated_at = now(),
                       finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE finished_at END
       WHERE status = 'running' AND locked_at < now() - ($1::int * interval '1 millisecond')`,
      [this.opts.staleMs ?? 15 * 60_000],
    );
    if (rowCount) log.warn('requeued stale jobs', { count: rowCount });
  }
}
