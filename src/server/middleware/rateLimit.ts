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
 * express-rate-limit v7 ships with an in-memory store by default which is
 * per-process. This is fine for a single-instance deployment (Render free
 * tier). If you scale to multiple instances, swap the store for
 * rate-limit-redis using ioredis + the REDIS_URL env var.
 */

import rateLimit, { Options, RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response } from "express";

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

/**
 * Login — 10 attempts per IP per 15 minutes.
 * Protects /api/login against credential-stuffing and brute-force.
 */
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 min
  max:              10,
  standardHeaders:  true,           // Return RateLimit-* headers (RFC 6585)
  legacyHeaders:    false,
  skipSuccessfulRequests: false,    // Count ALL attempts, not just failures
  ...onLimitReached("login", 15 * 60 * 1000),
});

/**
 * AI endpoints — 30 requests per IP per 60 minutes.
 * Covers /api/ai/chat, /api/ai/analytics-summary.
 * Prevents runaway LLM token spend from a single user/IP.
 */
export const aiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  ...onLimitReached("AI", 60 * 60 * 1000),
});

/**
 * AI grading — 20 requests per IP per 60 minutes.
 * /api/ai/grade and /api/ai/grade-pdf are more expensive than chat.
 */
export const aiGradeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  ...onLimitReached("AI grading", 60 * 60 * 1000),
});

/**
 * File upload — 20 uploads per IP per 24 hours.
 * Covers /api/modules/:id/notes and /api/submissions/upload.
 * Prevents storage exhaustion via repeated large file uploads.
 */
export const uploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        24 * 60 * 60 * 1000, // 24 hours
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  ...onLimitReached("file upload", 24 * 60 * 60 * 1000),
});

/**
 * Report / analytics — 5 requests per IP per 60 minutes.
 * Covers /api/ai/analytics-summary — expensive DB aggregation + LLM call.
 */
export const reportLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  ...onLimitReached("report generation", 60 * 60 * 1000),
});

/**
 * General API catch-all — 200 requests per IP per 15 minutes.
 * Applied globally to all /api/* routes as a baseline DoS guard.
 * Legitimate users will never hit this; scrapers and bots will.
 */
export const generalApiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 min
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req: Request) => {
    // Skip health-check pings from Render/UptimeRobot so they don't
    // consume the quota and trigger false 429s.
    return req.path === "/api/health" || req.path === "/api/ready";
  },
  ...onLimitReached("general API", 15 * 60 * 1000),
});
