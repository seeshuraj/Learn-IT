-- ─── TABLES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT DEFAULT '<redacted>',
  role TEXT,
  active INTEGER DEFAULT 1,
  year INTEGER,
  gpa REAL,
  major TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  instructor_id INTEGER REFERENCES users(id),
  archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  student_id INTEGER REFERENCES users(id),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  name TEXT,
  content TEXT,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES modules(id),
  title TEXT,
  type TEXT,
  url TEXT,
  size TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  module_id INTEGER REFERENCES modules(id),
  title TEXT,
  description TEXT,
  due_date TEXT,
  max_points INTEGER DEFAULT 100,
  rubric TEXT,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignments(id),
  student_id INTEGER REFERENCES users(id),
  content TEXT,
  grade INTEGER,
  feedback TEXT,
  ai_score INTEGER,
  ai_feedback TEXT,
  ai_strengths TEXT,
  ai_improvements TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submission_files (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER REFERENCES submissions(id),
  filename TEXT,
  original_name TEXT,
  file_type TEXT,
  file_path TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  module_id INTEGER REFERENCES modules(id),
  filename TEXT,
  original_name TEXT,
  file_path TEXT,
  content_text TEXT,
  file_type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_chunks (
  id SERIAL PRIMARY KEY,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  chunk_text TEXT,
  embedding TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ─── SEED ─────────────────────────────────────────────────────────────────────
INSERT INTO users (name, email, role, year, gpa, major) VALUES
  ('Admin User',    '<redacted-email>',      'admin',      NULL, NULL, NULL),
  ('Sarah Johnson', '<redacted-email>',       'student',    3,    3.7,  'Computer Science'),
  ('Michael Chen',  '<redacted-email>',     'student',    2,    3.4,  'Data Science'),
  ('Dr. Aris',      '<redacted-email>',  'instructor', NULL, NULL, 'AI & Machine Learning')
ON CONFLICT (email) DO NOTHING;

INSERT INTO courses (code, name, instructor_id) VALUES
  ('CS4510', 'Advanced AI',       4),
  ('CS3200', 'Database Systems',  4),
  ('CS3000', 'Algorithms',        4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO enrollments (course_id, student_id) VALUES
  (1,2),(2,2),(3,2),(1,3)
ON CONFLICT DO NOTHING;

INSERT INTO modules (course_id, name, content, display_order) VALUES
  (1, 'Neural Networks',   'Backpropagation is the central algorithm in training neural networks. It uses the chain rule to compute gradients of the loss function with respect to weights.', 1),
  (1, 'Deep Learning',     'Deep learning involves multiple layers of neural networks to extract high-level features from raw input.', 2),
  (2, 'SQL Basics',        'SQL stands for Structured Query Language. It is used to manage and manipulate relational databases.', 1),
  (3, 'Sorting Algorithms','QuickSort and MergeSort are efficient O(n log n) sorting algorithms.', 1);

INSERT INTO materials (module_id, title, type, url, size) VALUES
  (1, 'Lecture Notes.pdf',   'pdf',   '#', '2.4 MB'),
  (1, 'Module Overview.mp4', 'video', '#', '15:20'),
  (3, 'SQL Cheat Sheet.pdf', 'pdf',   '#', '1.1 MB');

INSERT INTO assignments (module_id, title, description, due_date, max_points, rubric, status) VALUES
  (1, 'ML Project',       'Implement a simple neural network from scratch using Python and NumPy. Show forward pass, backward pass, and training loop.', '2026-06-15', 100, 'Correctness (40%), Code quality (30%), Explanation (30%)', 'active'),
  (3, 'Database Design',  'Design a normalised schema for a library management system. Include ER diagram and SQL DDL.', '2026-06-10', 100, 'Normalisation (40%), SQL syntax (30%), ER diagram (30%)', 'active'),
  (4, 'Algorithm Report', 'Compare QuickSort and MergeSort: time complexity, space complexity, best/worst/average cases with benchmarks.', '2026-06-20', 100, 'Analysis (50%), Benchmarks (30%), Writing quality (20%)', 'active');

INSERT INTO submissions (assignment_id, student_id, content, grade, feedback) VALUES
  (2, 2, 'My database design for a library system with proper normalisation to 3NF...', 87, 'Great work on the normalisation. The ER diagram is clear.');

INSERT INTO settings (key, value) VALUES
  ('file_size_limit',    '20MB'),
  ('ai_enabled',         'true'),
  ('allowed_file_types', 'pdf,docx,doc,jpg,jpeg,png,txt')
ON CONFLICT (key) DO NOTHING;
