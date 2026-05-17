-- Migration 011: Unit Exams — marks ingestion + performance analytics
-- Run after 010_*

-- Main exam record (one per unit test)
CREATE TABLE IF NOT EXISTS unit_exams (
  id               SERIAL PRIMARY KEY,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  exam_date        DATE,
  max_marks        NUMERIC(6,2) NOT NULL DEFAULT 100,
  grading_schema   JSONB   NOT NULL DEFAULT '{"strong":75,"moderate":50}'::jsonb,
  paper_storage_path TEXT,
  paper_text       TEXT,
  analysis_status  TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (analysis_status IN ('pending','processing','done','failed')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_exams_course ON unit_exams(course_id);

-- Per-student result rows (one per student per exam)
CREATE TABLE IF NOT EXISTS unit_exam_results (
  id                   SERIAL PRIMARY KEY,
  unit_exam_id         INTEGER NOT NULL REFERENCES unit_exams(id) ON DELETE CASCADE,
  student_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marks_obtained       NUMERIC(6,2) NOT NULL,
  percentage           NUMERIC(5,2) GENERATED ALWAYS AS
                         (ROUND((marks_obtained / NULLIF((SELECT max_marks FROM unit_exams WHERE id = unit_exam_id), 0)) * 100, 2))
                         STORED,
  performance_band     TEXT CHECK (performance_band IN ('strong','moderate','weak')),
  topic_breakdown      JSONB,
  raw_row              JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unit_exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_exam_results_exam    ON unit_exam_results(unit_exam_id);
CREATE INDEX IF NOT EXISTS idx_unit_exam_results_student ON unit_exam_results(student_id);

-- Import audit trail (one row per CSV/XLSX upload attempt)
CREATE TABLE IF NOT EXISTS unit_exam_imports (
  id             SERIAL PRIMARY KEY,
  unit_exam_id   INTEGER NOT NULL REFERENCES unit_exams(id) ON DELETE CASCADE,
  file_name      TEXT    NOT NULL,
  import_type    TEXT    NOT NULL CHECK (import_type IN ('csv','xlsx')),
  status         TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  rows_total     INTEGER DEFAULT 0,
  rows_matched   INTEGER DEFAULT 0,
  rows_failed    INTEGER DEFAULT 0,
  error_report   JSONB,
  imported_by    INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional topic-level analysis extracted from the exam paper PDF
CREATE TABLE IF NOT EXISTS unit_exam_topic_analysis (
  id            SERIAL PRIMARY KEY,
  unit_exam_id  INTEGER NOT NULL REFERENCES unit_exams(id) ON DELETE CASCADE,
  topic_name    TEXT    NOT NULL,
  weight        NUMERIC(5,2),
  difficulty    TEXT CHECK (difficulty IN ('easy','medium','hard')),
  evidence      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
