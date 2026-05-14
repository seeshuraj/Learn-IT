-- P3-2: Analytics Snapshots
-- Two tables to store pre-aggregated dashboard data.
-- The cron job (src/server/jobs/cron.ts) refreshes these every 30 minutes.
-- Routes read from snapshots first; fall back to live query if missing.

-- ── Admin global stats snapshot ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_stats_snapshots (
  id               BIGSERIAL    PRIMARY KEY,
  snapshotted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  active_users     INT          NOT NULL DEFAULT 0,
  total_courses    INT          NOT NULL DEFAULT 0,
  average_grade    NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_notes      INT          NOT NULL DEFAULT 0,
  total_submissions INT         NOT NULL DEFAULT 0
);

-- Keep only the latest 48 snapshots (24 hours at 30-min cadence)
CREATE INDEX IF NOT EXISTS idx_admin_stats_snap_ts
  ON admin_stats_snapshots (snapshotted_at DESC);

-- ── Per-course instructor analytics snapshot ──────────────────────────────────
CREATE TABLE IF NOT EXISTS course_analytics_snapshots (
  id               BIGSERIAL    PRIMARY KEY,
  course_id        INT          NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  snapshotted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  enrollment_count INT          NOT NULL DEFAULT 0,
  average_grade    NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- Per-student breakdown stored as JSONB array:
  -- [{ student_id, name, avg_grade, submission_count, late, missed }]
  students         JSONB        NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_course_snap_course_ts
  ON course_analytics_snapshots (course_id, snapshotted_at DESC);
