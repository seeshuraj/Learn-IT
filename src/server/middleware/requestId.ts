/**
 * requestId.ts — attaches a unique request ID to every request (P1-4 / P1-7)
 *
 * Enables correlating logs across middleware, route handlers, and services
 * for a single request. The ID is also returned in the response header
 * so that frontend error reports can be matched to backend log entries.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  id: string;
}

export function attachRequestId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  (req as RequestWithId).id = randomUUID();
  res.setHeader('X-Request-Id', (req as RequestWithId).id);
  next();
}
