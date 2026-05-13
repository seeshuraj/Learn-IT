/**
 * validate.ts — Zod request validation middleware (P1-6)
 *
 * Usage:
 *   import { validateBody, validateParams } from './validate.js';
 *   app.post('/api/...', requireAuth, validateBody(mySchema), handler);
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

function formatError(err: ZodError) {
  return {
    error:  'Validation error',
    issues: err.errors.map(e => ({
      path:    e.path.join('.'),
      message: e.message,
    })),
  };
}

/** Validate + coerce req.body against schema. Returns 400 on failure. */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(formatError(result.error));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Validate + coerce req.params against schema. Returns 400 on failure. */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json(formatError(result.error));
      return;
    }
    req.params = result.data as Record<string, string>;
    next();
  };
}

/** Validate + coerce req.query against schema. Returns 400 on failure. */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json(formatError(result.error));
      return;
    }
    req.query = result.data as Record<string, string>;
    next();
  };
}
