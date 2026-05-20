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
import { notify } from "./src/server/lib/notify.js";

dotenv.config();
validateEnv();

dns.setDefaultResultOrder("ipv4first");

// ── Supabase Storage ──────────────────────────────────────────────────────────
const SUPABASE_URL          = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const NOTES_BUCKET          = "learnit-notes";
const SUBMISSIONS_BUCKET    = "learnit-submissions";
const SIGNED_URL_TTL        = 3600;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Storage helpers ───────────────────────────────────────────────────────────

async function uploadToStorage(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, buffer, { contentType: mimetype, upsert: true });

  if (error) {
    console.error(`[Storage] upload FAILED (${bucket}/${objectPath})`, {
      message: error.message,
      name: (error as any).name ?? "StorageError",
      statusCode: (error as any).statusCode,
    });
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  console.log(`[Storage] uploaded → ${bucket}/${objectPath}`);
  return objectPath;
}

async function getSignedUrl(
  bucket: string,
  objectPath: string,
  ttl = SIGNED_URL_TTL
): Promise<string | null> {
  if (!objectPath) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, ttl);
  if (error) {
    console.error(`[Storage] signed URL error (${bucket}/${objectPath}):`, error.message);
    return null;
  }
  return data.signedUrl;
}

async function downloadFromStorage(
  bucket: string,
  objectPath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!objectPath) return null;
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(objectPath);
  if (error || !data) {
    console.error(`[Storage] download error (${bucket}/${objectPath}):`, error?.message);
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  return { buffer: buf, contentType: data.type || "application/octet-stream" };
}

async function deleteFromStorage(bucket: string, objectPath: string): Promise<void> {
  if (!objectPath) return;
  const { error } = await supabaseAdmin.storage.from(bucket).remove([objectPath]);
  if (error) console.error(`[Storage] delete error (${bucket}/${objectPath}):`, error.message);
  else console.log(`[Storage] deleted ${bucket}/${objectPath}`);
}

async function checkStorageConnectivity(): Promise<void> {
  const testKey = `_healthcheck/${Date.now()}.txt`;
  try {
    const { error: upErr } = await supabaseAdmin.storage
      .from(NOTES_BUCKET)
      .upload(testKey, Buffer.from("ping"), { contentType: "text/plain", upsert: true });
    if (upErr) throw upErr;
    await supabaseAdmin.storage.from(NOTES_BUCKET).remove([testKey]);
    console.log("[Storage] connectivity OK — learnit-notes bucket reachable");
  } catch (e: any) {
    console.error("[Storage] CONNECTIVITY FAIL — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", {
      message: e.message,
      name: e.name,
      statusCode: e.statusCode,
    });
  }
}

// ── Auth user helpers ─────────────────────────────────────────────────────────

/**
 * generateTempPassword — uses crypto.randomBytes() (CSPRNG) instead of
 * Math.random() which is not cryptographically secure.
 */
function generateTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits  = "23456789";
  const special = "!@#$%^&*";

  // Generate a 16-byte random buffer for all character selections
  const buf = crypto.randomBytes(20);

  let pwd = "";
  // Guarantee at least one uppercase, digit, special
  pwd += upper[buf[0] % upper.length];
  pwd += digits[buf[1] % digits.length];
  pwd += special[buf[2] % special.length];

  for (let i = 3; i < 16; i++) {
    pwd += charset[buf[i] % charset.length];
  }

  // Shuffle using Fisher-Yates with CSPRNG indices
  const arr = pwd.split("");
  const shuffleBuf = crypto.randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffleBuf[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

async function createAuthUserAndIdentityMapRow(
  client: pkg.PoolClient,
  legacyUserId: number,
  email: string,
  role: string
): Promise<{ authUserId: string; tempPassword: string } | null> {
  const tempPassword = generateTempPassword();

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (authErr) {
    if (authErr.message.includes("already registered") || authErr.message.includes("already been registered")) {
      console.warn(`[Auth] user already exists for ${email} — skipping Auth creation`);
      return null;
    }
    console.error(`[Auth] createUser FAILED for ${email}:`, authErr.message);
    throw new Error(`Supabase Auth createUser failed: ${authErr.message}`);
  }

  const authUserId = authData.user.id;

  await client.query(
    `INSERT INTO user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (legacy_user_id) DO UPDATE
       SET auth_user_id = EXCLUDED.auth_user_id,
           role = EXCLUDED.role,
           force_password_change = TRUE`,
    [legacyUserId, authUserId, role]
  );

  console.log(`[Auth] created Auth user ${authUserId} → legacy ${legacyUserId} (${email}) [force_password_change=true]`);
  return { authUserId, tempPassword };
}

const require = createRequire(import.meta.url);
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const PROJECT_ROOT = process.cwd();
const isProduction = process.env.NODE_ENV === "production";

// NOTE: ssl.rejectUnauthorized=false is intentional for Render's internal
// Postgres connections where the cert chain is self-signed. If DATABASE_URL
// ever points to an external host, set SSL_REJECT_UNAUTHORIZED=true and
// update this option to conditionally read process.env.SSL_REJECT_UNAUTHORIZED.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

setPool(pool);
setAuditPool(pool);

async function query(sql: string, params: any[] = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function queryOne(sql: string, params: any[] = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] ?? null;
}
async function run(sql: string, params: any[] = []) {
  const { rows, rowCount } = await pool.query(sql, params);
  return { lastInsertId: rows[0]?.id ?? null, changes: rowCount ?? 0 };
}

function sanitizeText(t: string) {
  return t
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\uFFFD/g, "");
}

const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Allowed MIME types for each upload surface ────────────────────────────────
const ALLOWED_NOTE_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const ALLOWED_SUBMISSION_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "application/zip",
]);

function makeMimeFilter(allowedSet: Set<string>) {
  return (_req: any, file: any, cb: any) => {
    if (allowedSet.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  };
}

const memStorage       = multer.memoryStorage();
const uploadNote       = multer({
  storage: memStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: makeMimeFilter(ALLOWED_NOTE_MIMES),
});
const uploadSubmission = multer({
  storage: memStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: makeMimeFilter(ALLOWED_SUBMISSION_MIMES),
});

async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string
): Promise<string> {
  const ext = path.extname(originalname).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const data = await pdfParse(buffer);
      return sanitizeText(data.text ?? "");
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ buffer });
      return sanitizeText(result.value ?? "");
    }
    if (ext === ".txt" || mimetype === "text/plain") {
      return sanitizeText(buffer.toString("utf-8"));
    }
    return "";
  } catch (e) {
    console.error("[extractTextFromBuffer] error:", e);
    return "";
  }
}

async function extractText(filePath: string, mimetype: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const buf  = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return sanitizeText(data.text ?? "");
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return sanitizeText(result.value ?? "");
    }
    if (ext === ".txt" || mimetype === "text/plain") {
      return sanitizeText(fs.readFileSync(filePath, "utf-8"));
    }
    return "";
  } catch (e) {
    console.error("[extractText] error:", e);
    return "";
  }
}

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
    i += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 20);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

async function retrieveChunks(
  moduleId: string | number,
  queryText: string,
  topK = 5
): Promise<string[]> {
  const chunks = await query(
    `SELECT nc.chunk_text, nc.embedding
     FROM note_chunks nc
     JOIN notes n ON nc.note_id = n.id
     WHERE n.module_id = $1`,
    [moduleId]
  );
  if (!chunks.length) return [];
  const [queryEmbed] = await nimEmbed([queryText], "query");
  const scored = chunks.map((c: any) => {
    const emb: number[] = JSON.parse(c.embedding ?? "[]");
    return { text: c.chunk_text, score: cosineSim(queryEmbed, emb) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.text);
}

// ── fetchWithTimeout — per-call timeout override supported ────────────────────
async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs = 25000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const NIM_CHAT_MODEL = "meta/llama-3.3-70b-instruct";

async function nimChat(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return "[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.";
  const res = await fetchWithTimeout(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: NIM_CHAT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens:  opts.maxTokens  ?? 1024,
      }),
    },
    60000
  );
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[nimChat] ${res.status}:`, errBody);
    throw new Error(`NVIDIA NIM ${res.status}: ${errBody}`);
  }
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

async function nimEmbed(
  texts: string[],
  inputType: "passage" | "query" = "passage"
): Promise<number[][]> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return texts.map(() => Array.from({ length: 384 }, () => Math.random() - 0.5));
  const res = await fetchWithTimeout(
    "https://integrate.api.nvidia.com/v1/embeddings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:      "nvidia/nv-embedqa-e5-v5",
        input:      texts,
        input_type: inputType,
        truncate:   "END",
      }),
    },
    45000
  );
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[nimEmbed] ${res.status}:`, errBody);
    throw new Error(`NVIDIA Embed ${res.status}: ${errBody}`);
  }
  const data = await res.json() as any;
  return (data.data ?? []).map((d: any) => d.embedding as number[]);
}

