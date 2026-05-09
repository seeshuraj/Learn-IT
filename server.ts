import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "module";
import fs from "fs";

dotenv.config();

const require = createRequire(import.meta.url);
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

// ─── Upload directories ────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
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

// ─── Database ──────────────────────────────────────────────────────────────
const db = new Database("learnit.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT DEFAULT 'password',
    role TEXT,
    active INTEGER DEFAULT 1,
    year INTEGER,
    gpa REAL,
    major TEXT
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    instructor_id INTEGER,
    archived INTEGER DEFAULT 0,
    FOREIGN KEY(instructor_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER,
    student_id INTEGER,
    enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, student_id),
    FOREIGN KEY(course_id) REFERENCES courses(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER,
    name TEXT,
    content TEXT,
    display_order INTEGER DEFAULT 0,
    FOREIGN KEY(course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER,
    title TEXT,
    type TEXT,
    url TEXT,
    size TEXT,
    FOREIGN KEY(module_id) REFERENCES modules(id)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER,
    title TEXT,
    description TEXT,
    due_date TEXT,
    max_points INTEGER DEFAULT 100,
    rubric TEXT,
    status TEXT DEFAULT 'active',
    FOREIGN KEY(module_id) REFERENCES modules(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER,
    student_id INTEGER,
    content TEXT,
    grade INTEGER,
    feedback TEXT,
    ai_score INTEGER,
    ai_feedback TEXT,
    ai_strengths TEXT,
    ai_improvements TEXT,
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assignment_id) REFERENCES assignments(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS submission_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER,
    filename TEXT,
    original_name TEXT,
    file_type TEXT,
    file_path TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(submission_id) REFERENCES submissions(id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    module_id INTEGER,
    filename TEXT,
    original_name TEXT,
    file_path TEXT,
    content_text TEXT,
    file_type TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES users(id),
    FOREIGN KEY(module_id) REFERENCES modules(id)
  );

  CREATE TABLE IF NOT EXISTS note_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER,
    chunk_index INTEGER,
    chunk_text TEXT,
    embedding TEXT,
    FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Seed ──────────────────────────────────────────────────────────────────
const seed = () => {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = db.prepare("INSERT INTO users (name, email, role, year, gpa, major) VALUES (?, ?, ?, ?, ?, ?)");
    insertUser.run("Admin User", "admin@learnit.edu", "admin", null, null, null);
    insertUser.run("Sarah Johnson", "sarah@learnit.edu", "student", 3, 3.7, "Computer Science");
    insertUser.run("Michael Chen", "michael@learnit.edu", "student", 2, 3.4, "Data Science");
    insertUser.run("Dr. Aris", "instructor@learnit.edu", "instructor", null, null, "AI & Machine Learning");

    const insertCourse = db.prepare("INSERT INTO courses (code, name, instructor_id) VALUES (?, ?, ?)");
    insertCourse.run("CS4510", "Advanced AI", 4);
    insertCourse.run("CS3200", "Database Systems", 4);
    insertCourse.run("CS3000", "Algorithms", 4);

    const insertEnrollment = db.prepare("INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)");
    insertEnrollment.run(1, 2); insertEnrollment.run(2, 2);
    insertEnrollment.run(3, 2); insertEnrollment.run(1, 3);

    const insertModule = db.prepare("INSERT INTO modules (course_id, name, content, display_order) VALUES (?, ?, ?, ?)");
    insertModule.run(1, "Neural Networks", "Backpropagation is the central algorithm in training neural networks. It uses the chain rule to compute gradients of the loss function with respect to weights.", 1);
    insertModule.run(1, "Deep Learning", "Deep learning involves multiple layers of neural networks to extract high-level features from raw input.", 2);
    insertModule.run(2, "SQL Basics", "SQL stands for Structured Query Language. It is used to manage and manipulate relational databases.", 1);
    insertModule.run(3, "Sorting Algorithms", "QuickSort and MergeSort are efficient O(n log n) sorting algorithms.", 1);

    const insertMaterial = db.prepare("INSERT INTO materials (module_id, title, type, url, size) VALUES (?, ?, ?, ?, ?)");
    insertMaterial.run(1, "Lecture Notes.pdf", "pdf", "#", "2.4 MB");
    insertMaterial.run(1, "Module Overview.mp4", "video", "#", "15:20");
    insertMaterial.run(3, "SQL Cheat Sheet.pdf", "pdf", "#", "1.1 MB");

    const insertAssignment = db.prepare("INSERT INTO assignments (module_id, title, description, due_date, max_points, rubric, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
    insertAssignment.run(1, "ML Project", "Implement a simple neural network from scratch using Python and NumPy. Show forward pass, backward pass, and training loop.", "2026-06-15", 100, "Correctness (40%), Code quality (30%), Explanation (30%)", "active");
    insertAssignment.run(3, "Database Design", "Design a normalised schema for a library management system. Include ER diagram and SQL DDL.", "2026-06-10", 100, "Normalisation (40%), SQL syntax (30%), ER diagram (30%)", "active");
    insertAssignment.run(4, "Algorithm Report", "Compare QuickSort and MergeSort: time complexity, space complexity, best/worst/average cases with benchmarks.", "2026-06-20", 100, "Analysis (50%), Benchmarks (30%), Writing quality (20%)", "active");

    const insertSubmission = db.prepare("INSERT INTO submissions (assignment_id, student_id, content, grade, feedback) VALUES (?, ?, ?, ?, ?)");
    insertSubmission.run(2, 2, "My database design for a library system with proper normalisation to 3NF...", 87, "Great work on the normalisation. The ER diagram is clear.");

    const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    insertSetting.run("file_size_limit", "20MB");
    insertSetting.run("ai_enabled", "true");
    insertSetting.run("allowed_file_types", "pdf,docx,doc,jpg,jpeg,png,txt");
  }
};
seed();

// ─── Text extraction helpers ───────────────────────────────────────────────
async function extractText(filePath: string, mimetype: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return data.text ?? "";
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value ?? "";
    }
    if (ext === ".txt" || mimetype === "text/plain") {
      return fs.readFileSync(filePath, "utf-8");
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

// ─── AI helper (NVIDIA NIM — OpenAI-compatible) ────────────────────────────
async function nimChat(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    return "[Mock AI] Set NVIDIA_API_KEY in .env to enable real AI responses.";
  }
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
  if (!key) {
    return texts.map(() => Array.from({ length: 384 }, () => Math.random() - 0.5));
  }
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

// ─── RAG retrieval: fetch top-k chunks for a query in a module ────────────
async function retrieveChunks(moduleId: string | number, query: string, topK = 5): Promise<string[]> {
  const chunks = db.prepare(
    `SELECT nc.chunk_text, nc.embedding
     FROM note_chunks nc
     JOIN notes n ON nc.note_id = n.id
     WHERE n.module_id = ?`
  ).all(moduleId) as any[];

  if (!chunks.length) return [];

  const [queryEmbed] = await nimEmbed([query]);
  const scored = chunks.map((c: any) => {
    const emb: number[] = JSON.parse(c.embedding ?? "[]");
    return { text: c.chunk_text, score: cosineSim(queryEmbed, emb) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.text);
}

async function startServer() {
  const app = express();

  // ─── CORS ────────────────────────────────────────────────────────────────
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
  ];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_DIR));

  // ─── Health ───────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV, ts: new Date().toISOString() });
  });

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  app.post("/api/login", (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
    if (user) res.json(user);
    else res.status(401).json({ error: "Invalid credentials" });
  });

  // ─── COURSES ──────────────────────────────────────────────────────────────
  app.get("/api/courses", (_req, res) => {
    res.json(db.prepare(`
      SELECT c.*, u.name as instructor_name,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrollment_count
      FROM courses c JOIN users u ON c.instructor_id = u.id
      WHERE c.archived = 0
    `).all());
  });

  app.get("/api/courses/:id/modules", (req, res) => {
    const modules = db.prepare("SELECT * FROM modules WHERE course_id = ? ORDER BY display_order ASC").all(req.params.id);
    res.json(modules);
  });

  app.post("/api/courses/:id/modules", (req, res) => {
    const { name, content } = req.body;
    const lastOrder = db.prepare("SELECT MAX(display_order) as maxOrder FROM modules WHERE course_id = ?").get(req.params.id) as any;
    const result = db.prepare("INSERT INTO modules (course_id, name, content, display_order) VALUES (?, ?, ?, ?)").run(req.params.id, name, content, (lastOrder.maxOrder || 0) + 1);
    res.json({ id: result.lastInsertRowid });
  });

  app.get("/api/modules/:id/materials", (req, res) => {
    res.json(db.prepare("SELECT * FROM materials WHERE module_id = ?").all(req.params.id));
  });

  app.post("/api/modules/:id/materials", (req, res) => {
    const { title, type, size } = req.body;
    const result = db.prepare("INSERT INTO materials (module_id, title, type, url, size) VALUES (?, ?, ?, '#', ?)").run(req.params.id, title, type, size);
    res.json({ id: result.lastInsertRowid });
  });

  // ─── ASSIGNMENTS ──────────────────────────────────────────────────────────
  app.get("/api/modules/:id/assignments", (req, res) => {
    const status = (req.query.status as string) || "active";
    res.json(db.prepare("SELECT * FROM assignments WHERE module_id = ? AND status = ?").all(req.params.id, status));
  });

  app.post("/api/modules/:id/assignments", (req, res) => {
    const { title, description, due_date, max_points = 100, rubric = "", status = "active" } = req.body;
    if (!title || !due_date) return res.status(400).json({ error: "title and due_date required" });
    const result = db.prepare(
      "INSERT INTO assignments (module_id, title, description, due_date, max_points, rubric, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(req.params.id, title, description, due_date, max_points, rubric, status);
    res.json({ id: result.lastInsertRowid });
  });

  app.put("/api/assignments/:id", (req, res) => {
    const { title, description, due_date, max_points, rubric, status } = req.body;
    db.prepare(
      "UPDATE assignments SET title=?, description=?, due_date=?, max_points=?, rubric=?, status=? WHERE id=?"
    ).run(title, description, due_date, max_points, rubric, status, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/assignments/:id", (req, res) => {
    db.prepare("UPDATE assignments SET status='archived' WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });

  // ─── SUBMISSIONS ──────────────────────────────────────────────────────────
  app.post("/api/submissions", (req, res) => {
    const { assignment_id, student_id, content } = req.body;
    if (!assignment_id || !student_id) return res.status(400).json({ error: "assignment_id and student_id required" });
    const existing = db.prepare("SELECT id FROM submissions WHERE assignment_id=? AND student_id=?").get(assignment_id, student_id);
    if (existing) return res.status(409).json({ error: "Already submitted" });
    const result = db.prepare("INSERT INTO submissions (assignment_id, student_id, content) VALUES (?, ?, ?)").run(assignment_id, student_id, content);
    res.json({ id: result.lastInsertRowid });
  });

  app.post("/api/submissions/upload", uploadSubmission.array("files", 5), async (req: any, res) => {
    const { assignment_id, student_id, content = "" } = req.body;
    if (!assignment_id || !student_id) return res.status(400).json({ error: "assignment_id and student_id required" });

    const existing = db.prepare("SELECT id FROM submissions WHERE assignment_id=? AND student_id=?").get(assignment_id, student_id);
    if (existing) return res.status(409).json({ error: "Already submitted" });

    const result = db.prepare("INSERT INTO submissions (assignment_id, student_id, content) VALUES (?, ?, ?)").run(assignment_id, student_id, content);
    const submissionId = result.lastInsertRowid;

    const files: any[] = req.files ?? [];
    for (const file of files) {
      db.prepare(
        "INSERT INTO submission_files (submission_id, filename, original_name, file_type, file_path) VALUES (?, ?, ?, ?, ?)"
      ).run(submissionId, file.filename, file.originalname, file.mimetype, file.path);
    }

    res.json({ id: submissionId, files: files.map((f: any) => ({ filename: f.filename, original_name: f.originalname })) });
  });

  app.get("/api/submissions/:id/files", (req, res) => {
    const files = db.prepare("SELECT id, filename, original_name, file_type, uploaded_at FROM submission_files WHERE submission_id=?").all(req.params.id);
    res.json(files.map((f: any) => ({ ...f, url: `/uploads/submissions/${f.filename}` })));
  });

  app.get("/api/instructor/submissions", (_req, res) => {
    const submissions = db.prepare(`
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
    `).all();
    res.json(submissions);
  });

  app.post("/api/submissions/:id/grade", (req, res) => {
    const { grade, feedback } = req.body;
    db.prepare("UPDATE submissions SET grade=?, feedback=? WHERE id=?").run(grade, feedback, req.params.id);
    res.json({ success: true });
  });

  // ─── NOTES (upload + RAG pipeline) ────────────────────────────────────────
  app.get("/api/modules/:id/notes", (req, res) => {
    const { student_id } = req.query;
    let notes;
    if (student_id) {
      notes = db.prepare(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               m.name as module_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n JOIN modules m ON n.module_id = m.id
        WHERE n.module_id = ? AND n.student_id = ?
        ORDER BY n.uploaded_at DESC
      `).all(req.params.id, student_id);
    } else {
      notes = db.prepare(`
        SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
               m.name as module_name, u.name as student_name,
               (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
        FROM notes n JOIN modules m ON n.module_id = m.id
        JOIN users u ON n.student_id = u.id
        WHERE n.module_id = ?
        ORDER BY n.uploaded_at DESC
      `).all(req.params.id);
    }
    res.json(notes);
  });

  app.post("/api/modules/:id/notes", uploadNote.single("file"), async (req: any, res) => {
    const { student_id } = req.body;
    const file = req.file;
    if (!file || !student_id) return res.status(400).json({ error: "file and student_id required" });

    const text = await extractText(file.path, file.mimetype);

    const result = db.prepare(
      "INSERT INTO notes (student_id, module_id, filename, original_name, file_path, content_text, file_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(student_id, req.params.id, file.filename, file.originalname, file.path, text, file.mimetype);
    const noteId = result.lastInsertRowid;

    const chunks = chunkText(text);
    if (chunks.length > 0) {
      try {
        const embeddings = await nimEmbed(chunks);
        const insertChunk = db.prepare(
          "INSERT INTO note_chunks (note_id, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)"
        );
        const insertMany = db.transaction(() => {
          chunks.forEach((chunk, i) => {
            insertChunk.run(noteId, i, chunk, JSON.stringify(embeddings[i] ?? []));
          });
        });
        insertMany();
      } catch (_e) {
        console.error("Embedding error:", _e);
      }
    }

    res.json({
      id: noteId,
      original_name: file.originalname,
      chunk_count: chunks.length,
      text_length: text.length,
    });
  });

  app.delete("/api/notes/:id", (req, res) => {
    const note = db.prepare("SELECT file_path FROM notes WHERE id=?").get(req.params.id) as any;
    if (note?.file_path && fs.existsSync(note.file_path)) {
      fs.unlinkSync(note.file_path);
    }
    db.prepare("DELETE FROM note_chunks WHERE note_id=?").run(req.params.id);
    db.prepare("DELETE FROM notes WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/students/:id/notes", (req, res) => {
    const notes = db.prepare(`
      SELECT n.id, n.original_name, n.file_type, n.uploaded_at, n.module_id,
             m.name as module_name, c.name as course_name,
             (SELECT COUNT(*) FROM note_chunks nc WHERE nc.note_id = n.id) as chunk_count
      FROM notes n
      JOIN modules m ON n.module_id = m.id
      JOIN courses c ON m.course_id = c.id
      WHERE n.student_id = ?
      ORDER BY n.uploaded_at DESC
    `).all(req.params.id);
    res.json(notes);
  });

  // ─── STUDENT ──────────────────────────────────────────────────────────────
  app.get("/api/student/:id/courses", (req, res) => {
    res.json(db.prepare(`
      SELECT c.*, u.name as instructor_name
      FROM courses c JOIN enrollments e ON c.id = e.course_id
      JOIN users u ON c.instructor_id = u.id
      WHERE e.student_id = ? AND c.archived = 0
    `).all(req.params.id));
  });

  app.get("/api/student/:id/assignments", (req, res) => {
    res.json(db.prepare(`
      SELECT a.*, m.name as module_name, c.name as course_name,
             s.id as submission_id, s.grade, s.feedback,
             s.content as submission_content, s.submitted_at,
             s.ai_score, s.ai_feedback
      FROM assignments a
      JOIN modules m ON a.module_id = m.id
      JOIN courses c ON m.course_id = c.id
      JOIN enrollments e ON c.id = e.course_id
      LEFT JOIN submissions s ON a.id = s.assignment_id AND s.student_id = ?
      WHERE e.student_id = ? AND a.status = 'active'
      ORDER BY a.due_date ASC
    `).all(req.params.id, req.params.id));
  });

  app.get("/api/student/:id/stats", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
    const submissions = db.prepare(`
      SELECT s.*, a.title as assignment_title
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id
      WHERE s.student_id = ? AND s.grade IS NOT NULL
    `).all(req.params.id);
    res.json({ user, submissions });
  });

  // ─── STUDENT ANALYTICS ────────────────────────────────────────────────────
  app.get("/api/students/:id/analytics", (req, res) => {
    const studentId = req.params.id;
    const student = db.prepare("SELECT name FROM users WHERE id=?").get(studentId) as any;
    if (!student) return res.status(404).json({ error: "Student not found" });

    const enrolledCourses = db.prepare(`
      SELECT c.id, c.code as course_code, c.name as course_name
      FROM enrollments e JOIN courses c ON e.course_id = c.id
      WHERE e.student_id = ? AND c.archived = 0
    `).all(studentId) as any[];

    const courses = enrolledCourses.map((course: any) => {
      const totalAssignments = db.prepare(`
        SELECT COUNT(*) as count FROM assignments a
        JOIN modules m ON a.module_id = m.id
        WHERE m.course_id = ? AND a.status = 'active'
      `).get(course.id) as any;

      const grades = db.prepare(`
        SELECT a.title, s.grade, s.submitted_at
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN modules m ON a.module_id = m.id
        WHERE s.student_id = ? AND m.course_id = ? AND s.grade IS NOT NULL
        ORDER BY s.submitted_at ASC
      `).all(studentId, course.id) as any[];

      const avg = grades.length > 0
        ? grades.reduce((sum: number, g: any) => sum + g.grade, 0) / grades.length
        : null;

      const lateCount = db.prepare(`
        SELECT COUNT(*) as count FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN modules m ON a.module_id = m.id
        WHERE s.student_id = ? AND m.course_id = ?
          AND a.due_date IS NOT NULL AND date(s.submitted_at) > date(a.due_date)
      `).get(studentId, course.id) as any;

      return {
        course_code: course.course_code,
        course_name: course.course_name,
        assignments_total: totalAssignments.count,
        assignments_submitted: grades.length,
        avg_grade: avg != null ? Math.round(avg * 10) / 10 : null,
        late: lateCount.count,
        grades,
      };
    });

    const allGrades = courses.flatMap((c: any) => c.grades.map((g: any) => g.grade));
    const overall_avg = allGrades.length > 0
      ? Math.round((allGrades.reduce((a: number, b: number) => a + b, 0) / allGrades.length) * 10) / 10
      : null;

    const totalAssignmentsRow = db.prepare(`
      SELECT COUNT(*) as count FROM assignments a
      JOIN modules m ON a.module_id = m.id
      JOIN enrollments e ON m.course_id = e.course_id
      WHERE e.student_id = ? AND a.status = 'active'
    `).get(studentId) as any;

    const totalSubmittedRow = db.prepare(
      "SELECT COUNT(*) as count FROM submissions WHERE student_id=?"
    ).get(studentId) as any;

    res.json({
      student_name: student.name,
      overall_avg,
      total_submitted: totalSubmittedRow.count,
      total_pending: Math.max(0, totalAssignmentsRow.count - totalSubmittedRow.count),
      courses,
    });
  });

  // ─── ADMIN ────────────────────────────────────────────────────────────────
  app.get("/api/admin/users", (_req, res) => {
    res.json(db.prepare("SELECT id, name, email, role, active, year, major, gpa FROM users ORDER BY role, name").all());
  });

  app.post("/api/admin/users", (req, res) => {
    const { name, email, role, major, year } = req.body;
    try {
      const result = db.prepare("INSERT INTO users (name, email, role, major, year) VALUES (?, ?, ?, ?, ?)").run(name, email, role, major, year);
      res.json({ id: result.lastInsertRowid });
    } catch (_e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.put("/api/admin/users/:id", (req, res) => {
    const { name, email, role, active, major, year } = req.body;
    db.prepare("UPDATE users SET name=?, email=?, role=?, active=?, major=?, year=? WHERE id=?").run(name, email, role, active, major, year, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/admin/courses", (req, res) => {
    const { code, name, instructor_id } = req.body;
    const result = db.prepare("INSERT INTO courses (code, name, instructor_id) VALUES (?, ?, ?)").run(code, name, instructor_id);
    res.json({ id: result.lastInsertRowid });
  });

  app.get("/api/admin/stats", (_req, res) => {
    const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE active=1").get() as any;
    const totalCourses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE archived=0").get() as any;
    const avgGrade = db.prepare("SELECT AVG(grade) as avg FROM submissions WHERE grade IS NOT NULL").get() as any;
    const totalNotes = db.prepare("SELECT COUNT(*) as count FROM notes").get() as any;
    const totalSubmissions = db.prepare("SELECT COUNT(*) as count FROM submissions").get() as any;
    res.json({
      activeUsers: activeUsers.count,
      totalCourses: totalCourses.count,
      averageGrade: Math.round(avgGrade.avg || 0),
      totalNotes: totalNotes.count,
      totalSubmissions: totalSubmissions.count,
    });
  });

  app.get("/api/admin/settings", (_req, res) => {
    res.json(db.prepare("SELECT * FROM settings").all());
  });

  app.post("/api/admin/settings", (req, res) => {
    const { key, value } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    res.json({ success: true });
  });

  // ─── ADMIN ENROLLMENT MANAGEMENT ─────────────────────────────────────────
  app.get("/api/admin/enrollments/:courseId", (req, res) => {
    const enrollments = db.prepare(`
      SELECT e.id, e.enrolled_at, u.id as student_id, u.name, u.email, u.year, u.major
      FROM enrollments e JOIN users u ON e.student_id = u.id
      WHERE e.course_id = ? ORDER BY u.name
    `).all(req.params.courseId);
    res.json(enrollments);
  });

  app.post("/api/admin/enrollments", (req, res) => {
    const { course_id, student_id } = req.body;
    try {
      const result = db.prepare("INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)").run(course_id, student_id);
      if (result.changes === 0) return res.status(409).json({ error: "Already enrolled" });
      res.json({ id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/admin/enrollments/:id", (req, res) => {
    db.prepare("DELETE FROM enrollments WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/admin/bulk-enroll", (req, res) => {
    const { course_id, emails } = req.body as { course_id: number; emails: string[] };
    if (!course_id || !Array.isArray(emails)) return res.status(400).json({ error: "course_id and emails[] required" });

    const results: any[] = [];
    const insertEnroll = db.prepare("INSERT OR IGNORE INTO enrollments (course_id, student_id) VALUES (?, ?)");
    const insertUser = db.prepare("INSERT OR IGNORE INTO users (name, email, role) VALUES (?, ?, 'student')");

    const bulkTx = db.transaction(() => {
      for (const email of emails) {
        const trimmed = email.trim().toLowerCase();
        if (!trimmed) continue;
        let user = db.prepare("SELECT id, name FROM users WHERE email=?").get(trimmed) as any;
        if (!user) {
          const name = trimmed.split("@")[0].replace(/[._]/g, " ");
          insertUser.run(name, trimmed);
          user = db.prepare("SELECT id, name FROM users WHERE email=?").get(trimmed) as any;
        }
        const r = insertEnroll.run(course_id, user.id);
        results.push({ email: trimmed, student_id: user.id, enrolled: r.changes > 0 });
      }
    });
    bulkTx();
    res.json({ results });
  });

  // ─── INSTRUCTOR ───────────────────────────────────────────────────────────
  app.get("/api/instructor/:id/courses", (req, res) => {
    res.json(db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) as enrollment_count,
        (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) as module_count
      FROM courses c WHERE c.instructor_id = ? AND c.archived = 0
    `).all(req.params.id));
  });

  app.get("/api/instructor/courses/:id/analytics", (req, res) => {
    const enrollmentCount = db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE course_id=?").get(req.params.id) as any;
    const avgGrade = db.prepare(`
      SELECT AVG(s.grade) as avg FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN modules m ON a.module_id = m.id
      WHERE m.course_id = ? AND s.grade IS NOT NULL
    `).get(req.params.id) as any;
    res.json({ enrollments: enrollmentCount.count, averageGrade: Math.round(avgGrade.avg || 0) });
  });

  app.post("/api/instructor/assignments", (req, res) => {
    const { module_id, title, description, due_date, max_points = 100, rubric = "", status = "active" } = req.body;
    const result = db.prepare(
      "INSERT INTO assignments (module_id, title, description, due_date, max_points, rubric, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(module_id, title, description, due_date, max_points, rubric, status);
    res.json({ id: result.lastInsertRowid });
  });

  // ─── AI ENDPOINTS ─────────────────────────────────────────────────────────
  app.post("/api/ai/grade", async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const raw = await nimChat([
        {
          role: "system",
          content: "You are a GRADING ASSISTANT. Respond ONLY with valid JSON. " +
            'Shape: {"score":<int 0-100>,"feedback":"<2-3 sentences>","strengths":["..."],"improvements":["..."]}',
        },
        { role: "user", content: `RUBRIC: ${rubric}\n\nSTUDENT SUBMISSION:\n${submissionContent?.slice(0, 3000)}` },
      ], { temperature: 0.3 });
      try {
        const cleaned = raw.replace(/```json|```/g, "").trim();
        res.json(JSON.parse(cleaned));
      } catch (_e) {
        res.json({ score: 75, feedback: raw, strengths: ["Reviewed"], improvements: ["See feedback"] });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/grade-pdf", async (req, res) => {
    try {
      const { submission_id, rubric, module_id } = req.body;
      if (!submission_id) return res.status(400).json({ error: "submission_id required" });

      const submission = db.prepare("SELECT * FROM submissions WHERE id=?").get(submission_id) as any;
      const files = db.prepare("SELECT * FROM submission_files WHERE submission_id=?").all(submission_id) as any[];

      let fullText = submission?.content ?? "";
      for (const file of files) {
        const extracted = await extractText(file.file_path, file.file_type);
        if (extracted) fullText += "\n\n" + extracted;
      }

      if (!fullText.trim()) {
        return res.status(400).json({ error: "No readable content found in submission" });
      }

      let notesContext = "";
      if (module_id) {
        const relevantChunks = await retrieveChunks(module_id, fullText.slice(0, 500), 4);
        if (relevantChunks.length > 0) {
          notesContext = `\n\nRELEVANT COURSE NOTES:\n${relevantChunks.join("\n\n---\n")}`;
        }
      }

      const effectiveRubric = rubric || (submission ? db.prepare(
        "SELECT rubric FROM assignments WHERE id=(SELECT assignment_id FROM submissions WHERE id=?)"
      ).get(submission_id) as any)?.rubric || "Grade on overall quality, correctness, and clarity.";

      const raw = await nimChat([
        {
          role: "system",
          content: "You are an expert university GRADING ASSISTANT. " +
            "Respond ONLY with valid JSON — no markdown fences, no extra text. " +
            'Shape: {"score":<int 0-100>,"feedback":"<3-4 sentences>","strengths":["...","..."],"improvements":["...","..."],"rubric_breakdown":[{"criterion":"...","score":<int>,"comment":"..."}]}',
        },
        {
          role: "user",
          content: `RUBRIC:\n${effectiveRubric}${notesContext}\n\nSTUDENT SUBMISSION (${files.length} file(s) + text):\n${fullText.slice(0, 4000)}`,
        },
      ], { temperature: 0.3, maxTokens: 1200 });

      let result: any;
      try {
        result = JSON.parse(raw.replace(/```json|```/g, "").trim());
      } catch (_e) {
        result = { score: 75, feedback: raw, strengths: ["Reviewed"], improvements: ["See feedback"], rubric_breakdown: [] };
      }

      db.prepare(
        "UPDATE submissions SET ai_score=?, ai_feedback=?, ai_strengths=?, ai_improvements=? WHERE id=?"
      ).run(
        result.score,
        result.feedback,
        JSON.stringify(result.strengths),
        JSON.stringify(result.improvements),
        submission_id
      );

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { question, moduleTitle, moduleId, history = [] } = req.body;

      let notesContext = "No notes uploaded for this module yet.";
      if (moduleId) {
        const chunks = await retrieveChunks(moduleId, question, 5);
        if (chunks.length > 0) {
          notesContext = chunks.join("\n\n---\n");
        }
      }

      const answer = await nimChat([
        {
          role: "system",
          content:
            `You are a NOTES ASSISTANT for the module "${moduleTitle ?? "General"}". ` +
            `Answer ONLY from the course notes below. If the answer is not in the notes, say so honestly.\n\n` +
            `--- COURSE NOTES ---\n${notesContext}\n--- END NOTES ---`,
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ], { temperature: 0.4, maxTokens: 800 });
      res.json({ answer });
    } catch (e: any) {
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

      const submissionRate = analytics.total_submitted + analytics.total_pending > 0
        ? Math.round((analytics.total_submitted / (analytics.total_submitted + analytics.total_pending)) * 100)
        : 0;

      const summary = await nimChat([
        {
          role: "system",
          content: "You are an academic advisor AI. Write a concise 3-4 sentence personalised academic summary. Be encouraging but honest. Plain text, no bullet points.",
        },
        {
          role: "user",
          content: `Student: ${analytics.student_name}\nOverall: ${analytics.overall_avg ?? "N/A"}%\nSubmission rate: ${submissionRate}%\nPending: ${analytics.total_pending}\n\n${courseBreakdown}`,
        },
      ], { temperature: 0.4, maxTokens: 350 });
      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Production static ─────────────────────────────────────────────────────
  if (isProduction) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\nLearnIT API  →  http://localhost:${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
    if (!isProduction) console.log(`LearnIT App  →  http://localhost:5173  (Vite dev server)\n`);
  });
}

startServer();
