import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("learnit.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    role TEXT, -- 'student' or 'instructor'
    year INTEGER,
    gpa REAL,
    major TEXT
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    instructor_id INTEGER,
    FOREIGN KEY(instructor_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER,
    name TEXT,
    content TEXT, -- Simulated notes content for RAG
    FOREIGN KEY(course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER,
    title TEXT,
    due_date TEXT,
    status TEXT, -- 'pending', 'graded', 'overdue'
    FOREIGN KEY(module_id) REFERENCES modules(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER,
    student_id INTEGER,
    content TEXT,
    grade INTEGER,
    feedback TEXT,
    ai_suggestion TEXT,
    FOREIGN KEY(assignment_id) REFERENCES assignments(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
  );
`);

// Seed Data
const seed = () => {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    // Users
    const insertUser = db.prepare("INSERT INTO users (name, email, role, year, gpa, major) VALUES (?, ?, ?, ?, ?, ?)");
    insertUser.run("Sarah Johnson", "sarah@learnit.edu", "student", 3, 3.7, "Computer Science");
    insertUser.run("Michael Chen", "michael@learnit.edu", "student", 2, 3.4, "Data Science");
    insertUser.run("Dr. Aris", "instructor@learnit.edu", "instructor", null, null, "AI & Machine Learning");

    // Courses
    const insertCourse = db.prepare("INSERT INTO courses (code, name, instructor_id) VALUES (?, ?, ?)");
    insertCourse.run("CS4510", "Advanced AI", 3);
    insertCourse.run("CS3200", "Database Systems", 3);
    insertCourse.run("CS3000", "Algorithms", 3);

    // Modules
    const insertModule = db.prepare("INSERT INTO modules (course_id, name, content) VALUES (?, ?, ?)");
    insertModule.run(1, "Neural Networks", "Backpropagation is the central algorithm in training neural networks. It uses the chain rule to compute gradients of the loss function with respect to weights.");
    insertModule.run(1, "Deep Learning", "Deep learning involves multiple layers of neural networks to extract high-level features from raw input.");
    insertModule.run(2, "SQL Basics", "SQL stands for Structured Query Language. It is used to manage and manipulate relational databases.");
    insertModule.run(3, "Sorting Algorithms", "QuickSort and MergeSort are efficient O(n log n) sorting algorithms.");

    // Assignments
    const insertAssignment = db.prepare("INSERT INTO assignments (module_id, title, due_date, status) VALUES (?, ?, ?, ?)");
    insertAssignment.run(1, "ML Project", "2026-03-15", "pending");
    insertAssignment.run(3, "Database Design", "2026-02-10", "graded");
    insertAssignment.run(4, "Algorithm Report", "2026-02-20", "overdue");

    // Submissions
    const insertSubmission = db.prepare("INSERT INTO submissions (assignment_id, student_id, content, grade, feedback) VALUES (?, ?, ?, ?, ?)");
    insertSubmission.run(2, 1, "My database design for a library system...", 87, "Great work on the normalization.");
  }
};
seed();

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.post("/api/login", (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/courses", (req, res) => {
    const courses = db.prepare(`
      SELECT c.*, u.name as instructor_name 
      FROM courses c 
      JOIN users u ON c.instructor_id = u.id
    `).all();
    res.json(courses);
  });

  app.get("/api/courses/:id/modules", (req, res) => {
    const modules = db.prepare("SELECT * FROM modules WHERE course_id = ?").all(req.params.id);
    res.json(modules);
  });

  app.get("/api/assignments", (req, res) => {
    const assignments = db.prepare(`
      SELECT a.*, m.name as module_name, c.name as course_name 
      FROM assignments a
      JOIN modules m ON a.module_id = m.id
      JOIN courses c ON m.course_id = c.id
    `).all();
    res.json(assignments);
  });

  app.get("/api/instructor/submissions", (req, res) => {
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
    db.prepare("UPDATE submissions SET grade = ?, feedback = ? WHERE id = ?")
      .run(grade, feedback, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/submissions", (req, res) => {
    const { assignment_id, student_id, content } = req.body;
    const result = db.prepare("INSERT INTO submissions (assignment_id, student_id, content) VALUES (?, ?, ?)")
      .run(assignment_id, student_id, content);
    res.json({ id: result.lastInsertRowid });
  });

  app.get("/api/student/:id/stats", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    const submissions = db.prepare(`
      SELECT s.*, a.title as assignment_title 
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.student_id = ? AND s.grade IS NOT NULL
    `).all(req.params.id);
    res.json({ user, submissions });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LearnIT Server running on http://localhost:${PORT}`);
  });
}

startServer();
