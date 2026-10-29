-- student_roadmaps
CREATE TABLE IF NOT EXISTS public.student_roadmaps (
  id           BIGSERIAL PRIMARY KEY,
  student_id   INT         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id    INT         NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL DEFAULT 'My Learning Roadmap',
  summary      TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, course_id)
);

-- roadmap_milestones
CREATE TABLE IF NOT EXISTS public.roadmap_milestones (
  id            BIGSERIAL PRIMARY KEY,
  roadmap_id    BIGINT      NOT NULL REFERENCES public.student_roadmaps(id) ON DELETE CASCADE,
  step_order    INT         NOT NULL DEFAULT 0,
  title         TEXT        NOT NULL,
  description   TEXT,
  resource_hint TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_roadmap_milestones_roadmap_id ON public.roadmap_milestones(roadmap_id);
CREATE INDEX IF NOT EXISTS idx_student_roadmaps_student_id  ON public.student_roadmaps(student_id);

-- notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  metadata    JSONB,
  read        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id, created_at DESC);