// ── Snapshot staleness threshold ──────────────────────────────────────────────
const SNAPSHOT_STALE_MS = 35 * 60 * 1000;

async function startServer() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(attachRequestId);
  app.use(requestLogger);

  app.use("/api", generalApiLimiter);

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Set ALLOWED_ORIGIN in your Render environment to your exact production
  // frontend URL, e.g. https://learn-it.vercel.app
  // Multiple origins can be comma-separated.
  //
  // Vercel preview deployments get dynamic URLs like:
  //   https://learn-893rv6ymw-seeshurajs-projects.vercel.app
  // VERCEL_PREVIEW_RE automatically allows these without manual updates.
  const ALLOWED_ORIGINS: Set<string> = new Set(
    (process.env.ALLOWED_ORIGIN ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );

  const LOCALHOST_RE      = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  // Matches any Vercel preview URL belonging to seeshurajs-projects:
  //   https://<hash>-seeshurajs-projects.vercel.app
  const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-seeshurajs-projects\.vercel\.app$/;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    let allow = "";
    if (!origin) {
      allow = "*";
    } else if (LOCALHOST_RE.test(origin)) {
      allow = origin;
    } else if (ALLOWED_ORIGINS.has(origin)) {
      allow = origin;
    } else if (VERCEL_PREVIEW_RE.test(origin)) {
      allow = origin;
    }

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
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none';"
    );
    next();
  });

  app.use(express.json());

  // ── P3-3: Student Roadmaps ────────────────────────────────────────────────
  app.use("/api/roadmaps", createRoadmapRouter(pool, nimChat));

  // ── P3-4: Notifications ───────────────────────────────────────────────────
  app.use("/api/notifications", createNotificationsRouter(pool));

  // ── P3-5: Auth (password reset / force-change) ────────────────────────────
  app.use("/api/auth", createAuthRouter(pool));

  // ── Grading Insights (aggregated ai_feedback strengths + improvements) ────
  app.use("/api/student", createGradingInsightsRouter(pool));

  // ── Unit Exams (marks ingestion, paper upload, performance analytics) ─────
  app.use("/api/unit-exams", createUnitExamsRouter(pool, supabaseAdmin, nimChat));

  // ── Audit Logs (admin-only paginated read) ────────────────────────────────
  app.use("/api/admin/audit-logs", createAuditLogsRouter(pool));

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "ok", db: "postgres",
        storage: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE),
        env: process.env.NODE_ENV,
        ts: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ status: "error", message: e.message }); }
  });

  // ── P2-9: Readiness probe ─────────────────────────────────────────────────
  app.get("/api/ready", async (_req, res) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {
      db:      { ok: false },
      storage: { ok: false },
    };

    try {
      await pool.query("SELECT 1");
      checks.db.ok = true;
    } catch (e: any) {
      checks.db.error = e.message;
    }

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
      const testKey = `_healthcheck/ready-${Date.now()}.txt`;
      try {
        const { error: upErr } = await supabaseAdmin.storage
          .from(NOTES_BUCKET)
          .upload(testKey, Buffer.from("ready"), { contentType: "text/plain", upsert: true });
        if (upErr) throw upErr;
        await supabaseAdmin.storage.from(NOTES_BUCKET).remove([testKey]);
        checks.storage.ok = true;
      } catch (e: any) {
        checks.storage.error = e.message;
      }
    } else {
      checks.storage.error = "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured";
    }

    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ready" : "unavailable",
      checks,
      ts: new Date().toISOString(),
    });
  });

  // ── Auth login ────────────────────────────────────────────────────────────
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
