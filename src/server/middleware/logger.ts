/**
 * logger.ts — structured JSON request logger (P1-4 / P1-7)
 *
 * Logs every request as a single JSON line at response finish.
 * Fields: requestId, method, path, statusCode, durationMs, userId.
 * Never logs secrets, tokens, passwords, or PII body content.
 */

import { Request, Response, NextFunction } from 'express';
import { RequestWithId } from './requestId.js';
import { AuthenticatedRequest } from './auth.js';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on('finish', () => {
    const entry: Record<string, unknown> = {
      requestId:  (req as RequestWithId).id ?? 'unknown',
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    };
    const auth = (req as AuthenticatedRequest).auth;
    if (auth) entry.userId = auth.legacyUserId;
    // Only emit as structured JSON in production; pretty-print in dev.
    if (process.env.NODE_ENV === 'production') {
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      const { method, path, statusCode, durationMs } = entry as any;
      console.log(`[${statusCode}] ${method} ${path}  ${durationMs}ms`);
    }
  });
  next();
}
