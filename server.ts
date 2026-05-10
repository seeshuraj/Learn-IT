import express, { Request, Response, NextFunction } from "express";
import pkg from "pg";
const { Pool } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "module";
import fs from "fs";
import dns from "dns";

// Force IPv4 DNS resolution (required on Render / hosts that resolve to IPv6)
dns.setDefaultResultOrder("ipv4first");

dotenv.config();

const require = createRequire(import.meta.url);
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = process.cwd();
const isProduction = process.env.NODE_ENV === "production";

// ─── PostgreSQL pool ──────────────────────────────────────────────────────
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

// Helper: run a query and return rows
async function query(sql: string, params: any[] = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
// Helper: run a query and return first row or null
async function queryOne(sql: string, params: any[] = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] ?? null;
}
// Helper: run INSERT/UPDATE/DELETE and return lastID for INSERTs
async function run(sql: string, params: any[] = []) {
  const { rows, rowCount } = await pool.query(sql, params);
  return { lastInsertId: rows[0]?.id ?? null, changes: rowCount ?? 0 };
}

// ─── Sanitize text for Postgres UTF8 ─────────────────────────────────────
function sanitizeText(text: string): string {
  return text
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\uFFFD/g, "");
}

// ─── Ensure user exists, upsert if missing ────────────────────────────────
// If the student_id from the session doesn't exist in the users table yet
// (e.g. seeded in a previous DB), insert a placeholder so FK constraints pass.
async function ensureUserExists(id: string | number): Promise<boolean> {
  const existing = await queryOne("SELECT id FROM users WHERE id=$1", [id]);
  if (existing) return true;
  // Upsert a minimal placeholder row so the FK is satisfied
  try {
    await run(
      `INSERT INTO users (id, name, email, role, active)
       VALUES ($1, 'Unknown User', 'unknown_' || $1 || '@learnitapp.local', 'student', 1)
       ON CONFLICT (id) DO NOTHING`,
      [id]
    );
    console.warn(`[ensureUserExists] Auto-created placeholder for missing user id=${id}`);
    return true;
  } catch (e) {
    console.error(`[ensureUserExists] Failed to upsert user id=${id}:`, e);
    return false;
  }
}

// ─── Upload directories ────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");
const NOTES_DIR = path.join(UPLOADS_DIR, "notes");
const SUBMISSIONS_DIR = path.join(UPLOADS_DIR, "submissions");
[UPLOADS_DIR, NOTES_DIR, SUBMISSIONS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Multer storage configs ────────────────────────────────────────────────
const notesStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, NOTES_DIR),
  filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});
const submissionStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, SUBMISSIONS_DIR),
  filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
});

