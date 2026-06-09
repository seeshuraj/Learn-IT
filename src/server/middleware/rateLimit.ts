/**
 * rateLimit.ts — Per-route rate limiters using express-rate-limit.
 *
 * Strategy:
 *  - loginLimiter       : IP-based  — 10 attempts per 15 min  (brute-force guard on /api/login)
 *  - aiLimiter          : IP-based  — 30 requests per 60 min  (AI chat + grading endpoints)
 *  - uploadLimiter      : IP-based  — 20 uploads per 24 h     (note + submission file uploads)
 *  - reportLimiter      : IP-based  — 5 requests per 60 min   (analytics-summary / grade-pdf)
 *  - generalApiLimiter  : IP-based  — 200 requests per 15 min (catch-all for all other /api/* routes)
 *
 * All limiters return JSON { error, retryAfter } — never HTML — so the
 * frontend can parse and display a user-friendly message.
 *
 * Redis-readiness
 * ───────────────
 * With numInstances > 1 each Render worker holds its own in-memory counter.
 * A client can effectively double its quota by hitting both instances.
 * To fix this, set REDIS_URL and install:
 *
 *   npm install ioredis rate-limit-redis
 *
 * Then replace the TODO block in makeStore() with:
 *
 *   import RedisStore from 'rate-limit-redis';
 *   import Redis from 'ioredis';
 *   const redisClient = new Redis(process.env.REDIS_URL);
 *   return new RedisStore({ sendCommand: (...args) => redisClient.call(...args) });
 *
 * All limiter exports are unchanged — no callsite edits needed.
 */

import rateLimit, { Options, RateLimitRequestHandler, Store } from "express-rate-limit";
import { Request, Response } from "express";

// ── Store factory ──────────────────────────────────────────────────────────────────────────────
/**
 * Returns a shared rate-limit store.
 *
 * - REDIS_URL set   → TODO: wire RedisStore (Sprint 6)
 * - REDIS_URL unset → undefined  (express-rate-limit uses in-memory default)
 *
 * Accepting `Store | undefined` keeps the Options type happy because
 * express-rate-limit treats `store: undefined` identically to omitting it.
 */
function makeStore(): Store | undefined {
  if (process.env.REDIS_URL) {
    // Sprint 6: replace this log with the RedisStore wiring described above.
    console.warn(
      '[rateLimit] REDIS_URL is set but rate-limit-redis is not yet wired. ' +
      'Run: npm install ioredis rate-limit-redis  and update makeStore().'
    );
  }
  return undefined; // falls back to safe in-memory store
}

const store = makeStore();

// ── Shared error handler ──────────────────────────────────────────────────────────────────────────
/** Shared JSON error handler so no limiter ever returns HTML to the client. */
function onLimitReached(
  label: string,
  windowMs: number
): Pick<Options, "handler"> {
  return {
    handler: (_req: Request, res: Response) => {
      const retryAfterSec = Math.ceil(windowMs / 1000);
      res.status(429).json({
        error: `Too many requests (${label}). Please try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
        retryAfter: retryAfterSec,
      });
    },
  };
}

// ── Limiters ─────────────────────────────────────────────────────────────────────────────

/**
 * Login — 10 attempts per IP per 15 minutes.
 * Protects /api/login against credential-stuffing and brute-force.
 */
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
  store,
  ...onLimitReached("login", 15 * 60 * 1000),
});

/**
 * AI endpoints — 30 requests per IP per 60 minutes.
 * Covers /api/ai/chat, /api/ai/analytics-summary.
 */
export const aiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  store,
  ...onLimitReached("AI", 60 * 60 * 1000),
});

/**
 * AI grading — 20 requests per IP per 60 minutes.
 * /api/ai/grade and /api/ai/grade-pdf are more expensive than chat.
 */
export const aiGradeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  store,
  ...onLimitReached("AI grading", 60 * 60 * 1000),
});

/**
 * File upload — 20 uploads per IP per 24 hours.
 * Covers /api/modules/:id/notes and /api/submissions/upload.
 */
export const uploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        24 * 60 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  store,
  ...onLimitReached("file upload", 24 * 60 * 60 * 1000),
});

/**
 * Report / analytics — 5 requests per IP per 60 minutes.
 * Covers /api/ai/analytics-summary — expensive DB aggregation + LLM call.
 */
export const reportLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  store,
  ...onLimitReached("report generation", 60 * 60 * 1000),
});

/**
 * General API catch-all — 200 requests per IP per 15 minutes.
 * Applied globally to all /api/* routes as a baseline DoS guard.
 */
export const generalApiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  store,
  skip: (req: Request) => {
    return req.path === "/api/health" || req.path === "/api/ready";
  },
  ...onLimitReached("general API", 15 * 60 * 1000),
});
