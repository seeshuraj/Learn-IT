import express, { Request, Response, NextFunction } from "express";
import pkg from "pg";
const { Pool } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "module";
import fs from "fs";
import dns from "dns";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  requireAuth,
  requireRole,
  requireSelfOrAdmin,
  setPool,
  AuthenticatedRequest,
} from "./src/server/middleware/auth.js";
import { attachRequestId } from "./src/server/middleware/requestId.js";
import { requestLogger } from "./src/server/middleware/logger.js";
import { validateBody, validateParams } from "./src/server/middleware/validate.js";
import {
  loginLimiter,
  aiLimiter,
  aiGradeLimiter,
  uploadLimiter,
  reportLimiter,
  generalApiLimiter,
} from "./src/server/middleware/rateLimit.js";
import {
  assignmentCreateSchema,
  assignmentUpdateSchema,
  instructorAssignmentCreateSchema,
  submissionCreateSchema,
  gradeSchema,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  courseCreateSchema,
  enrollmentCreateSchema,
  bulkEnrollSchema,
  settingsSchema,
  moduleCreateSchema,
  gradePdfSchema,
  routeParamId,
} from "./src/server/validation/schemas.js";
import { validateEnv } from "./src/server/config/env.js";
import { writeAudit, setAuditPool } from "./src/server/middleware/audit.js";
import { startCronJobs } from "./src/server/jobs/cron.js";
import { createRoadmapRouter } from "./src/server/routes/roadmaps.js";
import { createNotificationsRouter } from "./src/server/routes/notifications.js";
import { createAuthRouter } from "./src/server/routes/auth.js";
import { createGradingInsightsRouter } from "./src/server/routes/gradingInsights.js";
import { createUnitExamsRouter } from "./src/server/routes/unitExams.js";
import { createAuditLogsRouter } from "./src/server/routes/auditLogs.js";
import { createGradingRouter } from "./src/server/routes/grading.js";
import { notify } from "./src/server/lib/notify.js";

dotenv.config();
validateEnv();

dns.setDefaultResultOrder("ipv4first");
