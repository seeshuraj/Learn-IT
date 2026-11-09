/**
 * httpErrors.ts — safe error responses.
 *
 * Clients get a generic message plus the request ID; the real error (SQL,
 * constraint names, provider responses) goes only to the server log, keyed
 * by the same request ID so support can correlate a user report with logs.
 */

import { Response } from 'express';
import { log, errorFields } from './log.js';

export function sendServerError(res: Response, err: unknown, status = 500): void {
  // Authorization failures thrown by lib/access.ts are expected outcomes.
  if (err instanceof Error && err.name === 'AccessDenied') {
    const denied = err as Error & { status?: number };
    if (!res.headersSent) res.status(denied.status ?? 403).json({ error: err.message });
    return;
  }
  // A college's monthly AI allowance is used up: tell the user plainly.
  if (err instanceof Error && err.name === 'AiBudgetExceeded') {
    if (!res.headersSent) res.status(429).json({ error: err.message, code: 'ai_budget_exceeded' });
    return;
  }
  const requestId = (res.getHeader('X-Request-Id') as string | undefined) ?? undefined;
  const req = res.req;
  log.error('request failed', {
    requestId,
    method: req?.method,
    path: req?.path,
    status,
    ...errorFields(err),
  });
  if (res.headersSent) return;
  res.status(status).json({ error: 'Internal server error', requestId });
}
