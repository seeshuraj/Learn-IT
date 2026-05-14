-- P3-5: Password reset tokens + force-password-change flag
-- Supabase Auth handles the actual credential storage;
-- this table is used to validate short-lived reset tokens issued by the server,
-- and the flag on user_identity_map tracks first-login enforcement.

-- Add force_password_change flag (default TRUE for new users, cleared on first change)
ALTER TABLE user_identity_map
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_password_change   TIMESTAMPTZ;

-- Password reset tokens issued by the server
-- Token is a random UUID; valid for 1 hour; single-use (used_at set on consumption).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token   ON password_reset_tokens (token);
CREATE INDEX IF NOT EXISTS idx_prt_user    ON password_reset_tokens (user_id, created_at DESC);

-- Auto-expire cleanup: delete tokens older than 24h regardless of use status.
-- Run this from the cron job (see cron.ts).
-- Or add a scheduled job:
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '24 hours';
