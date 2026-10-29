-- 1. Add missing created_at to courses
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Add missing force_password_change to user_identity_map
ALTER TABLE public.user_identity_map
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Backfill created_at for existing courses (use id order as proxy)
UPDATE public.courses
  SET created_at = NOW() - (id * INTERVAL '1 day')
  WHERE created_at = NOW() OR created_at IS NULL;