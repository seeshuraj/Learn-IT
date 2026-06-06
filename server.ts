/**
 * server.ts — slim orchestrator
 *
 * All domain logic lives in src/server/routes/* and src/server/lib/*.
 * This file is responsible only for:
 *   1. Bootstrap (env, pool, middleware)
 *   2. Mounting routers
 *   3. Health / readiness probes
 *   4. SPA static serving
 *   5. Startup side-effects (storage check, cron)
 */
import express, { Request, Response, NextFunction } from "express";
import pkg from "pg";
const { Pool } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import dns from "dns";

import { validateEnv }         from "./src/server/config/env.js";
import { setPool }             from "./src/server/middleware/auth.js";
import { setAuditPool }        from "./src/server/middleware/audit.js";
import { attachRequestId }     from "./src/server/middleware/requestId.js";
import { requestLogger }       from "./src/server/middleware/logger.js";
import { generalApiLimiter, loginLimiter } from "./src/server/middleware/rateLimit.js";
import { requireAuth }         from "./src/server/middleware/auth.js";
import { AuthenticatedRequest } from "./src/server/middleware/auth.js";
import { writeAudit }          from "./src/server/middleware/audit.js";
import { startCronJobs }       from "./src/server/jobs/cron.js";
import { checkStorageConnectivity, supabaseAdmin, NOTES_BUCKET } from "./src/server/lib/storage.js";
import { nimChat }             from "./src/server/lib/ai.js";

// ── Domain routers ────────────────────────────────────────────────────────────
import { createRoadmapRouter }        from "./src/server/routes/roadmaps.js";
import { createNotificationsRouter }  from "./src/server/routes/notifications.js";
import { createAuthRouter }           from "./src/server/routes/auth.js";
import { createGradingInsightsRouter } from "./src/server/routes/gradingInsights.js";
import { createUnitExamsRouter }      from "./src/server/routes/unitExams.js";
import { createAuditLogsRouter }      from "./src/server/routes/auditLogs.js";
import { createCoursesRouter }        from "./src/server/routes/courses.js";
import { createNotesRouter }          from "./src/server/routes/notes.js";
import { createAssignmentsRouter }    from "./src/server/routes/assignments.js";
import { createSubmissionsRouter }    from "./src/server/routes/submissions.js";
import { createInstructorRouter }     from "./src/server/routes/instructor.js";
import { createStudentRouter }        from "./src/server/routes/student.js";
import { createAdminRouter }          from "./src/server/routes/admin.js";
import { createAiRouter }             from "./src/server/routes/aiRoutes.js";

dotenv.config();
validateEnv();
dns.setDefaultResultOrder("ipv4first");

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const PROJECT_ROOT = process.cwd();
const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:  { rejectUnauthorized: false },
  max:  10,
  idleTimeoutMillis:      30000,
  connectionTimeoutMillis: 10000,
});

setPool(pool);
setAuditPool(pool);

async function queryOne(sql: string, params: any[] = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] ?? null;
}

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(attachRequestId);
  app.use(requestLogger);
  app.use("/api", generalApiLimiter);

  // ── CORS ──────────────────────────────────────────────────────────────────
  const ALLOWED_ORIGINS: Set<string> = new Set(
    (process.env.ALLOWED_ORIGIN ?? "")
      .split(",").map(s => s.trim()).filter(Boolean)
  );
  const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-seeshurajs-projects\.vercel\.app$/;
  const LOCALHOST_RE      = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    let allow = "";
    if (!origin)                           allow = "*";
    else if (LOCALHOST_RE.test(origin))    allow = origin;
    else if (ALLOWED_ORIGINS.has(origin))  allow = origin;
    else if (VERCEL_PREVIEW_RE.test(origin)) allow = origin;
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin",      allow);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers",     "Content-Type,Authorization,X-Requested-With");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // ── Security headers ──────────────────────────────────────────────────────
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options",  "nosniff");
    res.setHeader("X-Frame-Options",         "DENY");
    res.setHeader("X-XSS-Protection",        "1; mode=block");
    res.setHeader("Referrer-Policy",         "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none';");
    next();
  });

  app.use(express.json());

  // ── Mount routers ─────────────────────────────────────────────────────────
  app.use("/api/roadmaps",          createRoadmapRouter(pool, nimChat));
  app.use("/api/notifications",     createNotificationsRouter(pool));
  app.use("/api/auth",              createAuthRouter(pool));
  app.use("/api/student",           createGradingInsightsRouter(pool));
  app.use("/api/unit-exams",        createUnitExamsRouter(pool, supabaseAdmin, nimChat));
  app.use("/api/admin/audit-logs",  createAuditLogsRouter(pool));
  app.use("/api/courses",           createCoursesRouter(pool));
  app.use("/api",                   createNotesRouter(pool));
  app.use("/api",                   createAssignmentsRouter(pool));
  app.use("/api/submissions",       createSubmissionsRouter(pool));
  app.use("/api/instructor",        createInstructorRouter(pool));
  app.use("/api/student",           createStudentRouter(pool));
  app.use("/api/admin",             createAdminRouter(pool));
  app.use("/api/ai",                createAiRouter(pool));

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post("/api/login", loginLimiter, requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = await queryOne(
        "SELECT id,name,email,role,active,year,major,gpa FROM users WHERE id=$1 AND active=1",
        [authReq.auth.legacyUserId]
      );
      if (user) {
        writeAudit({
          action: "login.success", resourceType: "user", resourceId: String(user.id),
          actorUserId: authReq.auth.legacyUserId, actorEmail: authReq.auth.email,
          actorRole: authReq.auth.role, req,
        });
        res.json(user);
      } else {
        writeAudit({
          action: "login.denied", actorEmail: authReq.auth.email,
          actorUserId: authReq.auth.legacyUserId,
          metadata: { reason: "inactive_or_not_found" }, req,
        });
        res.status(403).json({ error: "Account inactive or not found" });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "ok", db: "postgres",
        storage: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        env: process.env.NODE_ENV, ts: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ status: "error", message: e.message }); }
  });

  // ── Readiness probe ───────────────────────────────────────────────────────
  app.get("/api/ready", async (_req, res) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {
      db:      { ok: false },
      storage: { ok: false },
    };
    try { await pool.query("SELECT 1"); checks.db.ok = true; }
    catch (e: any) { checks.db.error = e.message; }
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const testKey = `_healthcheck/ready-${Date.now()}.txt`;
      try {
        const { error: upErr } = await supabaseAdmin.storage
          .from(NOTES_BUCKET).upload(testKey, Buffer.from("ready"), { contentType: "text/plain", upsert: true });
        if (upErr) throw upErr;
        await supabaseAdmin.storage.from(NOTES_BUCKET).remove([testKey]);
        checks.storage.ok = true;
      } catch (e: any) { checks.storage.error = e.message; }
    } else {
      checks.storage.error = "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured";
    }
    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "unavailable", checks, ts: new Date().toISOString(),
    });
  });

  // ── SPA ───────────────────────────────────────────────────────────────────
  if (isProduction) {
    const distPath = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const PORT = Number(process.env.PORT ?? 10000);
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));

  checkStorageConnectivity().catch(console.error);
  startCronJobs(pool, nimChat).catch(console.error);
}

startServer().catch(e => {
  console.error("[server] fatal startup error:", e);
  process.exit(1);
});
