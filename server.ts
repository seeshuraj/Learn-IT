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

function generateTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits  = "23456789";
  const special = "!@#$%^&*";

  const buf = crypto.randomBytes(20);

  let pwd = "";
  pwd += upper[buf[0] % upper.length];
  pwd += digits[buf[1] % digits.length];
  pwd += special[buf[2] % special.length];

  for (let i = 3; i < 16; i++) {
    pwd += charset[buf[i] % charset.length];
  }

  const arr = crypto.randomBytes(pwd.length);
  const chars = pwd.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
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

const SNAPSHOT_STALE_MS = 35 * 60 * 1000;

async function startServer() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(attachRequestId);
  app.use(requestLogger);

  app.use("/api", generalApiLimiter);

  // ── CORS ──────────────────────────────────────────────────────────────────
  // ALLOWED_ORIGIN (Render env var) = your canonical production URL,
  // e.g. https://learn-it.vercel.app
  // Multiple origins: comma-separated.
  //
  // VERCEL_PREVIEW_RE additionally allows every preview deployment URL
  // generated by Vercel for the seeshurajs-projects account, so you don't
  // need to update ALLOWED_ORIGIN on every `git push`.
  const ALLOWED_ORIGINS: Set<string> = new Set(
    (process.env.ALLOWED_ORIGIN ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );

  // Matches: https://<hash>-seeshurajs-projects.vercel.app
  //      and https://learn-it.vercel.app (the production alias)
  const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-seeshurajs-projects\.vercel\.app$/;

  // Always allow localhost in development
  const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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

  // ── Routers ───────────────────────────────────────────────────────────────
  app.use("/api/roadmaps",           createRoadmapRouter(pool, nimChat));
  app.use("/api/notifications",      createNotificationsRouter(pool));
  app.use("/api/auth",               createAuthRouter(pool));
  app.use("/api/student",            createGradingInsightsRouter(pool));
  app.use("/api/unit-exams",         createUnitExamsRouter(pool, supabaseAdmin, nimChat));
  app.use("/api/admin/audit-logs",   createAuditLogsRouter(pool));

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

  // ── Readiness probe ───────────────────────────────────────────────────────
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

  // ── File proxy ────────────────────────────────────────────────────────────
  app.get("/api/notes/:id/proxy", requireAuth, async (req, res) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const note = await queryOne(
        "SELECT id, storage_path, file_type, original_name, uploaded_by FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (auth.role === "student" && note.uploaded_by !== auth.legacyUserId) {
        return res.status(403).json({ error: "Access denied: not your note" });
      }
      if (!note.storage_path) return res.status(404).json({ error: "File not stored — upload may have failed" });
      const result = await downloadFromStorage(NOTES_BUCKET, note.storage_path);
      if (!result) return res.status(404).json({ error: "File not found in storage" });
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(note.original_name ?? "file")}"`);
      res.send(result.buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Signed URL ────────────────────────────────────────────────────────────
  app.get("/api/notes/:id/signed-url", requireAuth, async (req, res) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const note = await queryOne(
        "SELECT id, storage_path, uploaded_by FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (auth.role === "student" && note.uploaded_by !== auth.legacyUserId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const url = await getSignedUrl(NOTES_BUCKET, note.storage_path);
      if (!url) return res.status(404).json({ error: "Could not generate signed URL" });
      res.json({ url });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Courses ───────────────────────────────────────────────────────────────
  app.get("/api/courses", requireAuth, async (_req, res) => {
    try {
      const courses = await query("SELECT * FROM courses ORDER BY name");
      res.json(courses);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/courses/:id/modules", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const modules = await query(
        "SELECT * FROM modules WHERE course_id=$1 ORDER BY position,id",
        [req.params.id]
      );
      res.json(modules);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/courses/:id/modules", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), validateBody(moduleCreateSchema), async (req, res) => {
    try {
      const { name, content } = req.body;
      const mod = await queryOne(
        "INSERT INTO modules (course_id,name,content) VALUES ($1,$2,$3) RETURNING *",
        [req.params.id, name, content]
      );
      res.status(201).json(mod);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Modules ───────────────────────────────────────────────────────────────
  app.get("/api/modules/:id/materials", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const materials = await query("SELECT * FROM materials WHERE module_id=$1", [req.params.id]);
      res.json(materials);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/materials", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { title, type, size } = req.body;
      const mat = await queryOne(
        "INSERT INTO materials (module_id,title,type,size) VALUES ($1,$2,$3,$4) RETURNING *",
        [req.params.id, title, type, size]
      );
      res.status(201).json(mat);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Notes ─────────────────────────────────────────────────────────────────
  app.get("/api/modules/:id/notes", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      let notes;
      if (authReq.auth.role === "student") {
        notes = await query(
          `SELECT n.*, u.name AS uploader_name
           FROM notes n LEFT JOIN users u ON n.uploaded_by = u.id
           WHERE n.module_id=$1 AND n.uploaded_by=$2
           ORDER BY n.created_at DESC`,
          [req.params.id, authReq.auth.legacyUserId]
        );
      } else {
        notes = await query(
          `SELECT n.*, u.name AS uploader_name
           FROM notes n LEFT JOIN users u ON n.uploaded_by = u.id
           WHERE n.module_id=$1 ORDER BY n.created_at DESC`,
          [req.params.id]
        );
      }
      res.json(notes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/notes", requireAuth, uploadLimiter, validateParams(routeParamId), uploadNote.single("file"), async (req, res) => {
    try {
      const authReq  = req as AuthenticatedRequest;
      const file     = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const moduleId    = Number(req.params.id);
      const userId      = authReq.auth.legacyUserId;
      const objectPath  = `notes/${userId}/${moduleId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      await uploadToStorage(NOTES_BUCKET, objectPath, file.buffer, file.mimetype);

      const extractedText = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);

      const note = await queryOne(
        `INSERT INTO notes (module_id, uploaded_by, title, file_type, file_size, storage_path, original_name, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [moduleId, userId, file.originalname, file.mimetype,
         file.size, objectPath, file.originalname, extractedText.slice(0, 5000)]
      );

      if (extractedText.trim().length > 50) {
        const chunks = chunkText(extractedText);
        if (chunks.length > 0) {
          try {
            const embeddings = await nimEmbed(chunks, "passage");
            for (let i = 0; i < chunks.length; i++) {
              await run(
                `INSERT INTO note_chunks (note_id, chunk_index, chunk_text, embedding)
                 VALUES ($1,$2,$3,$4)`,
                [note.id, i, chunks[i], JSON.stringify(embeddings[i])]
              );
            }
          } catch (embErr) {
            console.error("[Notes] embedding failed (non-fatal):", embErr);
          }
        }
      }

      res.status(201).json(note);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const note = await queryOne(
        "SELECT id, storage_path, uploaded_by FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (authReq.auth.role === "student" && note.uploaded_by !== authReq.auth.legacyUserId) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (note.storage_path) await deleteFromStorage(NOTES_BUCKET, note.storage_path);
      await run("DELETE FROM note_chunks WHERE note_id=$1", [note.id]);
      await run("DELETE FROM notes WHERE id=$1", [note.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Assignments ───────────────────────────────────────────────────────────
  app.get("/api/modules/:id/assignments", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const assignments = await query(
        "SELECT * FROM assignments WHERE module_id=$1 ORDER BY due_date",
        [req.params.id]
      );
      res.json(assignments);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/assignments", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), validateBody(assignmentCreateSchema), async (req, res) => {
    try {
      const { title, description, due_date, max_score } = req.body;
      const assignment = await queryOne(
        "INSERT INTO assignments (module_id,title,description,due_date,max_score) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [req.params.id, title, description, due_date, max_score]
      );
      res.status(201).json(assignment);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/assignments/:id", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), validateBody(assignmentUpdateSchema), async (req, res) => {
    try {
      const { title, description, due_date, max_score } = req.body;
      const assignment = await queryOne(
        "UPDATE assignments SET title=$1,description=$2,due_date=$3,max_score=$4 WHERE id=$5 RETURNING *",
        [title, description, due_date, max_score, req.params.id]
      );
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });
      res.json(assignment);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/assignments/:id", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { changes } = await run("DELETE FROM assignments WHERE id=$1", [req.params.id]);
      if (!changes) return res.status(404).json({ error: "Assignment not found" });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Submissions ───────────────────────────────────────────────────────────
  app.post("/api/submissions", requireAuth, validateBody(submissionCreateSchema), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { assignment_id, content } = req.body;
      const sub = await queryOne(
        "INSERT INTO submissions (assignment_id,student_id,content,submitted_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [assignment_id, authReq.auth.legacyUserId, content]
      );
      await notify(pool, {
        userId: authReq.auth.legacyUserId,
        type: "submission_received",
        message: "Your submission was received.",
      });
      res.status(201).json(sub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/submissions/upload", requireAuth, uploadLimiter, uploadSubmission.array("files", 5), async (req, res) => {
    try {
      const authReq     = req as AuthenticatedRequest;
      const files       = (req as any).files as Express.Multer.File[];
      const assignmentId = Number(req.body.assignment_id);
      const content     = req.body.content ?? "";

      if (!assignmentId) return res.status(400).json({ error: "assignment_id required" });

      const sub = await queryOne(
        "INSERT INTO submissions (assignment_id,student_id,content,submitted_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [assignmentId, authReq.auth.legacyUserId, content]
      );

      const fileRecords = [];
      for (const file of files ?? []) {
        const objectPath = `submissions/${authReq.auth.legacyUserId}/${assignmentId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await uploadToStorage(SUBMISSIONS_BUCKET, objectPath, file.buffer, file.mimetype);
        const fileRecord = await queryOne(
          `INSERT INTO submission_files (submission_id, original_name, file_type, file_size, storage_path)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [sub.id, file.originalname, file.mimetype, file.size, objectPath]
        );
        fileRecords.push(fileRecord);
      }

      res.status(201).json({ ...sub, files: fileRecords });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/submissions/:id/files", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const files = await query(
        "SELECT * FROM submission_files WHERE submission_id=$1",
        [req.params.id]
      );
      const withUrls = await Promise.all(
        files.map(async (f: any) => ({
          ...f,
          signedUrl: await getSignedUrl(SUBMISSIONS_BUCKET, f.storage_path),
        }))
      );
      res.json(withUrls);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/submissions/:id/grade", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), validateBody(gradeSchema), async (req, res) => {
    try {
      const { grade, feedback } = req.body;
      const sub = await queryOne(
        "UPDATE submissions SET grade=$1,feedback=$2,graded_at=NOW() WHERE id=$3 RETURNING *",
        [grade, feedback, req.params.id]
      );
      if (!sub) return res.status(404).json({ error: "Submission not found" });
      if (sub.student_id) {
        await notify(pool, {
          userId: sub.student_id,
          type: "grade_posted",
          message: `Your submission has been graded: ${grade}`,
          metadata: { submission_id: sub.id, grade },
        });
      }
      res.json(sub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Instructor ────────────────────────────────────────────────────────────
  app.get("/api/instructor/submissions", requireAuth, requireRole("instructor","admin"), async (_req, res) => {
    try {
      const subs = await query(
        `SELECT s.*,
                u.name  AS student_name,
                a.title AS assignment_title,
                m.name  AS module_name
         FROM submissions s
         JOIN users u       ON s.student_id    = u.id
         JOIN assignments a ON s.assignment_id = a.id
         JOIN modules m     ON a.module_id     = m.id
         ORDER BY s.submitted_at DESC`
      );
      res.json(subs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/courses", requireAuth, requireRole("instructor","admin"), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const courses = await query(
        "SELECT * FROM courses WHERE instructor_id=$1 ORDER BY name",
        [authReq.auth.legacyUserId]
      );
      res.json(courses);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/courses/:id/analytics", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const enrollmentCount = await queryOne(
        "SELECT COUNT(*) AS count FROM enrollments WHERE course_id=$1",
        [req.params.id]
      );
      const avgGrade = await queryOne(
        `SELECT AVG(s.grade) AS avg
         FROM submissions s
         JOIN assignments a ON s.assignment_id=a.id
         JOIN modules m     ON a.module_id=m.id
         WHERE m.course_id=$1 AND s.grade IS NOT NULL`,
        [req.params.id]
      );
      res.json({
        enrollment_count: Number(enrollmentCount?.count ?? 0),
        avg_grade: avgGrade?.avg ? Number(avgGrade.avg).toFixed(1) : null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/instructor/assignments", requireAuth, requireRole("instructor","admin"), validateBody(instructorAssignmentCreateSchema), async (req, res) => {
    try {
      const { module_id, title, description, due_date, max_score } = req.body;
      const assignment = await queryOne(
        "INSERT INTO assignments (module_id,title,description,due_date,max_score) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [module_id, title, description, due_date, max_score]
      );
      res.status(201).json(assignment);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Student ───────────────────────────────────────────────────────────────
  app.get("/api/student/:id/courses", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      const courses = await query(
        `SELECT c.* FROM courses c
         JOIN enrollments e ON c.id=e.course_id
         WHERE e.student_id=$1`,
        [req.params.id]
      );
      res.json(courses);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/student/:id/assignments", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      const assignments = await query(
        `SELECT a.*, m.name AS module_name, c.name AS course_name,
                s.grade, s.feedback, s.submitted_at, s.id AS submission_id
         FROM assignments a
         JOIN modules m     ON a.module_id=m.id
         JOIN courses c     ON m.course_id=c.id
         JOIN enrollments e ON c.id=e.course_id AND e.student_id=$1
         LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=$1
         ORDER BY a.due_date`,
        [req.params.id]
      );
      res.json(assignments);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/student/:id/stats", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      const stats = await queryOne(
        `SELECT
           COUNT(DISTINCT e.course_id)  AS enrolled_courses,
           COUNT(DISTINCT s.id)          AS total_submissions,
           AVG(s.grade)                  AS average_grade
         FROM enrollments e
         LEFT JOIN submissions s ON s.student_id=e.student_id
         WHERE e.student_id=$1`,
        [req.params.id]
      );
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/analytics", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      const submissions = await query(
        `SELECT s.grade, s.submitted_at, a.title AS assignment_title,
                m.name AS module_name, c.name AS course_name
         FROM submissions s
         JOIN assignments a ON s.assignment_id=a.id
         JOIN modules m     ON a.module_id=m.id
         JOIN courses c     ON m.course_id=c.id
         WHERE s.student_id=$1 AND s.grade IS NOT NULL
         ORDER BY s.submitted_at`,
        [req.params.id]
      );
      res.json(submissions);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/notes", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      const notes = await query(
        `SELECT n.*, m.name AS module_name, c.name AS course_name
         FROM notes n
         JOIN modules m ON n.module_id=m.id
         JOIN courses c ON m.course_id=c.id
         WHERE n.uploaded_by=$1
         ORDER BY n.created_at DESC`,
        [req.params.id]
      );
      res.json(notes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  app.get("/api/admin/users", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const users = await query("SELECT id,name,email,role,active,year,major,gpa FROM users ORDER BY name");
      res.json(users);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/users", requireAuth, requireRole("admin"), validateBody(adminUserCreateSchema), async (req, res) => {
    try {
      const { name, email, role, year, major, gpa } = req.body;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await client.query(
          "INSERT INTO users (name,email,role,active,year,major,gpa) VALUES ($1,$2,$3,1,$4,$5,$6) RETURNING *",
          [name, email, role, year ?? null, major ?? null, gpa ?? null]
        );
        const newUser = user.rows[0];
        const authResult = await createAuthUserAndIdentityMapRow(client, newUser.id, email, role);
        await client.query("COMMIT");
        res.status(201).json({
          ...newUser,
          tempPassword: authResult?.tempPassword,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/admin/users/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), validateBody(adminUserUpdateSchema), async (req, res) => {
    try {
      const { name, email, role, active, year, major, gpa } = req.body;
      const user = await queryOne(
        "UPDATE users SET name=$1,email=$2,role=$3,active=$4,year=$5,major=$6,gpa=$7 WHERE id=$8 RETURNING *",
        [name, email, role, active, year ?? null, major ?? null, gpa ?? null, req.params.id]
      );
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/stats", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const [users, courses, submissions, enrollments] = await Promise.all([
        queryOne("SELECT COUNT(*) AS count FROM users WHERE active=1"),
        queryOne("SELECT COUNT(*) AS count FROM courses"),
        queryOne("SELECT COUNT(*) AS count FROM submissions"),
        queryOne("SELECT COUNT(*) AS count FROM enrollments"),
      ]);
      res.json({
        users:       Number(users?.count ?? 0),
        courses:     Number(courses?.count ?? 0),
        submissions: Number(submissions?.count ?? 0),
        enrollments: Number(enrollments?.count ?? 0),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/settings", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const settings = await query("SELECT key, value FROM settings");
      const obj: Record<string, string> = {};
      settings.forEach((s: any) => { obj[s.key] = s.value; });
      res.json(obj);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/settings", requireAuth, requireRole("admin"), validateBody(settingsSchema), async (req, res) => {
    try {
      const { key, value } = req.body;
      await run(
        "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
        [key, value]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/courses", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const courses = await query(
        `SELECT c.*, u.name AS instructor_name
         FROM courses c LEFT JOIN users u ON c.instructor_id=u.id
         ORDER BY c.name`
      );
      res.json(courses);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/courses", requireAuth, requireRole("admin"), validateBody(courseCreateSchema), async (req, res) => {
    try {
      const { name, description, instructor_id, credits, semester } = req.body;
      const course = await queryOne(
        "INSERT INTO courses (name,description,instructor_id,credits,semester) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [name, description, instructor_id ?? null, credits ?? null, semester ?? null]
      );
      res.status(201).json(course);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admin/courses/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { changes } = await run("DELETE FROM courses WHERE id=$1", [req.params.id]);
      if (!changes) return res.status(404).json({ error: "Course not found" });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/enrollments/:courseId", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const enrollments = await query(
        `SELECT e.*, u.name AS student_name, u.email AS student_email
         FROM enrollments e JOIN users u ON e.student_id=u.id
         WHERE e.course_id=$1`,
        [req.params.courseId]
      );
      res.json(enrollments);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/enrollments", requireAuth, requireRole("admin"), validateBody(enrollmentCreateSchema), async (req, res) => {
    try {
      const { course_id, student_id } = req.body;
      const enrollment = await queryOne(
        "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *",
        [course_id, student_id]
      );
      await notify(pool, {
        userId: student_id,
        type: "enrollment_confirmed",
        message: "You have been enrolled in a new course.",
        metadata: { course_id },
      });
      res.status(201).json(enrollment ?? { message: "Already enrolled" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/bulk-enroll", requireAuth, requireRole("admin"), validateBody(bulkEnrollSchema), async (req, res) => {
    try {
      const { course_id, emails } = req.body;
      const results = [];
      for (const email of emails) {
        const student = await queryOne("SELECT id FROM users WHERE email=$1 AND role='student'", [email]);
        if (!student) { results.push({ email, status: "not_found" }); continue; }
        const enrollment = await queryOne(
          "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *",
          [course_id, student.id]
        );
        await notify(pool, {
          userId: student.id,
          type: "enrollment_confirmed",
          message: "You have been enrolled in a new course.",
          metadata: { course_id },
        });
        results.push({ email, status: enrollment ? "enrolled" : "already_enrolled" });
      }
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admin/enrollments/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { changes } = await run("DELETE FROM enrollments WHERE id=$1", [req.params.id]);
      if (!changes) return res.status(404).json({ error: "Enrollment not found" });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── AI ────────────────────────────────────────────────────────────────────
  app.post("/api/ai/grade", requireAuth, requireRole("instructor","admin"), aiLimiter, async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const prompt = `You are a university grading assistant. Grade the following student submission based on the rubric provided.\n\nRubric:\n${rubric}\n\nSubmission:\n${submissionContent}\n\nProvide:\n1. A numerical grade (0-100)\n2. Detailed feedback\n3. Strengths\n4. Areas for improvement\n\nRespond in JSON format: {"grade": number, "feedback": string, "strengths": string[], "improvements": string[]}`;
      const response = await nimChat([{ role: "user", content: prompt }], { temperature: 0.3, maxTokens: 1024 });
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] ?? response);
      } catch {
        result = { grade: 75, feedback: response, strengths: [], improvements: [] };
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ai/grade-pdf", requireAuth, requireRole("instructor","admin"), aiGradeLimiter, validateBody(gradePdfSchema), async (req, res) => {
    try {
      const { submission_id, rubric, module_id } = req.body;
      const sub = await queryOne(
        "SELECT * FROM submissions WHERE id=$1",
        [submission_id]
      );
      if (!sub) return res.status(404).json({ error: "Submission not found" });

      const files = await query(
        "SELECT * FROM submission_files WHERE submission_id=$1",
        [submission_id]
      );

      let content = sub.content ?? "";
      for (const file of files) {
        const result = await downloadFromStorage(SUBMISSIONS_BUCKET, file.storage_path);
        if (result) {
          const extracted = await extractTextFromBuffer(result.buffer, file.content_type ?? file.file_type, file.original_name);
          if (extracted) content += "\n" + extracted;
        }
      }

      let context = "";
      if (module_id) {
        const chunks = await retrieveChunks(module_id, content.slice(0, 500));
        if (chunks.length) context = "\n\nRelevant course material:\n" + chunks.join("\n---\n");
      }

      const prompt = `You are a university grading assistant.${context}\n\nRubric:\n${rubric}\n\nStudent submission:\n${content.slice(0, 4000)}\n\nProvide JSON: {"grade": number, "feedback": string, "strengths": string[], "improvements": string[]}`;
      const response = await nimChat([{ role: "user", content: prompt }], { temperature: 0.3, maxTokens: 1024 });
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] ?? response);
      } catch {
        result = { grade: 75, feedback: response, strengths: [], improvements: [] };
      }

      await run(
        "UPDATE submissions SET grade=$1,feedback=$2,graded_at=NOW() WHERE id=$3",
        [result.grade, result.feedback, submission_id]
      );

      if (sub.student_id) {
        await queryOne(
          `INSERT INTO ai_feedback (submission_id, student_id, grade, feedback, strengths, improvements)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (submission_id) DO UPDATE
             SET grade=EXCLUDED.grade, feedback=EXCLUDED.feedback,
                 strengths=EXCLUDED.strengths, improvements=EXCLUDED.improvements,
                 created_at=NOW()`,
          [
            submission_id, sub.student_id, result.grade, result.feedback,
            JSON.stringify(result.strengths ?? []),
            JSON.stringify(result.improvements ?? []),
          ]
        );
        await notify(pool, {
          userId: sub.student_id,
          type: "grade_posted",
          message: `Your submission has been graded: ${result.grade}`,
          metadata: { submission_id, grade: result.grade },
        });
      }

      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ai/chat", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { question, moduleTitle, moduleId, history } = req.body;
      if (!question) return res.status(400).json({ error: "question required" });

      const contextChunks = moduleId ? await retrieveChunks(moduleId, question) : [];
      const contextBlock  = contextChunks.length
        ? `\n\nRelevant course material:\n${contextChunks.join("\n---\n")}`
        : "";

      const systemPrompt =
        `You are a helpful university teaching assistant for the module "${moduleTitle ?? "this course"}".${contextBlock}\n` +
        `Answer concisely and accurately. If a question is outside the course scope, say so politely.`;

      const messages = [
        { role: "system", content: systemPrompt },
        ...(history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user",   content: question },
      ];

      const answer = await nimChat(messages, { temperature: 0.5, maxTokens: 512 });
      res.json({ answer });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ai/analytics-summary", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { analytics } = req.body;
      const prompt = `Summarise these student analytics in 2–3 sentences: ${JSON.stringify(analytics)}`;
      const summary = await nimChat([{ role: "user", content: prompt }], { temperature: 0.4, maxTokens: 256 });
      res.json({ summary });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Snapshots ─────────────────────────────────────────────────────────────
  app.get("/api/admin/stats/snapshot", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const row = await queryOne(
        "SELECT * FROM admin_stats_snapshots ORDER BY created_at DESC LIMIT 1"
      );
      if (!row) return res.status(404).json({ error: "No snapshot available" });
      const age = Date.now() - new Date(row.created_at).getTime();
      res.json({ ...row, stale: age > SNAPSHOT_STALE_MS });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/courses/:id/analytics/snapshot", requireAuth, requireRole("instructor","admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const row = await queryOne(
        "SELECT * FROM course_analytics_snapshots WHERE course_id=$1 ORDER BY created_at DESC LIMIT 1",
        [req.params.id]
      );
      if (!row) return res.status(404).json({ error: "No snapshot available" });
      const age = Date.now() - new Date(row.created_at).getTime();
      res.json({ ...row, stale: age > SNAPSHOT_STALE_MS });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Serve SPA ─────────────────────────────────────────────────────────────
  if (isProduction) {
    const distPath = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = Number(process.env.PORT ?? 10000);
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));

  // Run startup tasks after the server is already listening
  checkStorageConnectivity().catch(console.error);
  startCronJobs(pool, nimChat).catch(console.error);
}

startServer().catch(e => {
  console.error("[server] fatal startup error:", e);
  process.exit(1);
});
