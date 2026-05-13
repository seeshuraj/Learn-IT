/**
 * validate.ts — Zod request validation middleware (P1-4 / P1-6)
 *
 * Usage:
 *   import { validate } from './validate';
 *   import { z } from 'zod';
 *
 *   const schema = z.object({ body: z.object({ title: z.string().min(1) }) });
 *   app.post('/api/...', requireAuth, validate(schema), handler);
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type ValidationTarget = {
  body?:   ZodSchema;
  query?:  ZodSchema;
  params?: ZodSchema;
};

export function validate(schemas: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body);
      if (schemas.query)  req.query  = schemas.query.parse(req.query) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error:  'Validation error',
          issues: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
    }
  };
}
