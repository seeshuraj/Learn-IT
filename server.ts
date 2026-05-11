import express, { Request, Response, NextFunction } from "express";
import pkg from "pg";
const { Pool } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "module";
import fs from "fs";
import dns from "dns";
import { v2 as cloudinary } from "cloudinary";

dns.setDefaultResultOrder("ipv4first");
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const hasCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
if (hasCloudinary) console.log("[Cloudinary] configured ✓");
else console.warn("[Cloudinary] env vars missing — files stored locally only");

const require = createRequire(import.meta.url);
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const PROJECT_ROOT = process.cwd();
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

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

// ── Cloudinary helpers ────────────────────────────────────────────────────

/**
 * Upload a local file to Cloudinary as a raw resource.
 *
 * KEY RULE for raw resources:
 *   Pass public_id WITHOUT the file extension and supply the extension
 *   separately as `format`. Cloudinary then stores the resource under
 *   the base public_id (e.g. "learnit/notes/1-1234567890") and appends
 *   the format internally.  The secure_url it returns will contain the
 *   full filename (base + "." + format) in the path, but the canonical
 *   public_id used for signing/deletion is the BASE only.
 *
 * @param localPath  Absolute path to the temp file on disk
 * @param folder     Cloudinary folder (e.g. "learnit/notes")
 * @param baseName   Filename WITHOUT extension (e.g. "1-1234567890")
 * @param ext        Extension WITHOUT leading dot (e.g. "pdf")
 */
async function uploadToCloudinary(
  localPath: string,
  folder: string,
  baseName: string,
  ext: string
): Promise<string | null> {
  if (!hasCloudinary) return null;
  try {
    const result = await cloudinary.uploader.upload(localPath, {
      folder,
      public_id: baseName,   // NO extension here
      format:    ext,        // extension passed separately
      resource_type: "raw",
      overwrite: true,
    });
    console.log(`[Cloudinary] uploaded → ${result.public_id} (format=${ext})  url=${result.secure_url}`);
    return result.secure_url;
  } catch (e) {
    console.error("[Cloudinary] upload error:", e);
    return null;
  }
}

/**
 * Extract the BASE public_id (no extension) from a Cloudinary secure_url.
 *
 * Cloudinary raw secure_urls look like:
 *   https://res.cloudinary.com/<cloud>/raw/upload/v<ver>/<folder>/<base>.<ext>
 *
 * The canonical public_id stored by Cloudinary is "<folder>/<base>" — no ext.
 * We strip the extension here so every downstream call (sign, delete) uses
 * the correct key.
 */
function publicIdFromUrl(url: string): string {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!m) return "";
  const full = m[1];                    // e.g. "learnit/notes/1-1234567890.pdf"
  const dot  = full.lastIndexOf(".");
  return dot !== -1 ? full.slice(0, dot) : full;  // strip extension
}

async function deleteFromCloudinary(publicId: string): Promise<void> {
  if (!hasCloudinary || !publicId) return;
  try {
    // publicId here is already the base (no extension) thanks to publicIdFromUrl
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
    console.log(`[Cloudinary] deleted ${publicId}`);
  } catch (e) {
    console.error("[Cloudinary] delete error:", e);
  }
}

/**
 * Generate a short-lived signed download URL for a Cloudinary raw resource.
 *
 * Uses private_download_url(base, format) — which is correct because:
 *  - base   = public_id WITHOUT extension (matches what Cloudinary stored)
 *  - format = file extension tells Cloudinary which format to serve
 *
 * This is the intended Cloudinary SDK API for raw signed downloads.
 *
 * @param publicId    Base public_id WITHOUT extension (e.g. "learnit/notes/1-xxx")
 * @param format      File extension without dot (e.g. "pdf")
 * @param expiresInSec  TTL in seconds (default 120)
 */
function signedDownloadUrl(publicId: string, format: string, expiresInSec = 120): string {
  const url = cloudinary.utils.private_download_url(publicId, format, {
    resource_type: "raw",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
  });
  console.log(`[signedDownloadUrl] public_id=${publicId}  format=${format}  url=${url}`);
  return url;
}

