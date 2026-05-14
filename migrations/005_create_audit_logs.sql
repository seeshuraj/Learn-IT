-- P3-1: Audit Logs
-- Run once against your Postgres database.
-- Tracks who did what, when, from where — immutable append-only table.

CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Actor (nullable so pre-auth events like failed logins can be recorded)
  actor_user_id  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  actor_email    TEXT,
  actor_role     TEXT        CHECK (actor_role IN ('student','instructor','admin')),

  -- What happened
  action         TEXT        NOT NULL,   -- e.g. 'login.success', 'grade.submit', 'user.create'
  resource_type  TEXT,                   -- e.g. 'submission', 'note', 'user', 'enrollment'
  resource_id    TEXT,                   -- stringify so it works for int and uuid PKs

  -- Optional structured payload (non-sensitive diff / context)
  metadata       JSONB,

  -- Request context
  ip_address     TEXT,
  request_id     TEXT
);

-- Indexes for the two most common query patterns:
-- 1. Admin audit trail: chronological browse (most-recent first)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
-- 2. Per-actor history
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor      ON audit_logs (actor_user_id, created_at DESC);
-- 3. Per-resource history (e.g. all events touching submission #42)
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource   ON audit_logs (resource_type, resource_id, created_at DESC);
