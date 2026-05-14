-- P3-4: In-app notifications
-- One row per notification per user.
-- Fired fire-and-forget by server-side events (grade posted, new assignment, roadmap ready).
-- Clients poll GET /api/notifications to check for unread counts.

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,   -- e.g. 'grade_posted', 'new_assignment', 'roadmap_ready'
  message     TEXT         NOT NULL,
  metadata    JSONB,                   -- optional: { courseId, assignmentId, roadmapId, ... }
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE read = FALSE;

-- Auto-prune: keep only the latest 200 notifications per user.
-- Triggered after each INSERT so the table never grows unboundedly.
CREATE OR REPLACE FUNCTION prune_old_notifications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM notifications
  WHERE id IN (
    SELECT id FROM notifications
    WHERE user_id = NEW.user_id
    ORDER BY created_at DESC
    OFFSET 200
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_notifications ON notifications;
CREATE TRIGGER trg_prune_notifications
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION prune_old_notifications();
