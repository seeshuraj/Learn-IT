-- admin_stats_snapshots
CREATE TABLE IF NOT EXISTS public.admin_stats_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  active_users      INT          NOT NULL DEFAULT 0,
  total_courses     INT          NOT NULL DEFAULT 0,
  average_grade     NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_notes       INT          NOT NULL DEFAULT 0,
  total_submissions INT          NOT NULL DEFAULT 0,
  snapshotted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- course_analytics_snapshots
CREATE TABLE IF NOT EXISTS public.course_analytics_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  course_id        INT          NOT NULL,
  enrollment_count INT          NOT NULL DEFAULT 0,
  average_grade    NUMERIC(5,2) NOT NULL DEFAULT 0,
  students         JSONB        NOT NULL DEFAULT '[]',
  snapshotted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_stats_snapshotted_at
  ON public.admin_stats_snapshots (snapshotted_at DESC);

CREATE INDEX IF NOT EXISTS idx_course_analytics_course_id
  ON public.course_analytics_snapshots (course_id, snapshotted_at DESC);