/**
 * rateLimit.ts — rate limiters using express-rate-limit.
 *
 * Colleges put hundreds or thousands of students behind one public IP
 * (campus Wi-Fi, hostel NAT), so per-IP quotas would lock a whole campus out
 * after a handful of requests. Every limiter on an authenticated route is
 * therefore keyed by the signed-in user (institution + user id). Only the
 * pre-auth backstop is keyed by IP, with a ceiling sized for a campus.
 *
 *  - ipBackstopLimiter : per IP,   20 000 / 15 min  pre-auth DoS backstop for /api/*
 *  - userApiLimiter    : per user,    600 / 15 min  every authenticated request (via requireAuth)
 *  - loginLimiter      : per user,     30 / 15 min  /api/login profile fetch (password
 *                                                    brute force is limited by Supabase Auth)
 *  - aiLimiter         : per user,     40 / 60 min  AI chat and summaries
 *  - aiGradeLimiter    : per user,     60 / 60 min  AI grading (instructors grade in batches)
 *  - uploadLimiter     : per user,    100 / 24 h    notes, submissions, marks files
 *  - reportLimiter     : per user,     10 / 60 min  expensive report generation
 *
 * Every limit can be tuned per deployment with RATE_<NAME>_MAX
 * (e.g. RATE_AI_MAX=80) without a code change.
 *
 * Counters live in process memory. With several instances each instance
 * counts separately, so the effective limit is roughly limit × instances.
 * These limits are for fairness and cost control, not security, so that is
 * acceptable; a shared Redis store is only needed if exact limits matter.
 */

import rateLimit, { Options, RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response } from "express";
import { limitFromEnv, userKey } from "../lib/rateLimitKeys.js";

const MINUTE = 60 * 1000;

/** Shared JSON error handler so no limiter ever returns HTML to the client. */
function onLimitReached(label: string, windowMs: number): Pick<Options, "handler"> {
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

function perUser(name: string, label: string, windowMs: number, fallbackMax: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max: limitFromEnv(name, fallbackMax),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKey,
    ...onLimitReached(label, windowMs),
  });
}

/**
 * Pre-auth backstop for all /api/* routes, keyed by IP. The ceiling is high
 * because one IP can be an entire campus; real per-person limits apply after
 * sign-in (userApiLimiter). Volumetric attacks belong at the edge (CDN/WAF).
 */
export const ipBackstopLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * MINUTE,
  max: limitFromEnv("IP", 20_000),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path === "/health" || req.path === "/ready",
  ...onLimitReached("network", 15 * MINUTE),
});

/** Every authenticated request; applied at the end of requireAuth. */
export const userApiLimiter = perUser("USER", "general API", 15 * MINUTE, 600);

export const loginLimiter = perUser("LOGIN", "sign-in", 15 * MINUTE, 30);
export const aiLimiter = perUser("AI", "AI", 60 * MINUTE, 40);
export const aiGradeLimiter = perUser("AI_GRADE", "AI grading", 60 * MINUTE, 60);
export const uploadLimiter = perUser("UPLOAD", "file upload", 24 * 60 * MINUTE, 100);
export const reportLimiter = perUser("REPORT", "report generation", 60 * MINUTE, 10);
