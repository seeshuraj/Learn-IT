import express, { Request, Response, NextFunction } from "express";
import pkg from "pg";
const { Pool } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "module";
import fs from "fs";
import dns from "dns";
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
  let pwd = "";
  pwd += "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
  pwd += "23456789"[Math.floor(Math.random() * 8)];
  pwd += "!@#$%^&*"[Math.floor(Math.random() * 8)];
  for (let i = 3; i < 16; i++) {
    pwd += charset[Math.floor(Math.random() * charset.length)];
  }
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
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

const memStorage      = multer.memoryStorage();
const uploadNote      = multer({ storage: memStorage, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadSubmission = multer({ storage: memStorage, limits: { fileSize: 50 * 1024 * 1024 } });

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
    }
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
    }
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

  // Trust the first proxy hop (required on Render/Heroku for express-rate-limit
  // to read the real client IP from X-Forwarded-For without throwing a
  // ValidationError about the "ip" option).
  app.set("trust proxy", 1);

  app.use(attachRequestId);
  app.use(requestLogger);

  app.use("/api", generalApiLimiter);

  const ALLOWED_RE =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    const allow  = !origin || ALLOWED_RE.test(origin) ? (origin ?? "*") : "";
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin",      allow);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods",     "GET,POST,PUT,DELETE,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers",     "Content-Type,Authorization,X-Requested-With");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json());

  // ── P3-3: Student Roadmaps ────────────────────────────────────────────────
  app.use("/api/roadmaps", createRoadmapRouter(pool, nimChat));

  // ── P3-4: Notifications ───────────────────────────────────────────────────
  app.use("/api/notifications", createNotificationsRouter(pool));

  // ── P3-5: Auth (password reset / force-change) ────────────────────────────
  app.use("/api/auth", createAuthRouter(pool));

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
          action: 'login.success', resourceType: 'user', resourceId: String(user.id),
          actorUserId: authReq.auth.legacyUserId, actorEmail: authReq.auth.email,
          actorRole: authReq.auth.role, req,
        });
        res.json(user);
      } else {
        writeAudit({
          action: 'login.denied', actorEmail: authReq.auth.email,
          actorUserId: authReq.auth.legacyUserId,
          metadata: { reason: 'inactive_or_not_found' }, req,
        });
        res.status(403).json({ error: "Account inactive or not found" });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── File proxy ────────────────────────────────────────────────────────────
  app.get("/api/notes/:id/proxy", requireAuth, async (req, res) => {
    try {
      const note = await queryOne(
        "SELECT storage_path, file_type, original_name FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (!note.storage_path) return res.status(404).json({ error: "File not stored — upload may have failed" });
      const result = await downloadFromStorage(NOTES_BUCKET, note.storage_path);
      if (!result) return res.status(502).json({ error: "Failed to fetch from Supabase Storage" });
      const disposition = `inline; filename="${encodeURIComponent(note.original_name ?? "file")}"`;
      res.setHeader("Content-Type",        note.file_type || result.contentType);
      res.setHeader("Content-Disposition", disposition);
      res.setHeader("Content-Length",      result.buffer.length);
      return res.send(result.buffer);
    } catch (e: any) {
      console.error("[proxy] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/notes/:id/signed-url", requireAuth, async (req, res) => {
    try {
      const note = await queryOne("SELECT storage_path FROM notes WHERE id=$1", [req.params.id]);
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (!note.storage_path) return res.status(404).json({ error: "File not stored" });
      const url = await getSignedUrl(NOTES_BUCKET, note.storage_path, 900);
      if (!url) return res.status(502).json({ error: "Could not generate signed URL" });
      res.json({ url });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Courses ───────────────────────────────────────────────────────────────
  app.get("/api/courses", requireAuth, async (_req, res) => {
    try {
      res.json(await query(`
        SELECT c.*, u.name as instructor_name,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrollment_count
        FROM courses c JOIN users u ON c.instructor_id = u.id
        WHERE c.archived = 0
      `));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/courses/:id/modules", requireAuth, async (req, res) => {
    try {
      res.json(await query(
        "SELECT * FROM modules WHERE course_id = $1 ORDER BY display_order ASC",
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/courses/:id/modules",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(moduleCreateSchema),
    async (req, res) => {
      try {
        const { name, content } = req.body;
        const last = await queryOne(
          "SELECT MAX(display_order) as maxorder FROM modules WHERE course_id = $1",
          [req.params.id]
        );
        const result = await run(
          "INSERT INTO modules (course_id, name, content, display_order) VALUES ($1,$2,$3,$4) RETURNING id",
          [req.params.id, name, content, (parseInt(last?.maxorder) || 0) + 1]
        );
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── Materials ─────────────────────────────────────────────────────────────
  app.get("/api/modules/:id/materials", requireAuth, async (req, res) => {
    try {
      res.json(await query("SELECT * FROM materials WHERE module_id = $1", [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/materials", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      const { title, type, size } = req.body;
      const result = await run(
        "INSERT INTO materials (module_id, title, type, url, size) VALUES ($1,$2,$3,'#',$4) RETURNING id",
        [req.params.id, title, type, size]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Assignments ───────────────────────────────────────────────────────────
  app.get("/api/modules/:id/assignments", requireAuth, async (req, res) => {
    try {
      const status = (req.query.status as string) || "active";
      res.json(await query(
        "SELECT * FROM assignments WHERE module_id = $1 AND status = $2",
        [req.params.id, status]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/modules/:id/assignments",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(assignmentCreateSchema),
    async (req, res) => {
      try {
        const { title, description, due_date, max_points, rubric, status } = req.body;
        const result = await run(
          "INSERT INTO assignments (module_id,title,description,due_date,max_points,rubric,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [req.params.id, title, description, due_date, max_points, rubric, status]
        );
        if (status === 'active') {
          const enrolled = await query(
            `SELECT e.student_id FROM enrollments e
             JOIN modules m ON m.course_id = e.course_id
             WHERE m.id = $1`,
            [req.params.id]
          );
          for (const r of enrolled) {
            notify(pool, r.student_id, 'new_assignment',
              `New assignment posted: "${title}"`,
              { assignmentId: result.lastInsertId, moduleId: req.params.id }
            );
          }
        }
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.put(
    "/api/assignments/:id",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(assignmentUpdateSchema),
    async (req, res) => {
      try {
        const { title, description, due_date, max_points, rubric, status } = req.body;
        await run(
          "UPDATE assignments SET title=$1,description=$2,due_date=$3,max_points=$4,rubric=$5,status=$6 WHERE id=$7",
          [title, description, due_date, max_points, rubric, status, req.params.id]
        );
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.delete("/api/assignments/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      await run("UPDATE assignments SET status='archived' WHERE id=$1", [req.params.id]);
      const auth = (req as AuthenticatedRequest).auth;
      writeAudit({
        action: 'assignment.archive', resourceType: 'assignment', resourceId: req.params.id,
        actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role, req,
      });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Submissions ───────────────────────────────────────────────────────────
  app.post(
    "/api/submissions",
    requireAuth, requireRole("student"),
    validateBody(submissionCreateSchema),
    async (req, res) => {
      try {
        const { assignment_id, content } = req.body;
        const student_id = (req as AuthenticatedRequest).auth.legacyUserId;
        const existing = await queryOne(
          "SELECT id FROM submissions WHERE assignment_id=$1 AND student_id=$2",
          [assignment_id, student_id]
        );
        if (existing) return res.status(409).json({ error: "Already submitted" });
        const result = await run(
          "INSERT INTO submissions (assignment_id,student_id,content) VALUES ($1,$2,$3) RETURNING id",
          [assignment_id, student_id, sanitizeText(content ?? "")]
        );
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.post("/api/submissions/upload", requireAuth, requireRole("student"), uploadLimiter, uploadSubmission.array("files", 5), async (req: any, res) => {
    try {
      const { assignment_id, content = "" } = req.body;
      const student_id = (req as AuthenticatedRequest).auth.legacyUserId;
      if (!assignment_id) return res.status(400).json({ error: "assignment_id required" });
      const existing = await queryOne(
        "SELECT id FROM submissions WHERE assignment_id=$1 AND student_id=$2",
        [assignment_id, student_id]
      );
      if (existing) return res.status(409).json({ error: "Already submitted" });
      const result = await run(
        "INSERT INTO submissions (assignment_id,student_id,content) VALUES ($1,$2,$3) RETURNING id",
        [assignment_id, student_id, sanitizeText(content)]
      );
      const submissionId = result.lastInsertId;
      const files: any[] = req.files ?? [];
      const savedFiles: any[] = [];
      for (const file of files) {
        const ext        = path.extname(file.originalname).toLowerCase();
        const objectPath = `submission/${submissionId}/${Date.now()}${ext}`;
        try {
          const storedPath = await uploadToStorage(
            SUBMISSIONS_BUCKET, objectPath, file.buffer, file.mimetype
          );
          await run(
            "INSERT INTO submission_files (submission_id,filename,original_name,file_type,storage_path) VALUES ($1,$2,$3,$4,$5)",
            [submissionId, file.originalname, file.originalname, file.mimetype, storedPath]
          );
          savedFiles.push({ filename: file.originalname, original_name: file.originalname });
        } catch (uploadErr: any) {
          console.error(`[submissions/upload] file upload failed for ${file.originalname}:`, uploadErr.message);
          savedFiles.push({ filename: file.originalname, error: uploadErr.message });
        }
      }
      res.json({ id: submissionId, files: savedFiles });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/submissions/:id/files", requireAuth, async (req, res) => {
    try {
      const files = await query(
        "SELECT id,filename,original_name,file_type,uploaded_at,storage_path FROM submission_files WHERE submission_id=$1",
        [req.params.id]
      );
      const withUrls = await Promise.all(files.map(async (f: any) => {
        const signedUrl = f.storage_path
          ? await getSignedUrl(SUBMISSIONS_BUCKET, f.storage_path)
          : null;
        const { storage_path: _omit, ...safeFile } = f;
        return { ...safeFile, url: signedUrl ?? null };
      }));
      res.json(withUrls);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/submissions", requireAuth, requireRole("instructor", "admin"), async (_req, res) => {
    try {
      res.json(await query(`
        SELECT s.*, a.title as assignment_title, a.rubric, a.max_points,
               u.name as student_name, c.name as course_name, c.id as course_id,
               (SELECT COUNT(*) FROM submission_files sf WHERE sf.submission_id = s.id) as file_count
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN users u ON s.student_id = u.id
        JOIN modules m ON a.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        WHERE s.grade IS NULL OR s.grade = 0
        ORDER BY s.submitted_at DESC
      `));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/submissions/:id/grade",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(gradeSchema),
    async (req, res) => {
      try {
        const { grade, feedback } = req.body;
        await run(
          "UPDATE submissions SET grade=$1,feedback=$2 WHERE id=$3",
          [grade, feedback, req.params.id]
        );
        const auth = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'grade.submit', resourceType: 'submission', resourceId: req.params.id,
          actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
          metadata: { grade }, req,
        });
        const sub = await queryOne(
          `SELECT s.student_id, a.title as assignment_title
           FROM submissions s JOIN assignments a ON s.assignment_id = a.id
           WHERE s.id = $1`,
          [req.params.id]
        );
        if (sub) {
          notify(pool, sub.student_id, 'grade_posted',
            `Your submission for "${sub.assignment_title}" has been graded: ${grade}%`,
            { submissionId: req.params.id, grade }
          );
        }
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── Notes ─────────────────────────────────────────────────────────────────
  app.post("/api/modules/:id/notes", requireAuth, requireRole("instructor", "admin"), uploadLimiter, uploadNote.single("file"), async (req: any, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "file required" });
      const text       = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);
      const ext        = path.extname(file.originalname).toLowerCase();
      const objectPath = `module/${req.params.id}/${Date.now()}${ext}`;
      const storedPath = await uploadToStorage(NOTES_BUCKET, objectPath, file.buffer, file.mimetype);
      const result = await run(
        `INSERT INTO notes
           (student_id, module_id, filename, original_name, storage_path, content_text, file_type)
         VALUES (NULL,$1,$2,$3,$4,$5,$6) RETURNING id`,
        [req.params.id, file.originalname, file.originalname, storedPath, text, file.mimetype]
      );
      const noteId = result.lastInsertId;
      const chunks = chunkText(text);
      if (chunks.length > 0) {
        try {
          const embeddings = await nimEmbed(chunks, "passage");
          for (let i = 0; i < chunks.length; i++) {
            await run(
              "INSERT INTO note_chunks (note_id,chunk_index,chunk_text,embedding) VALUES ($1,$2,$3,$4)",
              [noteId, i, sanitizeText(chunks[i]), JSON.stringify(embeddings[i] ?? [])]
            );
          }
          console.log(`[notes] embedded ${chunks.length} chunks for note ${noteId}`);
        } catch (embErr) {
          console.error("[notes] embedding error (non-fatal):", embErr);
        }
      }
      res.json({ id: noteId, original_name: file.originalname, chunk_count: chunks.length, text_length: text.length });
    } catch (e: any) {
      console.error("[POST /api/modules/:id/notes] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/modules/:id/notes", requireAuth, async (req, res) => {
    try {
      const notes = await query(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               n.storage_path, m.name as module_name, c.name as course_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n
        JOIN modules m ON n.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        WHERE n.module_id = $1 AND n.student_id IS NULL
        ORDER BY n.uploaded_at DESC
      `, [req.params.id]);
      const withUrls = await Promise.all(notes.map(async (n: any) => {
        const signedUrl = n.storage_path ? await getSignedUrl(NOTES_BUCKET, n.storage_path) : null;
        const { storage_path: _omit, ...safeNote } = n;
        return { ...safeNote, proxy_url: `/api/notes/${n.id}/proxy`, signed_url: signedUrl };
      }));
      res.json(withUrls);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      const note = await queryOne("SELECT storage_path, original_name FROM notes WHERE id=$1", [req.params.id]);
      if (note?.storage_path) await deleteFromStorage(NOTES_BUCKET, note.storage_path);
      await run("DELETE FROM note_chunks WHERE note_id=$1", [req.params.id]);
      await run("DELETE FROM notes WHERE id=$1",            [req.params.id]);
      const auth = (req as AuthenticatedRequest).auth;
      writeAudit({
        action: 'note.delete', resourceType: 'note', resourceId: req.params.id,
        actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
        metadata: { original_name: note?.original_name ?? null }, req,
      });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/notes", requireAuth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      const notes = await query(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               n.storage_path, m.name as module_name, c.name as course_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n
        JOIN modules m ON n.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        JOIN enrollments e ON e.course_id = c.id
        WHERE e.student_id = $1 AND n.student_id IS NULL AND c.archived = 0
        ORDER BY n.uploaded_at DESC
      `, [req.params.id]);
      const withUrls = await Promise.all(notes.map(async (n: any) => {
        const signedUrl = n.storage_path ? await getSignedUrl(NOTES_BUCKET, n.storage_path) : null;
        const { storage_path: _omit, ...safeNote } = n;
        return { ...safeNote, proxy_url: `/api/notes/${n.id}/proxy`, signed_url: signedUrl };
      }));
      res.json(withUrls);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Student routes ────────────────────────────────────────────────────────
  app.get("/api/student/:id/courses", requireAuth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      res.json(await query(`
        SELECT c.*, u.name as instructor_name
        FROM courses c JOIN enrollments e ON c.id = e.course_id
        JOIN users u ON c.instructor_id = u.id
        WHERE e.student_id=$1 AND c.archived=0
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/student/:id/assignments", requireAuth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      res.json(await query(`
        SELECT a.*, m.name as module_name, c.name as course_name,
               s.id as submission_id, s.grade, s.feedback,
               s.content as submission_content, s.submitted_at,
               s.ai_score, s.ai_feedback
        FROM assignments a
        JOIN modules m ON a.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        JOIN enrollments e ON c.id = e.course_id
        LEFT JOIN submissions s ON a.id = s.assignment_id AND s.student_id = $1
        WHERE e.student_id=$1 AND a.status='active'
        ORDER BY a.due_date ASC
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/student/:id/stats", requireAuth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      const user = await queryOne("SELECT * FROM users WHERE id=$1", [req.params.id]);
      const submissions = await query(`
        SELECT s.*, a.title as assignment_title
        FROM submissions s JOIN assignments a ON s.assignment_id = a.id
        WHERE s.student_id=$1 AND s.grade IS NOT NULL
      `, [req.params.id]);
      res.json({ user, submissions });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/analytics", requireAuth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      const studentId = req.params.id;
      const student   = await queryOne("SELECT name FROM users WHERE id=$1", [studentId]);
      if (!student) return res.status(404).json({ error: "Student not found" });
      const enrolledCourses = await query(`
        SELECT c.id, c.code as course_code, c.name as course_name
        FROM enrollments e JOIN courses c ON e.course_id = c.id
        WHERE e.student_id=$1 AND c.archived=0
      `, [studentId]);
      const courses = await Promise.all(enrolledCourses.map(async (course: any) => {
        const totalRow = await queryOne(
          "SELECT COUNT(*) as count FROM assignments a JOIN modules m ON a.module_id=m.id WHERE m.course_id=$1 AND a.status='active'",
          [course.id]
        );
        const grades = await query(`
          SELECT a.title, s.grade, s.submitted_at
          FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN modules m ON a.module_id = m.id
          WHERE s.student_id=$1 AND m.course_id=$2 AND s.grade IS NOT NULL
          ORDER BY s.submitted_at ASC
        `, [studentId, course.id]);
        const avg = grades.length > 0
          ? grades.reduce((s: number, g: any) => s + g.grade, 0) / grades.length
          : null;
        const lateRow = await queryOne(`
          SELECT COUNT(*) as count FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN modules m ON a.module_id = m.id
          WHERE s.student_id=$1 AND m.course_id=$2
            AND a.due_date IS NOT NULL AND s.submitted_at::date > a.due_date::date
        `, [studentId, course.id]);
        return {
          course_code: course.course_code, course_name: course.course_name,
          assignments_total: parseInt(totalRow?.count) || 0,
          assignments_submitted: grades.length,
          avg_grade: avg != null ? Math.round(avg * 10) / 10 : null,
          late: parseInt(lateRow?.count) || 0,
          grades,
        };
      }));
      const allGrades = courses.flatMap((c: any) => c.grades.map((g: any) => g.grade));
      const overall_avg = allGrades.length > 0
        ? Math.round((allGrades.reduce((a: number, b: number) => a + b, 0) / allGrades.length) * 10) / 10
        : null;
      const totalAssignmentsRow = await queryOne(`
        SELECT COUNT(*) as count FROM assignments a
        JOIN modules m ON a.module_id = m.id
        JOIN enrollments e ON m.course_id = e.course_id
        WHERE e.student_id=$1 AND a.status='active'
      `, [studentId]);
      const totalSubmittedRow = await queryOne(
        "SELECT COUNT(*) as count FROM submissions WHERE student_id=$1", [studentId]
      );
      res.json({
        student_name:    student.name,
        overall_avg,
        total_submitted: parseInt(totalSubmittedRow?.count) || 0,
        total_pending:   Math.max(0, (parseInt(totalAssignmentsRow?.count) || 0) - (parseInt(totalSubmittedRow?.count) || 0)),
        courses,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  app.get("/api/admin/users", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await query("SELECT id,name,email,role,active,year,major,gpa FROM users ORDER BY role,name"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/admin/users",
    requireAuth, requireRole("admin"),
    validateBody(adminUserCreateSchema),
    async (req, res) => {
      const client = await pool.connect();
      try {
        const { name, email, role, major, year } = req.body;
        await client.query("BEGIN");
        const r = await client.query(
          "INSERT INTO users (name,email,role,major,year) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [name, email, role, major, year]
        );
        const legacyUserId: number = r.rows[0].id;
        let tempPassword: string | null = null;
        try {
          const authResult = await createAuthUserAndIdentityMapRow(client, legacyUserId, email, role);
          if (authResult) tempPassword = authResult.tempPassword;
        } catch (authErr: any) {
          await client.query("ROLLBACK");
          return res.status(500).json({ error: `User created in DB but Auth setup failed: ${authErr.message}` });
        }
        await client.query("COMMIT");
        const actor = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'user.create', resourceType: 'user', resourceId: String(legacyUserId),
          actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
          metadata: { email, role, name }, req,
        });
        res.json({ id: legacyUserId, tempPassword: tempPassword ?? "(Auth user already existed — no new password set)" });
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(400).json({ error: "Email already exists" });
      } finally {
        client.release();
      }
    }
  );

  app.put(
    "/api/admin/users/:id",
    requireAuth, requireRole("admin"),
    validateBody(adminUserUpdateSchema),
    async (req, res) => {
      try {
        const { name, email, role, active, major, year } = req.body;
        await run(
          "UPDATE users SET name=$1,email=$2,role=$3,active=$4,major=$5,year=$6 WHERE id=$7",
          [name, email, role, active, major, year, req.params.id]
        );
        const actor = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'user.update', resourceType: 'user', resourceId: req.params.id,
          actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
          metadata: { name, email, role, active }, req,
        });
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.get("/api/admin/courses", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await query(`
        SELECT c.id, c.code, c.name, c.archived, c.created_at,
               u.id AS instructor_id, u.name AS instructor_name,
               (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrollment_count,
               (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id)     AS module_count
        FROM courses c JOIN users u ON c.instructor_id = u.id
        WHERE c.archived = 0 ORDER BY c.created_at DESC
      `));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── P3-1: course.create audit ─────────────────────────────────────────────
  app.post(
    "/api/admin/courses",
    requireAuth, requireRole("admin"),
    validateBody(courseCreateSchema),
    async (req, res) => {
      try {
        const { code, name, instructor_id } = req.body;
        const result = await run(
          "INSERT INTO courses (code,name,instructor_id) VALUES ($1,$2,$3) RETURNING id",
          [code, name, instructor_id]
        );
        const actor = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'course.create', resourceType: 'course', resourceId: String(result.lastInsertId),
          actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
          metadata: { code, name, instructor_id }, req,
        });
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── P3-1: course.delete audit ─────────────────────────────────────────────
  app.delete("/api/admin/courses/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await run("DELETE FROM enrollments WHERE course_id=$1", [req.params.id]);
      await run("DELETE FROM courses WHERE id=$1",            [req.params.id]);
      const actor = (req as AuthenticatedRequest).auth;
      writeAudit({
        action: 'course.delete', resourceType: 'course', resourceId: req.params.id,
        actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
        req,
      });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/stats", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const snap = await queryOne(`SELECT * FROM admin_stats_snapshots ORDER BY snapshotted_at DESC LIMIT 1`);
      if (snap && Date.now() - new Date(snap.snapshotted_at).getTime() < SNAPSHOT_STALE_MS) {
        return res.json({
          activeUsers: snap.active_users, totalCourses: snap.total_courses,
          averageGrade: snap.average_grade, totalNotes: snap.total_notes,
          totalSubmissions: snap.total_submissions,
          _source: 'snapshot', _snapshotted_at: snap.snapshotted_at,
        });
      }
      const [activeUsers, totalCourses, avgGrade, totalNotes, totalSubmissions] = await Promise.all([
        queryOne("SELECT COUNT(*) as count FROM users WHERE active=1"),
        queryOne("SELECT COUNT(*) as count FROM courses WHERE archived=0"),
        queryOne("SELECT AVG(grade) as avg FROM submissions WHERE grade IS NOT NULL"),
        queryOne("SELECT COUNT(*) as count FROM notes"),
        queryOne("SELECT COUNT(*) as count FROM submissions"),
      ]);
      res.json({
        activeUsers: parseInt(activeUsers?.count) || 0,
        totalCourses: parseInt(totalCourses?.count) || 0,
        averageGrade: Math.round(parseFloat(avgGrade?.avg) || 0),
        totalNotes: parseInt(totalNotes?.count) || 0,
        totalSubmissions: parseInt(totalSubmissions?.count) || 0,
        _source: 'live',
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/settings", requireAuth, requireRole("admin"), async (_req, res) => {
    try { res.json(await query("SELECT * FROM settings")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/admin/settings",
    requireAuth, requireRole("admin"),
    validateBody(settingsSchema),
    async (req, res) => {
      try {
        const { key, value } = req.body;
        await run(
          "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
          [key, value]
        );
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.get("/api/admin/enrollments/:courseId", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      res.json(await query(`
        SELECT e.id,e.enrolled_at,u.id as student_id,u.name,u.email,u.year,u.major
        FROM enrollments e JOIN users u ON e.student_id=u.id
        WHERE e.course_id=$1 ORDER BY u.name
      `, [req.params.courseId]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── P3-1: enrollment.create audit ────────────────────────────────────────
  app.post(
    "/api/admin/enrollments",
    requireAuth, requireRole("admin"),
    validateBody(enrollmentCreateSchema),
    async (req, res) => {
      try {
        const { course_id, student_id } = req.body;
        const result = await run(
          "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
          [course_id, student_id]
        );
        if (!result.lastInsertId) return res.status(409).json({ error: "Already enrolled" });
        const actor = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'enrollment.create', resourceType: 'enrollment', resourceId: String(result.lastInsertId),
          actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
          metadata: { course_id, student_id }, req,
        });
        const course = await queryOne("SELECT name FROM courses WHERE id=$1", [course_id]);
        if (course) {
          notify(pool, student_id, 'enrollment_confirmed',
            `You have been enrolled in "${course.name}"`,
            { courseId: course_id }
          );
        }
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(400).json({ error: e.message }); }
    }
  );

  // ── P3-1: enrollment.delete audit ────────────────────────────────────────
  app.delete("/api/admin/enrollments/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const enrollment = await queryOne(
        "SELECT course_id, student_id FROM enrollments WHERE id=$1",
        [req.params.id]
      );
      await run("DELETE FROM enrollments WHERE id=$1", [req.params.id]);
      const actor = (req as AuthenticatedRequest).auth;
      writeAudit({
        action: 'enrollment.delete', resourceType: 'enrollment', resourceId: req.params.id,
        actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
        metadata: {
          course_id:  enrollment?.course_id  ?? null,
          student_id: enrollment?.student_id ?? null,
        },
        req,
      });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/admin/bulk-enroll",
    requireAuth, requireRole("admin"),
    validateBody(bulkEnrollSchema),
    async (req, res) => {
      const { course_id, emails } = req.body as { course_id: number; emails: string[] };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results: Array<{
          email: string; student_id: number; enrolled: boolean; newUser: boolean; tempPassword?: string;
        }> = [];
        for (const email of emails) {
          const trimmed = email.trim().toLowerCase();
          if (!trimmed) continue;
          let userRow = (await client.query("SELECT id, name FROM users WHERE email = $1", [trimmed])).rows[0];
          let isNewUser = false;
          let tempPassword: string | undefined;
          if (!userRow) {
            const name = trimmed.split("@")[0].replace(/[._]/g, " ");
            const r = await client.query(
              "INSERT INTO users (name, email, role) VALUES ($1, $2, 'student') ON CONFLICT DO NOTHING RETURNING id, name",
              [name, trimmed]
            );
            userRow = r.rows[0] ??
              (await client.query("SELECT id, name FROM users WHERE email = $1", [trimmed])).rows[0];
            isNewUser = true;
            try {
              const authResult = await createAuthUserAndIdentityMapRow(client, userRow.id, trimmed, "student");
              if (authResult) tempPassword = authResult.tempPassword;
            } catch (authErr: any) {
              await client.query("ROLLBACK");
              return res.status(500).json({
                error: `Failed to create Auth account for ${trimmed}: ${authErr.message}. No users were enrolled.`,
              });
            }
          }
          const r = await client.query(
            "INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
            [course_id, userRow.id]
          );
          results.push({ email: trimmed, student_id: userRow.id, enrolled: r.rows.length > 0, newUser: isNewUser, ...(tempPassword ? { tempPassword } : {}) });
        }
        await client.query("COMMIT");
        const enrolled = results.filter(r => r.enrolled).length;
        const created  = results.filter(r => r.newUser).length;
        const actor = (req as AuthenticatedRequest).auth;
        writeAudit({
          action: 'enrollment.bulk', resourceType: 'course', resourceId: String(course_id),
          actorUserId: actor.legacyUserId, actorEmail: actor.email, actorRole: actor.role,
          metadata: { enrolled, created, emailCount: emails.length }, req,
        });
        const course = await queryOne("SELECT name FROM courses WHERE id=$1", [course_id]);
        if (course) {
          for (const r of results.filter(x => x.enrolled)) {
            notify(pool, r.student_id, 'enrollment_confirmed',
              `You have been enrolled in "${course.name}"`,
              { courseId: course_id }
            );
          }
        }
        res.json({ enrolled, created, results });
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: e.message });
      } finally {
        client.release();
      }
    }
  );

  // ── Instructor ────────────────────────────────────────────────────────────
  app.get("/api/instructor/:id/courses", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      res.json(await query(`
        SELECT c.*,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) as enrollment_count,
          (SELECT COUNT(*) FROM modules m WHERE m.course_id=c.id) as module_count
        FROM courses c WHERE c.instructor_id=$1 AND c.archived=0
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/courses/:id/analytics", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      const courseId = req.params.id;
      const snap = await queryOne(
        `SELECT * FROM course_analytics_snapshots WHERE course_id = $1 ORDER BY snapshotted_at DESC LIMIT 1`,
        [courseId]
      );
      if (snap && Date.now() - new Date(snap.snapshotted_at).getTime() < SNAPSHOT_STALE_MS) {
        const students: any[] = typeof snap.students === 'string' ? JSON.parse(snap.students) : snap.students;
        return res.json({
          enrollments: snap.enrollment_count, averageGrade: snap.average_grade, students,
          _source: 'snapshot', _snapshotted_at: snap.snapshotted_at,
        });
      }
      const [enrollmentCount, avgGradeRow] = await Promise.all([
        queryOne("SELECT COUNT(*) as count FROM enrollments WHERE course_id=$1", [courseId]),
        queryOne(`SELECT AVG(s.grade) as avg FROM submissions s JOIN assignments a ON s.assignment_id = a.id JOIN modules m ON a.module_id = m.id WHERE m.course_id = $1 AND s.grade IS NOT NULL`, [courseId]),
      ]);
      const studentRows = await query(`
        SELECT u.id AS student_id, u.name,
          ROUND(AVG(s.grade)::numeric, 1) AS avg_grade,
          COUNT(s.id) AS submission_count,
          COUNT(CASE WHEN a.due_date IS NOT NULL AND s.submitted_at::date > a.due_date::date THEN 1 END) AS late,
          (SELECT COUNT(*) FROM assignments a2 JOIN modules m2 ON a2.module_id = m2.id
           WHERE m2.course_id = $1 AND a2.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM submissions s2 WHERE s2.assignment_id = a2.id AND s2.student_id = u.id)
          ) AS missed
        FROM enrollments e
        JOIN users u ON e.student_id = u.id
        LEFT JOIN submissions s ON s.student_id = u.id
          AND EXISTS (SELECT 1 FROM assignments a JOIN modules m ON a.module_id = m.id WHERE a.id = s.assignment_id AND m.course_id = $1)
        LEFT JOIN assignments a ON a.id = s.assignment_id
        WHERE e.course_id = $1
        GROUP BY u.id, u.name ORDER BY u.name
      `, [courseId]);
      res.json({
        enrollments: parseInt(enrollmentCount?.count) || 0,
        averageGrade: Math.round(parseFloat(avgGradeRow?.avg) || 0),
        students: studentRows.map((r: any) => ({
          student_id: r.student_id, name: r.name,
          avg_grade: r.avg_grade != null ? parseFloat(r.avg_grade) : 0,
          submission_count: parseInt(r.submission_count) || 0,
          late: parseInt(r.late) || 0, missed: parseInt(r.missed) || 0,
        })),
        _source: 'live',
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/instructor/assignments",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(instructorAssignmentCreateSchema),
    async (req, res) => {
      try {
        const { module_id, title, description, due_date, max_points, rubric, status } = req.body;
        const result = await run(
          "INSERT INTO assignments (module_id,title,description,due_date,max_points,rubric,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [module_id, title, description, due_date, max_points, rubric, status]
        );
        if (status === 'active') {
          const enrolled = await query(
            `SELECT e.student_id FROM enrollments e
             JOIN modules m ON m.course_id = e.course_id
             WHERE m.id = $1`,
            [module_id]
          );
          for (const r of enrolled) {
            notify(pool, r.student_id, 'new_assignment',
              `New assignment posted: "${title}"`,
              { assignmentId: result.lastInsertId, moduleId: module_id }
            );
          }
        }
        res.json({ id: result.lastInsertId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── AI ────────────────────────────────────────────────────────────────────
  app.post("/api/ai/grade", requireAuth, aiGradeLimiter, async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const raw = await nimChat([
        { role: "system", content: 'You are a GRADING ASSISTANT. Respond ONLY with valid JSON. Shape: {"score":<int 0-100>,"feedback":"<2-3 sentences>","strengths":["..."],"improvements":["..."]}' },
        { role: "user",   content: `RUBRIC: ${rubric}\n\nSTUDENT SUBMISSION:\n${submissionContent?.slice(0, 3000)}` },
      ], { temperature: 0.3 });
      try { res.json(JSON.parse(raw.replace(/```json|```/g, "").trim())); }
      catch (_e) { res.json({ score: 75, feedback: raw, strengths: ["Reviewed"], improvements: ["See feedback"] }); }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post(
    "/api/ai/grade-pdf",
    requireAuth, requireRole("instructor", "admin"),
    aiGradeLimiter,
    validateBody(gradePdfSchema),
    async (req, res) => {
      try {
        const { submission_id, rubric, module_id } = req.body;
        const submission = await queryOne("SELECT * FROM submissions WHERE id=$1", [submission_id]);
        const files      = await query("SELECT * FROM submission_files WHERE submission_id=$1", [submission_id]);
        let fullText = submission?.content ?? "";
        for (const file of files) {
          if (file.storage_path) {
            const dl = await downloadFromStorage(SUBMISSIONS_BUCKET, file.storage_path);
            if (dl) {
              const ext     = path.extname(file.original_name ?? "").toLowerCase();
              const tmpPath = path.join(UPLOADS_DIR, `tmp-grade-${Date.now()}${ext}`);
              fs.writeFileSync(tmpPath, dl.buffer);
              try {
                const extracted = await extractText(tmpPath, file.file_type);
                if (extracted) fullText += "\n\n" + extracted;
              } finally {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
              }
            }
          }
        }
        if (!fullText.trim()) return res.status(400).json({ error: "No readable content found in submission" });
        let notesContext = "";
        if (module_id) {
          const relevantChunks = await retrieveChunks(module_id, fullText.slice(0, 500), 4);
          if (relevantChunks.length > 0)
            notesContext = `\n\nRELEVANT COURSE NOTES:\n${relevantChunks.join("\n\n---\n")}`;
        }
        const fallbackRubricRow = submission
          ? await queryOne("SELECT rubric FROM assignments WHERE id=(SELECT assignment_id FROM submissions WHERE id=$1)", [submission_id])
          : null;
        const effectiveRubric = rubric || fallbackRubricRow?.rubric || "Grade on overall quality, correctness, and clarity.";
        const raw = await nimChat([
          { role: "system", content: 'You are an expert university GRADING ASSISTANT. Respond ONLY with valid JSON — no markdown fences. Shape: {"score":<int 0-100>,"feedback":"<3-4 sentences>","strengths":["...","..."],"improvements":["...","..."],"rubric_breakdown":[{"criterion":"...","score":<int>,"comment":"..."}]}' },
          { role: "user",   content: `RUBRIC:\n${effectiveRubric}${notesContext}\n\nSTUDENT SUBMISSION (${files.length} file(s) + text):\n${fullText.slice(0, 4000)}` },
        ], { temperature: 0.3, maxTokens: 1200 });
        let result: any;
        try { result = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
        catch (_e) { result = { score: 75, feedback: raw, strengths: ["Reviewed"], improvements: ["See feedback"], rubric_breakdown: [] }; }
        await run(
          "UPDATE submissions SET ai_score=$1,ai_feedback=$2,ai_strengths=$3,ai_improvements=$4 WHERE id=$5",
          [result.score, result.feedback, JSON.stringify(result.strengths), JSON.stringify(result.improvements), submission_id]
        );
        res.json(result);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  app.post("/api/ai/chat", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { question, moduleTitle, moduleId, history = [] } = req.body;
      let notesContext = "No notes have been uploaded for this module yet.";
      if (moduleId) {
        try {
          const chunks = await retrieveChunks(moduleId, question, 5);
          if (chunks.length > 0) notesContext = chunks.join("\n\n---\n");
        } catch (embErr: any) {
          console.error("[chat] RAG retrieval failed:", embErr.message);
        }
      }
      const answer = await nimChat([
        {
          role: "system",
          content:
            `You are a helpful STUDY ASSISTANT for the module "${moduleTitle ?? "General"}".\n` +
            `Answer questions based on the course notes below.\n` +
            `If the answer is not covered in the notes, say so honestly but offer general guidance.\n` +
            `\n--- COURSE NOTES ---\n${notesContext}\n--- END NOTES ---`,
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ], { temperature: 0.4, maxTokens: 800 });
      res.json({ answer });
    } catch (e: any) {
      console.error("[/api/ai/chat] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/analytics-summary", requireAuth, reportLimiter, async (req, res) => {
    try {
      const { analytics } = req.body;
      if (!analytics) return res.status(400).json({ error: "analytics payload required" });
      const courseBreakdown = (analytics.courses ?? []).map((c: any) =>
        `${c.course_code} ${c.course_name}: avg ${
          c.avg_grade != null ? c.avg_grade + "%" : "no grades"
        }, ${c.assignments_submitted}/${c.assignments_total} submitted, ${c.late ?? 0} late`
      ).join("\n");
      const submissionRate =
        analytics.total_submitted + analytics.total_pending > 0
          ? Math.round((analytics.total_submitted / (analytics.total_submitted + analytics.total_pending)) * 100)
          : 0;
      const summary = await nimChat([
        { role: "system", content: "You are an academic advisor AI. Write a concise 3-4 sentence personalised academic summary. Be encouraging but honest. Plain text, no bullet points." },
        { role: "user",   content: `Student: ${analytics.student_name}\nOverall: ${analytics.overall_avg ?? "N/A"}%\nSubmission rate: ${submissionRate}%\nPending: ${analytics.total_pending}\n\n${courseBreakdown}` },
      ], { temperature: 0.4, maxTokens: 350 });
      res.json({ summary });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Static (production) ───────────────────────────────────────────────────
  if (isProduction) {
    const DIST_DIR = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(DIST_DIR));
    app.get("*", (_req, res) => res.sendFile(path.join(DIST_DIR, "index.html")));
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`\nLearnIT API  →  http://localhost:${PORT}  [${process.env.NODE_ENV ?? "development"}]  (PostgreSQL + Supabase Storage)`);
    if (!isProduction) console.log(`LearnIT App  →  http://localhost:5173  (Vite dev server)\n`);
    await checkStorageConnectivity();
    startCronJobs(pool);
  });
}

startServer();
