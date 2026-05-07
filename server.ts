import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

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
    status TEXT,
    FOREIGN KEY(module_id) REFERENCES modules(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER,
    student_id INTEGER,
    content TEXT,
    grade INTEGER,
    feedback TEXT,
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assignment_id) REFERENCES assignments(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
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

    const insertEnrollment = db.prepare("INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)");
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

    const insertAssignment = db.prepare("INSERT INTO assignments (module_id, title, description, due_date, status) VALUES (?, ?, ?, ?, ?)");
    insertAssignment.run(1, "ML Project", "Implement a simple neural network from scratch.", "2026-03-15", "active");
    insertAssignment.run(3, "Database Design", "Design a schema for a library management system.", "2026-02-10", "active");
    insertAssignment.run(4, "Algorithm Report", "Compare QuickSort and MergeSort performance.", "2026-02-20", "active");

    const insertSubmission = db.prepare("INSERT INTO submissions (assignment_id, student_id, content, grade, feedback) VALUES (?, ?, ?, ?, ?)");
    insertSubmission.run(2, 2, "My database design for a library system...", 87, "Great work on the normalization.");

    const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    insertSetting.run("file_size_limit", "10MB");
    insertSetting.run("ai_enabled", "true");
  }
};
seed();

// ─── AI helper (NVIDIA NIM — OpenAI-compatible) ────────────────────────────
async function nimChat(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    return "Mock AI response — set NVIDIA_API_KEY in .env to enable real responses.";
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

async function startServer() {
  const app = express();

  // ─── CORS ────────────────────────────────────────────────────────────────
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    })
  );

  app.use(express.json());

  // ─── Health ───────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV, ts: new Date().toISOString() });
  });

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  app.post("/api/login", (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (user) res.json(user);
    else res.status(401).json({ error: "Invalid credentials" });
  });

  // ─── COURSES ──────────────────────────────────────────────────────────────
  app.get("/api/courses", (_req, res) => {
    const courses = db.prepare(`
      SELECT c.*, u.name as instructor_name
      FROM courses c JOIN users u ON c.instructor_id = u.id
      WHERE c.archived = 0
    `).all();
    res.json(courses);
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

  app.get("/api/modules/:id/assignments", (req, res) => {
    res.json(db.prepare("SELECT * FROM assignments WHERE module_id = ? AND status = 'active'").all(req.params.id));
  });

  app.post("/api/modules/:id/assignments", (req, res) => {
    const { title, description, due_date } = req.body;
    const result = db.prepare("INSERT INTO assignments (module_id, title, description, due_date, status) VALUES (?, ?, ?, ?, 'active')").run(req.params.id, title, description, due_date);
    res.json({ id: result.lastInsertRowid });
  });

  // ─── SUBMISSIONS ──────────────────────────────────────────────────────────
  app.get("/api/instructor/submissions", (_req, res) => {
    const submissions = db.prepare(`
      SELECT s.*, a.title as assignment_title, u.name as student_name, c.name as course_name
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN users u ON s.student_id = u.id
      JOIN modules m ON a.module_id = m.id
      JOIN courses c ON m.course_id = c.id
      WHERE s.grade IS NULL OR s.grade = 0
    `).all();
    res.json(submissions);
  });

  app.post("/api/submissions/:id/grade", (req, res) => {
    const { grade, feedback } = req.body;
    db.prepare("UPDATE submissions SET grade = ?, feedback = ? WHERE id = ?").run(grade, feedback, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/submissions", (req, res) => {
    const { assignment_id, student_id, content } = req.body;
    const result = db.prepare("INSERT INTO submissions (assignment_id, student_id, content) VALUES (?, ?, ?)").run(assignment_id, student_id, content);
    res.json({ id: result.lastInsertRowid });
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
             s.content as submission_content, s.submitted_at
      FROM assignments a
      JOIN modules m ON a.module_id = m.id
      JOIN courses c ON m.course_id = c.id
      JOIN enrollments e ON c.id = e.course_id
      LEFT JOIN submissions s ON a.id = s.assignment_id AND s.student_id = ?
      WHERE e.student_id = ? AND a.status = 'active'
    `).all(req.params.id, req.params.id));
  });

  app.get("/api/student/:id/stats", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    const submissions = db.prepare(`
      SELECT s.*, a.title as assignment_title
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id
      WHERE s.student_id = ? AND s.grade IS NOT NULL
    `).all(req.params.id);
    res.json({ user, submissions });
  });

  // ─── STUDENT ANALYTICS ────────────────────────────────────────────────────
  // GET /api/students/:id/analytics
  // Returns per-course grade breakdown, KPIs, and grade history for AnalyticsPage
  app.get("/api/students/:id/analytics", (req, res) => {
    const studentId = req.params.id;
    const student = db.prepare("SELECT name FROM users WHERE id = ?").get(studentId) as any;
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

      // late count: submitted_at > due_date (best-effort, due_date on assignment)
      const lateCount = db.prepare(`
        SELECT COUNT(*) as count FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN modules m ON a.module_id = m.id
        WHERE s.student_id = ? AND m.course_id = ?
          AND a.due_date IS NOT NULL
          AND date(s.submitted_at) > date(a.due_date)
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
      "SELECT COUNT(*) as count FROM submissions WHERE student_id = ?"
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
    res.json(db.prepare("SELECT * FROM users").all());
  });

  app.post("/api/admin/users", (req, res) => {
    const { name, email, role, major, year } = req.body;
    try {
      const result = db.prepare("INSERT INTO users (name, email, role, major, year) VALUES (?, ?, ?, ?, ?)").run(name, email, role, major, year);
      res.json({ id: result.lastInsertRowid });
    } catch {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.put("/api/admin/users/:id", (req, res) => {
    const { name, email, role, active, major, year } = req.body;
    db.prepare("UPDATE users SET name = ?, email = ?, role = ?, active = ?, major = ?, year = ? WHERE id = ?").run(name, email, role, active, major, year, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/admin/courses", (req, res) => {
    const { code, name, instructor_id } = req.body;
    const result = db.prepare("INSERT INTO courses (code, name, instructor_id) VALUES (?, ?, ?)").run(code, name, instructor_id);
    res.json({ id: result.lastInsertRowid });
  });

  app.get("/api/admin/stats", (_req, res) => {
    const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").get() as any;
    const totalCourses = db.prepare("SELECT COUNT(*) as count FROM courses WHERE archived = 0").get() as any;
    const avgGrade = db.prepare("SELECT AVG(grade) as avg FROM submissions WHERE grade IS NOT NULL").get() as any;
    res.json({ activeUsers: activeUsers.count, totalCourses: totalCourses.count, averageGrade: Math.round(avgGrade.avg || 0) });
  });

  app.get("/api/admin/settings", (_req, res) => {
    res.json(db.prepare("SELECT * FROM settings").all());
  });

  app.post("/api/admin/settings", (req, res) => {
    const { key, value } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    res.json({ success: true });
  });

  // ─── INSTRUCTOR ───────────────────────────────────────────────────────────
  app.get("/api/instructor/:id/courses", (req, res) => {
    res.json(db.prepare("SELECT * FROM courses WHERE instructor_id = ? AND archived = 0").all(req.params.id));
  });

  app.get("/api/instructor/courses/:id/analytics", (req, res) => {
    const enrollmentCount = db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE course_id = ?").get(req.params.id) as any;
    const avgGrade = db.prepare(`
      SELECT AVG(s.grade) as avg FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN modules m ON a.module_id = m.id
      WHERE m.course_id = ? AND s.grade IS NOT NULL
    `).get(req.params.id) as any;
    res.json({ enrollments: enrollmentCount.count, averageGrade: Math.round(avgGrade.avg || 0) });
  });

  app.post("/api/instructor/assignments", (req, res) => {
    const { module_id, title, description, due_date, max_points, rubric } = req.body;
    const result = db.prepare("INSERT INTO assignments (module_id, title, description, due_date, max_points, rubric, status) VALUES (?, ?, ?, ?, ?, ?, 'active')").run(module_id, title, description, due_date, max_points, rubric);
    res.json({ id: result.lastInsertRowid });
  });

  // ─── AI ENDPOINTS ─────────────────────────────────────────────────────────
  app.post("/api/ai/grade", async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const raw = await nimChat([
        {
          role: "system",
          content:
            "You are a GRADING ASSISTANT for a university LMS. " +
            "Respond ONLY with a valid JSON object — no markdown, no extra text. " +
            'Shape: {"score":<int 0-100>,"feedback":"<2-3 sentences>","strengths":["...","..."],"improvements":["...","..."]}',
        },
        { role: "user", content: `RUBRIC: ${rubric}\n\nSTUDENT SUBMISSION:\n${submissionContent?.slice(0, 3000)}` },
      ], { temperature: 0.3 });
      const cleaned = raw.replace(/```json|```/g, "").trim();
      try {
        res.json(JSON.parse(cleaned));
      } catch {
        // NIM returned plain text instead of JSON (mock mode)
        res.json({ score: 80, feedback: cleaned, strengths: ["Good attempt"], improvements: ["Add more detail"] });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { question, moduleTitle, notesContext, history = [] } = req.body;
      const answer = await nimChat([
        {
          role: "system",
          content:
            `You are a NOTES ASSISTANT for the module "${moduleTitle}". ` +
            `Answer ONLY from the student notes below. Be concise.\n\n` +
            `--- NOTES ---\n${notesContext?.slice(0, 3000)}\n--- END ---`,
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ], { temperature: 0.5, maxTokens: 800 });
      res.json({ answer });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ai/analytics-summary
  // Accepts the full analytics payload from AnalyticsPage and returns
  // a personalised 3-4 sentence AI summary of student performance
  app.post("/api/ai/analytics-summary", async (req, res) => {
    try {
      const { analytics } = req.body;
      if (!analytics) return res.status(400).json({ error: "analytics payload required" });

      const courseBreakdown = (analytics.courses ?? []).map((c: any) =>
        `${c.course_code ?? ''} ${c.course_name}: avg ${
          c.avg_grade != null ? c.avg_grade + "%" : "no grades yet"
        }, ${c.assignments_submitted}/${c.assignments_total} submitted, ${c.late ?? 0} late`
      ).join("\n");

      const submissionRate = analytics.total_submitted + analytics.total_pending > 0
        ? Math.round((analytics.total_submitted / (analytics.total_submitted + analytics.total_pending)) * 100)
        : 0;

      const prompt =
        `Student: ${analytics.student_name}\n` +
        `Overall average: ${analytics.overall_avg != null ? analytics.overall_avg + "%" : "no grades yet"}\n` +
        `Submission rate: ${submissionRate}%\n` +
        `Pending assignments: ${analytics.total_pending}\n\n` +
        `Course breakdown:\n${courseBreakdown}`;

      const summary = await nimChat([
        {
          role: "system",
          content:
            "You are an academic advisor AI for a university LMS. " +
            "Write a concise 3-4 sentence personalised summary: where the student is doing well, " +
            "where they should focus more effort, and one concrete actionable tip. " +
            "Be encouraging but honest. Use plain text, no bullet points.",
        },
        { role: "user", content: prompt },
      ], { temperature: 0.4, maxTokens: 350 });

      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Production static (single-server deploy) ─────────────────────────────
  if (isProduction) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LearnIT API  →  http://localhost:${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
    if (!isProduction) {
      console.log(`LearnIT App  →  http://localhost:5173  (Vite dev server)`);
    }
  });
}

startServer();
