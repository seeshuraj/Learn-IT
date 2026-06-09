/**
 * health.ts
 *
 * GET /api/health
 *
 * Used by:
 *   - Render healthCheckPath  — marks an instance ready before routing traffic
 *   - External uptime monitors (UptimeRobot, BetterUptime, etc.)
 *   - Load-balancer liveness probes when numInstances > 1
 *
 * Response shape:
 *   { status: "ok", uptime: number, version: string, timestamp: string }
 *
 * The generalApiLimiter in rateLimit.ts already skips this path so
 * health pings never consume rate-limit quota.
 */

import { Router, Request, Response } from 'express';

const router = Router();

const startedAt = Date.now();
const version   = process.env.npm_package_version ?? 'unknown';

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status:    'ok',
    uptime:    Math.floor((Date.now() - startedAt) / 1000), // seconds
    version,
    timestamp: new Date().toISOString(),
  });
});

export default router;