// ── File system dirs ──────────────────────────────────────────────────────

const UPLOADS_DIR     = path.join(PROJECT_ROOT, "uploads");
const NOTES_DIR       = path.join(UPLOADS_DIR, "notes");
const SUBMISSIONS_DIR = path.join(UPLOADS_DIR, "submissions");
[UPLOADS_DIR, NOTES_DIR, SUBMISSIONS_DIR].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

// ── Multer storage ────────────────────────────────────────────────────────

const memStorage = multer.memoryStorage();
const diskNotesStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, NOTES_DIR),
  filename: (_req: any, file: any, cb: any) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});
const diskSubmissionStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, SUBMISSIONS_DIR),
  filename: (_req: any, file: any, cb: any) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});

const uploadNote = multer({
  storage: hasCloudinary ? memStorage : diskNotesStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
const uploadSubmission = multer({
  storage: hasCloudinary ? memStorage : diskSubmissionStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Text extraction ───────────────────────────────────────────────────────

async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string
): Promise<string> {
  const ext     = path.extname(originalname).toLowerCase();
  const tmpPath = path.join(UPLOADS_DIR, `tmp-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    return await extractText(tmpPath, mimetype);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
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
    console.error("Text extraction error:", e);
    return "";
  }
}

// ── RAG helpers ───────────────────────────────────────────────────────────

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

// ── Network helpers ───────────────────────────────────────────────────────

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

// ── NVIDIA NIM ────────────────────────────────────────────────────────────

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

// ── Express app ───────────────────────────────────────────────────────────

async function startServer() {
  const app = express();

  const ALLOWED_RE =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    const allow  = !origin || ALLOWED_RE.test(origin) ? (origin ?? "*") : "";
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin",   allow);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods",  "GET,POST,PUT,DELETE,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers",  "Content-Type,Authorization,X-Requested-With");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  // ── Health ────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "ok", db: "postgres",
        env: process.env.NODE_ENV, cloudinary: hasCloudinary,
        ts: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ status: "error", message: e.message }); }
  });

  // ── PDF PROXY ─────────────────────────────────────────────────────────
  app.get("/api/notes/:id/proxy", async (req, res) => {
    try {
      const note = await queryOne(
        "SELECT cloudinary_url, file_type, original_name, file_path FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });

      const contentType = note.file_type || "application/octet-stream";
      const disposition = `inline; filename="${encodeURIComponent(note.original_name ?? "file")}"`;

      if (note.cloudinary_url && hasCloudinary) {
        // publicIdFromUrl strips the extension → base public_id only
        const pubId  = publicIdFromUrl(note.cloudinary_url);
        // derive format from the stored URL extension
        const urlExt = note.cloudinary_url.split(".").pop()?.toLowerCase() ?? "pdf";
        const signedUrl = signedDownloadUrl(pubId, urlExt, 120);
        console.log(`[proxy] public_id=${pubId}  format=${urlExt}`);

        const upstream = await fetchWithTimeout(signedUrl, {}, 30000);
        if (!upstream.ok) {
          const body = await upstream.text();
          console.error(`[proxy] Cloudinary ${upstream.status}:`, body);
          return res.status(502).json({
            error: `Cloudinary returned ${upstream.status}`,
            detail: body.slice(0, 300),
          });
        }

        res.setHeader("Content-Type",        contentType);
        res.setHeader("Content-Disposition", disposition);
        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.send(buf);
      }

      // Local disk fallback
      if (note.file_path && fs.existsSync(note.file_path)) {
        res.setHeader("Content-Type",        contentType);
        res.setHeader("Content-Disposition", disposition);
        return res.sendFile(path.resolve(note.file_path));
      }

      res.status(404).json({ error: "File not found on disk or cloud" });
    } catch (e: any) {
      console.error("[proxy] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Auth ───────────────────────────────────────────────────────────────
  app.post("/api/login", async (req, res) => {
    try {
      const { email } = req.body;
      const user = await queryOne(
        "SELECT * FROM users WHERE email = $1 AND active = 1", [email]
      );
      if (user) res.json(user);
      else res.status(401).json({ error: "Invalid credentials" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Courses ────────────────────────────────────────────────────────────
  app.get("/api/courses", async (_req, res) => {
    try {
      res.json(await query(`
        SELECT c.*, u.name as instructor_name,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrollment_count
        FROM courses c JOIN users u ON c.instructor_id = u.id
        WHERE c.archived = 0
      `));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/courses/:id/modules", async (req, res) => {
    try {
      res.json(await query(
        "SELECT * FROM modules WHERE course_id = $1 ORDER BY display_order ASC",
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/courses/:id/modules", async (req, res) => {
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
  });

  // ── Materials ──────────────────────────────────────────────────────────
  app.get("/api/modules/:id/materials", async (req, res) => {
    try {
      res.json(await query("SELECT * FROM materials WHERE module_id = $1", [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/materials", async (req, res) => {
    try {
      const { title, type, size } = req.body;
      const result = await run(
        "INSERT INTO materials (module_id, title, type, url, size) VALUES ($1,$2,$3,'#',$4) RETURNING id",
        [req.params.id, title, type, size]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Assignments ────────────────────────────────────────────────────────
  app.get("/api/modules/:id/assignments", async (req, res) => {
    try {
      const status = (req.query.status as string) || "active";
      res.json(await query(
        "SELECT * FROM assignments WHERE module_id = $1 AND status = $2",
        [req.params.id, status]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/assignments", async (req, res) => {
    try {
      const { title, description, due_date, max_points = 100, rubric = "", status = "active" } = req.body;
      if (!title || !due_date) return res.status(400).json({ error: "title and due_date required" });
      const result = await run(
        "INSERT INTO assignments (module_id,title,description,due_date,max_points,rubric,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [req.params.id, title, description, due_date, max_points, rubric, status]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/assignments/:id", async (req, res) => {
    try {
      const { title, description, due_date, max_points, rubric, status } = req.body;
      await run(
        "UPDATE assignments SET title=$1,description=$2,due_date=$3,max_points=$4,rubric=$5,status=$6 WHERE id=$7",
        [title, description, due_date, max_points, rubric, status, req.params.id]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/assignments/:id", async (req, res) => {
    try {
      await run("UPDATE assignments SET status='archived' WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Submissions ────────────────────────────────────────────────────────
  app.post("/api/submissions", async (req, res) => {
    try {
      const { assignment_id, student_id, content } = req.body;
      if (!assignment_id || !student_id)
        return res.status(400).json({ error: "assignment_id and student_id required" });
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
  });

  app.post("/api/submissions/upload", uploadSubmission.array("files", 5), async (req: any, res) => {
    try {
      const { assignment_id, student_id, content = "" } = req.body;
      if (!assignment_id || !student_id)
        return res.status(400).json({ error: "assignment_id and student_id required" });
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
        let fileUrl = "";
        if (hasCloudinary && file.buffer) {
          const extWithDot = path.extname(file.originalname).toLowerCase(); // e.g. ".pdf"
          const ext        = extWithDot.replace(".", "");                   // e.g. "pdf"
          const baseName   = `${submissionId}-${Date.now()}`;               // NO extension
          const tmpPath    = path.join(UPLOADS_DIR, `tmp-${Date.now()}${extWithDot}`);
          fs.writeFileSync(tmpPath, file.buffer);
          const url = await uploadToCloudinary(tmpPath, "learnit/submissions", baseName, ext);
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          fileUrl = url ?? "";
        } else if (file.path) {
          fileUrl = `/uploads/submissions/${file.filename}`;
        }
        await run(
          "INSERT INTO submission_files (submission_id,filename,original_name,file_type,file_path,cloudinary_url) VALUES ($1,$2,$3,$4,$5,$6)",
          [submissionId, file.filename ?? file.originalname, file.originalname, file.mimetype, fileUrl, fileUrl]
        );
        savedFiles.push({ filename: file.filename ?? file.originalname, original_name: file.originalname, url: fileUrl });
      }
      res.json({ id: submissionId, files: savedFiles });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/submissions/:id/files", async (req, res) => {
    try {
      const files = await query(
        "SELECT id,filename,original_name,file_type,uploaded_at,cloudinary_url FROM submission_files WHERE submission_id=$1",
        [req.params.id]
      );
      res.json(files.map((f: any) => ({
        ...f,
        url: f.cloudinary_url || `/uploads/submissions/${f.filename}`,
      })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/submissions", async (_req, res) => {
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

  app.post("/api/submissions/:id/grade", async (req, res) => {
    try {
      const { grade, feedback } = req.body;
      await run(
        "UPDATE submissions SET grade=$1,feedback=$2 WHERE id=$3",
        [grade, feedback, req.params.id]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Notes ──────────────────────────────────────────────────────────────
  app.post("/api/modules/:id/notes", uploadNote.single("file"), async (req: any, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "file required" });

      let text          = "";
      let cloudinaryUrl = "";

      if (hasCloudinary && file.buffer) {
        text = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);
        const extWithDot = path.extname(file.originalname).toLowerCase(); // e.g. ".pdf"
        const ext        = extWithDot.replace(".", "");                   // e.g. "pdf"
        const baseName   = `${req.params.id}-${Date.now()}`;              // NO extension
        const tmpPath    = path.join(UPLOADS_DIR, `tmp-note-${Date.now()}${extWithDot}`);
        fs.writeFileSync(tmpPath, file.buffer);
        const url = await uploadToCloudinary(tmpPath, "learnit/notes", baseName, ext);
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        cloudinaryUrl = url ?? "";
      } else {
        text = await extractText(file.path, file.mimetype);
      }

      const localFilename = file.filename ??
        file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const result = await run(
        `INSERT INTO notes
           (student_id, module_id, filename, original_name, file_path,
            content_text, file_type, cloudinary_url)
         VALUES (NULL,$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          req.params.id, localFilename, file.originalname,
          cloudinaryUrl || (file.path ?? ""),
          text, file.mimetype, cloudinaryUrl,
        ]
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
          console.error("[notes] embedding error:", embErr);
        }
      }

      res.json({
        id: noteId,
        original_name:  file.originalname,
        chunk_count:    chunks.length,
        text_length:    text.length,
        cloudinary_url: cloudinaryUrl || null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/modules/:id/notes", async (req, res) => {
    try {
      res.json(await query(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               n.cloudinary_url,
               m.name as module_name, c.name as course_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n
        JOIN modules m ON n.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        WHERE n.module_id = $1 AND n.student_id IS NULL
        ORDER BY n.uploaded_at DESC
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const note = await queryOne(
        "SELECT file_path, cloudinary_url FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (note?.cloudinary_url) {
        await deleteFromCloudinary(publicIdFromUrl(note.cloudinary_url));
      } else if (note?.file_path && fs.existsSync(note.file_path)) {
        fs.unlinkSync(note.file_path);
      }
      await run("DELETE FROM note_chunks WHERE note_id=$1", [req.params.id]);
      await run("DELETE FROM notes WHERE id=$1",            [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/notes", async (req, res) => {
    try {
      res.json(await query(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               n.cloudinary_url,
               m.name as module_name, c.name as course_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n
        JOIN modules m ON n.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        JOIN enrollments e ON e.course_id = c.id
        WHERE e.student_id = $1
          AND n.student_id IS NULL
          AND c.archived = 0
        ORDER BY n.uploaded_at DESC
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Student routes ─────────────────────────────────────────────────────
  app.get("/api/student/:id/courses", async (req, res) => {
    try {
      res.json(await query(`
        SELECT c.*, u.name as instructor_name
        FROM courses c JOIN enrollments e ON c.id = e.course_id
        JOIN users u ON c.instructor_id = u.id
        WHERE e.student_id=$1 AND c.archived=0
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/student/:id/assignments", async (req, res) => {
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

  app.get("/api/student/:id/stats", async (req, res) => {
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

  app.get("/api/students/:id/analytics", async (req, res) => {
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
          course_code:           course.course_code,
          course_name:           course.course_name,
          assignments_total:     parseInt(totalRow?.count) || 0,
          assignments_submitted: grades.length,
          avg_grade:             avg != null ? Math.round(avg * 10) / 10 : null,
          late:                  parseInt(lateRow?.count) || 0,
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

  // ── Admin ──────────────────────────────────────────────────────────────
  app.get("/api/admin/users", async (_req, res) => {
    try {
      res.json(await query("SELECT id,name,email,role,active,year,major,gpa FROM users ORDER BY role,name"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const { name, email, role, major, year } = req.body;
      const result = await run(
        "INSERT INTO users (name,email,role,major,year) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [name, email, role, major, year]
      );
      res.json({ id: result.lastInsertId });
    } catch (_e) { res.status(400).json({ error: "Email already exists" }); }
  });

  app.put("/api/admin/users/:id", async (req, res) => {
    try {
      const { name, email, role, active, major, year } = req.body;
      await run(
        "UPDATE users SET name=$1,email=$2,role=$3,active=$4,major=$5,year=$6 WHERE id=$7",
        [name, email, role, active, major, year, req.params.id]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/courses", async (req, res) => {
    try {
      const { code, name, instructor_id } = req.body;
      const result = await run(
        "INSERT INTO courses (code,name,instructor_id) VALUES ($1,$2,$3) RETURNING id",
        [code, name, instructor_id]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/admin/courses/:id", async (req, res) => {
    try {
      await run("DELETE FROM enrollments WHERE course_id=$1", [req.params.id]);
      await run("DELETE FROM courses WHERE id=$1",            [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/stats", async (_req, res) => {
    try {
      const [activeUsers, totalCourses, avgGrade, totalNotes, totalSubmissions] = await Promise.all([
        queryOne("SELECT COUNT(*) as count FROM users WHERE active=1"),
        queryOne("SELECT COUNT(*) as count FROM courses WHERE archived=0"),
        queryOne("SELECT AVG(grade) as avg FROM submissions WHERE grade IS NOT NULL"),
        queryOne("SELECT COUNT(*) as count FROM notes"),
        queryOne("SELECT COUNT(*) as count FROM submissions"),
      ]);
      res.json({
        activeUsers:      parseInt(activeUsers?.count)   || 0,
        totalCourses:     parseInt(totalCourses?.count)  || 0,
        averageGrade:     Math.round(parseFloat(avgGrade?.avg) || 0),
        totalNotes:       parseInt(totalNotes?.count)    || 0,
        totalSubmissions: parseInt(totalSubmissions?.count) || 0,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/settings", async (_req, res) => {
    try {
      res.json(await query("SELECT * FROM settings"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/settings", async (req, res) => {
    try {
      const { key, value } = req.body;
      await run(
        "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
        [key, value]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/enrollments/:courseId", async (req, res) => {
    try {
      res.json(await query(`
        SELECT e.id,e.enrolled_at,u.id as student_id,u.name,u.email,u.year,u.major
        FROM enrollments e JOIN users u ON e.student_id=u.id
        WHERE e.course_id=$1 ORDER BY u.name
      `, [req.params.courseId]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/enrollments", async (req, res) => {
    try {
      const { course_id, student_id } = req.body;
      const result = await run(
        "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [course_id, student_id]
      );
      if (!result.lastInsertId) return res.status(409).json({ error: "Already enrolled" });
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/admin/enrollments/:id", async (req, res) => {
    try {
      await run("DELETE FROM enrollments WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/bulk-enroll", async (req, res) => {
    try {
      const { course_id, emails } = req.body as { course_id: number; emails: string[] };
      if (!course_id || !Array.isArray(emails))
        return res.status(400).json({ error: "course_id and emails[] required" });
      const results: any[] = [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const email of emails) {
          const trimmed = email.trim().toLowerCase();
          if (!trimmed) continue;
          let user = (await client.query("SELECT id,name FROM users WHERE email=$1", [trimmed])).rows[0];
          if (!user) {
            const name = trimmed.split("@")[0].replace(/[._]/g, " ");
            const r = await client.query(
              "INSERT INTO users (name,email,role) VALUES ($1,$2,'student') ON CONFLICT DO NOTHING RETURNING id,name",
              [name, trimmed]
            );
            user = r.rows[0] ?? (await client.query("SELECT id,name FROM users WHERE email=$1", [trimmed])).rows[0];
          }
          const r = await client.query(
            "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id",
            [course_id, user.id]
          );
          results.push({ email: trimmed, student_id: user.id, enrolled: r.rows.length > 0 });
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Instructor ─────────────────────────────────────────────────────────
  app.get("/api/instructor/:id/courses", async (req, res) => {
    try {
      res.json(await query(`
        SELECT c.*,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) as enrollment_count,
          (SELECT COUNT(*) FROM modules m WHERE m.course_id=c.id) as module_count
        FROM courses c WHERE c.instructor_id=$1 AND c.archived=0
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/instructor/courses/:id/analytics", async (req, res) => {
    try {
      const [enrollmentCount, avgGrade] = await Promise.all([
        queryOne("SELECT COUNT(*) as count FROM enrollments WHERE course_id=$1", [req.params.id]),
        queryOne(
          "SELECT AVG(s.grade) as avg FROM submissions s JOIN assignments a ON s.assignment_id=a.id JOIN modules m ON a.module_id=m.id WHERE m.course_id=$1 AND s.grade IS NOT NULL",
          [req.params.id]
        ),
      ]);
      res.json({
        enrollments:  parseInt(enrollmentCount?.count) || 0,
        averageGrade: Math.round(parseFloat(avgGrade?.avg) || 0),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/instructor/assignments", async (req, res) => {
    try {
      const { module_id, title, description, due_date, max_points = 100, rubric = "", status = "active" } = req.body;
      const result = await run(
        "INSERT INTO assignments (module_id,title,description,due_date,max_points,rubric,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [module_id, title, description, due_date, max_points, rubric, status]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── AI ─────────────────────────────────────────────────────────────────
  app.post("/api/ai/grade", async (req, res) => {
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

  app.post("/api/ai/grade-pdf", async (req, res) => {
    try {
      const { submission_id, rubric, module_id } = req.body;
      if (!submission_id) return res.status(400).json({ error: "submission_id required" });
      const submission = await queryOne("SELECT * FROM submissions WHERE id=$1", [submission_id]);
      const files      = await query("SELECT * FROM submission_files WHERE submission_id=$1", [submission_id]);
      let fullText = submission?.content ?? "";
      for (const file of files) {
        if (file.file_path && fs.existsSync(file.file_path)) {
          const extracted = await extractText(file.file_path, file.file_type);
          if (extracted) fullText += "\n\n" + extracted;
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
        ? await queryOne(
            "SELECT rubric FROM assignments WHERE id=(SELECT assignment_id FROM submissions WHERE id=$1)",
            [submission_id]
          )
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
  });

  app.post("/api/ai/chat", async (req, res) => {
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

  app.post("/api/ai/analytics-summary", async (req, res) => {
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

  // ── Static (production) ────────────────────────────────────────────────
  if (isProduction) {
    const DIST_DIR = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(DIST_DIR));
    app.get("*", (_req, res) => res.sendFile(path.join(DIST_DIR, "index.html")));
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\nLearnIT API  →  http://localhost:${PORT}  [${process.env.NODE_ENV ?? "development"}]  (PostgreSQL)`);
    if (!isProduction) console.log(`LearnIT App  →  http://localhost:5173  (Vite dev server)\n`);
  });
}

startServer();