const uploadNote = multer({ storage: notesStorage, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadSubmission = multer({ storage: submissionStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Text extraction helpers ───────────────────────────────────────────────
async function extractText(filePath: string, mimetype: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const buf = fs.readFileSync(filePath);
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

// ─── Chunking helper ───────────────────────────────────────────────────────
function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
    i += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 20);
}

// ─── Cosine similarity helper ─────────────────────────────────────────────
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// ─── AI helper (NVIDIA NIM) ────────────────────────────────────────────────
async function nimChat(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return "[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.";
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "mistralai/mistral-large-3-675b-instruct-2512",
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA NIM ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Embedding helper (NVIDIA NIM) ────────────────────────────────────────
async function nimEmbed(texts: string[]): Promise<number[][]> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return texts.map(() => Array.from({ length: 384 }, () => Math.random() - 0.5));
  const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "nvidia/nv-embedqa-e5-v5",
      input: texts,
      input_type: "passage",
      truncate: "END",
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA Embed ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return (data.data ?? []).map((d: any) => d.embedding as number[]);
}

// ─── RAG retrieval ────────────────────────────────────────────────────────
async function retrieveChunks(moduleId: string | number, queryText: string, topK = 5): Promise<string[]> {
  const chunks = await query(
    `SELECT nc.chunk_text, nc.embedding
     FROM note_chunks nc
     JOIN notes n ON nc.note_id = n.id
     WHERE n.module_id = $1`,
    [moduleId]
  );
  if (!chunks.length) return [];
  const [queryEmbed] = await nimEmbed([queryText]);
  const scored = chunks.map((c: any) => {
    const emb: number[] = JSON.parse(c.embedding ?? "[]");
    return { text: c.chunk_text, score: cosineSim(queryEmbed, emb) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.text);
}

async function startServer() {
  const app = express();

  // ─── CORS — manual middleware ────────────────────────────────────────────
  const ALLOWED_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app$/i;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    const allow = !origin || ALLOWED_RE.test(origin) ? (origin ?? "*") : "";
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin", allow);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  // ─── Health ───────────────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", db: "postgres", env: process.env.NODE_ENV, ts: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  app.post("/api/login", async (req, res) => {
    try {
      const { email } = req.body;
      const user = await queryOne("SELECT * FROM users WHERE email = $1 AND active = 1", [email]);
      if (user) res.json(user);
      else res.status(401).json({ error: "Invalid credentials" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── COURSES ──────────────────────────────────────────────────────────────
  app.get("/api/courses", async (_req, res) => {
    try {
      const rows = await query(`
        SELECT c.*, u.name as instructor_name,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrollment_count
        FROM courses c JOIN users u ON c.instructor_id = u.id
        WHERE c.archived = 0
      `);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/courses/:id/modules", async (req, res) => {
    try {
      res.json(await query("SELECT * FROM modules WHERE course_id = $1 ORDER BY display_order ASC", [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/courses/:id/modules", async (req, res) => {
    try {
      const { name, content } = req.body;
      const last = await queryOne("SELECT MAX(display_order) as maxorder FROM modules WHERE course_id = $1", [req.params.id]);
      const result = await run(
        "INSERT INTO modules (course_id, name, content, display_order) VALUES ($1,$2,$3,$4) RETURNING id",
        [req.params.id, name, content, (parseInt(last?.maxorder) || 0) + 1]
      );
      res.json({ id: result.lastInsertId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

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

  // ─── ASSIGNMENTS ──────────────────────────────────────────────────────────
  app.get("/api/modules/:id/assignments", async (req, res) => {
    try {
      const status = (req.query.status as string) || "active";
      res.json(await query("SELECT * FROM assignments WHERE module_id = $1 AND status = $2", [req.params.id, status]));
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

  // ─── SUBMISSIONS ──────────────────────────────────────────────────────────
  app.post("/api/submissions", async (req, res) => {
    try {
      const { assignment_id, student_id, content } = req.body;
      if (!assignment_id || !student_id) return res.status(400).json({ error: "assignment_id and student_id required" });
      await ensureUserExists(student_id);
      const existing = await queryOne("SELECT id FROM submissions WHERE assignment_id=$1 AND student_id=$2", [assignment_id, student_id]);
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
      if (!assignment_id || !student_id) return res.status(400).json({ error: "assignment_id and student_id required" });
      await ensureUserExists(student_id);
      const existing = await queryOne("SELECT id FROM submissions WHERE assignment_id=$1 AND student_id=$2", [assignment_id, student_id]);
      if (existing) return res.status(409).json({ error: "Already submitted" });
      const result = await run(
        "INSERT INTO submissions (assignment_id,student_id,content) VALUES ($1,$2,$3) RETURNING id",
        [assignment_id, student_id, sanitizeText(content)]
      );
      const submissionId = result.lastInsertId;
      const files: any[] = req.files ?? [];
      for (const file of files) {
        await run(
          "INSERT INTO submission_files (submission_id,filename,original_name,file_type,file_path) VALUES ($1,$2,$3,$4,$5)",
          [submissionId, file.filename, file.originalname, file.mimetype, file.path]
        );
      }
      res.json({ id: submissionId, files: files.map((f: any) => ({ filename: f.filename, original_name: f.originalname })) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/submissions/:id/files", async (req, res) => {
    try {
      const files = await query("SELECT id,filename,original_name,file_type,uploaded_at FROM submission_files WHERE submission_id=$1", [req.params.id]);
      res.json(files.map((f: any) => ({ ...f, url: `/uploads/submissions/${f.filename}` })));
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
      await run("UPDATE submissions SET grade=$1,feedback=$2 WHERE id=$3", [grade, feedback, req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── NOTES ────────────────────────────────────────────────────────────────
  app.get("/api/modules/:id/notes", async (req, res) => {
    try {
      const { student_id } = req.query;
      let notes;
      if (student_id) {
        notes = await query(`
          SELECT n.id,n.original_name,n.file_type,n.uploaded_at,n.module_id,
                 m.name as module_name,
                 (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
          FROM notes n JOIN modules m ON n.module_id = m.id
          WHERE n.module_id=$1 AND n.student_id=$2 ORDER BY n.uploaded_at DESC
        `, [req.params.id, student_id]);
      } else {
        notes = await query(`
          SELECT n.id,n.original_name,n.file_type,n.uploaded_at,n.module_id,
                 m.name as module_name,u.name as student_name,
                 (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
          FROM notes n JOIN modules m ON n.module_id = m.id
          JOIN users u ON n.student_id = u.id
          WHERE n.module_id=$1 ORDER BY n.uploaded_at DESC
        `, [req.params.id]);
      }
      res.json(notes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/modules/:id/notes", uploadNote.single("file"), async (req: any, res) => {
    try {
      const { student_id } = req.body;
      const file = req.file;
      if (!file || !student_id) return res.status(400).json({ error: "file and student_id required" });

      // ── Guard: ensure student exists in users table before FK insert ──
      await ensureUserExists(student_id);

      const text = await extractText(file.path, file.mimetype);
      const result = await run(
        "INSERT INTO notes (student_id,module_id,filename,original_name,file_path,content_text,file_type) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [student_id, req.params.id, file.filename, file.originalname, file.path, text, file.mimetype]
      );
      const noteId = result.lastInsertId;
      const chunks = chunkText(text);
      if (chunks.length > 0) {
        try {
          const embeddings = await nimEmbed(chunks);
          for (let i = 0; i < chunks.length; i++) {
            await run(
              "INSERT INTO note_chunks (note_id,chunk_index,chunk_text,embedding) VALUES ($1,$2,$3,$4)",
              [noteId, i, sanitizeText(chunks[i]), JSON.stringify(embeddings[i] ?? [])]
            );
          }
        } catch (_e) { console.error("Embedding error:", _e); }
      }
      res.json({ id: noteId, original_name: file.originalname, chunk_count: chunks.length, text_length: text.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const note = await queryOne("SELECT file_path FROM notes WHERE id=$1", [req.params.id]);
      if (note?.file_path && fs.existsSync(note.file_path)) fs.unlinkSync(note.file_path);
      await run("DELETE FROM note_chunks WHERE note_id=$1", [req.params.id]);
      await run("DELETE FROM notes WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/students/:id/notes", async (req, res) => {
    try {
      res.json(await query(`
        SELECT n.id,n.original_name,n.file_type,n.uploaded_at,n.module_id,
               m.name as module_name,c.name as course_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n
        JOIN modules m ON n.module_id = m.id
        JOIN courses c ON m.course_id = c.id
        WHERE n.student_id=$1 ORDER BY n.uploaded_at DESC
      `, [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── STUDENT ──────────────────────────────────────────────────────────────
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

  // ─── STUDENT ANALYTICS ────────────────────────────────────────────────────
  app.get("/api/students/:id/analytics", async (req, res) => {
    try {
      const studentId = req.params.id;
      const student = await queryOne("SELECT name FROM users WHERE id=$1", [studentId]);
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
          ? grades.reduce((sum: number, g: any) => sum + g.grade, 0) / grades.length
          : null;
        const lateRow = await queryOne(`
          SELECT COUNT(*) as count FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN modules m ON a.module_id = m.id
          WHERE s.student_id=$1 AND m.course_id=$2
            AND a.due_date IS NOT NULL AND s.submitted_at::date > a.due_date::date
        `, [studentId, course.id]);
        return {
          course_code: course.course_code,
          course_name: course.course_name,
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
      const totalSubmittedRow = await queryOne("SELECT COUNT(*) as count FROM submissions WHERE student_id=$1", [studentId]);

      res.json({
        student_name: student.name,
        overall_avg,
        total_submitted: parseInt(totalSubmittedRow?.count) || 0,
        total_pending: Math.max(0, (parseInt(totalAssignmentsRow?.count) || 0) - (parseInt(totalSubmittedRow?.count) || 0)),
        courses,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN ────────────────────────────────────────────────────────────────
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
      await run("DELETE FROM courses WHERE id=$1", [req.params.id]);
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
        activeUsers: parseInt(activeUsers?.count) || 0,
        totalCourses: parseInt(totalCourses?.count) || 0,
        averageGrade: Math.round(parseFloat(avgGrade?.avg) || 0),
        totalNotes: parseInt(totalNotes?.count) || 0,
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
      await run("INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [key, value]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN ENROLLMENT ─────────────────────────────────────────────────────
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
      if (!course_id || !Array.isArray(emails)) return res.status(400).json({ error: "course_id and emails[] required" });
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
            const r = await client.query("INSERT INTO users (name,email,role) VALUES ($1,$2,'student') ON CONFLICT DO NOTHING RETURNING id,name", [name, trimmed]);
            user = r.rows[0] ?? (await client.query("SELECT id,name FROM users WHERE email=$1", [trimmed])).rows[0];
          }
          const r = await client.query("INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id", [course_id, user.id]);
          results.push({ email: trimmed, student_id: user.id, enrolled: r.rows.length > 0 });
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── INSTRUCTOR ───────────────────────────────────────────────────────────
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
        queryOne("SELECT AVG(s.grade) as avg FROM submissions s JOIN assignments a ON s.assignment_id=a.id JOIN modules m ON a.module_id=m.id WHERE m.course_id=$1 AND s.grade IS NOT NULL", [req.params.id]),
      ]);
      res.json({ enrollments: parseInt(enrollmentCount?.count) || 0, averageGrade: Math.round(parseFloat(avgGrade?.avg) || 0) });
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

  // ─── AI ENDPOINTS ─────────────────────────────────────────────────────────
  app.post("/api/ai/grade", async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const raw = await nimChat([
        { role: "system", content: "You are a GRADING ASSISTANT. Respond ONLY with valid JSON. Shape: {\"score\":<int 0-100>,\"feedback\":\"<2-3 sentences>\",\"strengths\":[\"...\"],\"improvements\":[\"...\"]}" },
        { role: "user", content: `RUBRIC: ${rubric}\n\nSTUDENT SUBMISSION:\n${submissionContent?.slice(0, 3000)}` },
      ], { temperature: 0.3 });
      try {
        res.json(JSON.parse(raw.replace(/```json|```/g, "").trim()));
      } catch (_e) {
        res.json({ score: 75, feedback: raw, strengths: ["Reviewed"], improvements: ["See feedback"] });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ai/grade-pdf", async (req, res) => {
    try {
      const { submission_id, rubric, module_id } = req.body;
      if (!submission_id) return res.status(400).json({ error: "submission_id required" });
      const submission = await queryOne("SELECT * FROM submissions WHERE id=$1", [submission_id]);
      const files = await query("SELECT * FROM submission_files WHERE submission_id=$1", [submission_id]);
      let fullText = submission?.content ?? "";
      for (const file of files) {
        const extracted = await extractText(file.file_path, file.file_type);
        if (extracted) fullText += "\n\n" + extracted;
      }
      if (!fullText.trim()) return res.status(400).json({ error: "No readable content found in submission" });
      let notesContext = "";
      if (module_id) {
        const relevantChunks = await retrieveChunks(module_id, fullText.slice(0, 500), 4);
        if (relevantChunks.length > 0) notesContext = `\n\nRELEVANT COURSE NOTES:\n${relevantChunks.join("\n\n---\n")}`;
      }
      const fallbackRubricRow = submission
        ? await queryOne("SELECT rubric FROM assignments WHERE id=(SELECT assignment_id FROM submissions WHERE id=$1)", [submission_id])
        : null;
      const effectiveRubric = rubric || fallbackRubricRow?.rubric || "Grade on overall quality, correctness, and clarity.";
      const raw = await nimChat([
        { role: "system", content: "You are an expert university GRADING ASSISTANT. Respond ONLY with valid JSON — no markdown fences, no extra text. Shape: {\"score\":<int 0-100>,\"feedback\":\"<3-4 sentences>\",\"strengths\":[\"...\",\"...\"],\"improvements\":[\"...\",\"...\"],\"rubric_breakdown\":[{\"criterion\":\"...\",\"score\":<int>,\"comment\":\"...\"}]}" },
        { role: "user", content: `RUBRIC:\n${effectiveRubric}${notesContext}\n\nSTUDENT SUBMISSION (${files.length} file(s) + text):\n${fullText.slice(0, 4000)}` },
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
      let notesContext = "No notes uploaded for this module yet.";
      if (moduleId) {
        const chunks = await retrieveChunks(moduleId, question, 5);
        if (chunks.length > 0) notesContext = chunks.join("\n\n---\n");
      }
      const answer = await nimChat([
        { role: "system", content: `You are a NOTES ASSISTANT for the module "${moduleTitle ?? "General"}". Answer ONLY from the course notes below. If the answer is not in the notes, say so honestly.\n\n--- COURSE NOTES ---\n${notesContext}\n--- END NOTES ---` },
        ...history.slice(-6),
        { role: "user", content: question },
      ], { temperature: 0.4, maxTokens: 800 });
      res.json({ answer });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ai/analytics-summary", async (req, res) => {
    try {
      const { analytics } = req.body;
      if (!analytics) return res.status(400).json({ error: "analytics payload required" });
      const courseBreakdown = (analytics.courses ?? []).map((c: any) =>
        `${c.course_code} ${c.course_name}: avg ${c.avg_grade != null ? c.avg_grade + "%" : "no grades"}, ${c.assignments_submitted}/${c.assignments_total} submitted, ${c.late ?? 0} late`
      ).join("\n");
      const submissionRate = analytics.total_submitted + analytics.total_pending > 0
        ? Math.round((analytics.total_submitted / (analytics.total_submitted + analytics.total_pending)) * 100) : 0;
      const summary = await nimChat([
        { role: "system", content: "You are an academic advisor AI. Write a concise 3-4 sentence personalised academic summary. Be encouraging but honest. Plain text, no bullet points." },
        { role: "user", content: `Student: ${analytics.student_name}\nOverall: ${analytics.overall_avg ?? "N/A"}%\nSubmission rate: ${submissionRate}%\nPending: ${analytics.total_pending}\n\n${courseBreakdown}` },
      ], { temperature: 0.4, maxTokens: 350 });
      res.json({ summary });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Production static ─────────────────────────────────────────────────────
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
