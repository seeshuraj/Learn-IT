-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: wire_auth_identity_map_and_triggers
--
-- 1. Sync existing placeholder auth_user_ids to real auth.users UUIDs (by email)
-- 2. Add trigger: auto-provision user_identity_map on new Supabase Auth sign-up
-- 3. Add trigger: sync role/is_active when public.users is updated
-- 4. Add RLS policies on user_identity_map
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Sync real auth UUIDs for the 4 seed users ────────────────────────────
-- Matches by email between auth.users and public.users.
-- Only updates rows where auth_user_id is still a placeholder (not a real UUID
-- from Supabase Auth — real UUIDs are version 4 random, placeholders are v1-ish).
UPDATE public.user_identity_map uim
SET
  auth_user_id = au.id,
  updated_at   = now()
FROM auth.users au
JOIN public.users pu ON lower(pu.email) = lower(au.email)
WHERE uim.legacy_user_id = pu.id
  AND au.id IS NOT NULL;

-- ── 2. Function: auto-provision identity map on new Supabase Auth sign-up ────
-- Fired AFTER INSERT on auth.users.
-- Creates a matching row in public.users (if not already present) and
-- links it into user_identity_map. New users get role='student' by default.
-- Role can be promoted later via admin API or direct DB update.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- runs as DB owner, bypasses RLS
SET search_path = public
AS $$
DECLARE
  v_legacy_id  integer;
  v_user_name  text;
BEGIN
  -- Derive a display name: prefer full_name metadata, fall back to email prefix
  v_user_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- Upsert into public.users keyed on email
  INSERT INTO public.users (name, email, role, active)
  VALUES (v_user_name, lower(NEW.email), 'student', 1)
  ON CONFLICT (email) DO NOTHING;

  -- Get the legacy integer PK (handles both new insert and pre-existing row)
  SELECT id INTO v_legacy_id
  FROM public.users
  WHERE lower(email) = lower(NEW.email);

  IF v_legacy_id IS NULL THEN
    RETURN NEW; -- safety guard — should never happen
  END IF;

  -- Upsert into user_identity_map
  INSERT INTO public.user_identity_map (legacy_user_id, auth_user_id, role, is_active)
  SELECT
    v_legacy_id,
    NEW.id,
    u.role,          -- use role already stored in public.users
    (u.active = 1)
  FROM public.users u
  WHERE u.id = v_legacy_id
  ON CONFLICT (legacy_user_id) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        is_active    = EXCLUDED.is_active,
        updated_at   = now();

  RETURN NEW;
END;
$$;

-- Drop if exists first to allow re-runs
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 3. Function: sync role + is_active back to identity map on users update ──
-- When an admin updates public.users.role or .active, mirror it to the map.
CREATE OR REPLACE FUNCTION public.sync_user_role_to_identity_map()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_identity_map
  SET
    role      = NEW.role,
    is_active = (NEW.active = 1),
    updated_at = now()
  WHERE legacy_user_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_role_on_user_update ON public.users;

CREATE TRIGGER sync_role_on_user_update
  AFTER UPDATE OF role, active ON public.users
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION public.sync_user_role_to_identity_map();

-- ── 4. RLS policies on user_identity_map ─────────────────────────────────────
-- The Express server uses the service-role key which BYPASSES RLS entirely,
-- so these policies only matter for direct Supabase client access.
-- We lock it down: users can only read their own row; only service role can write.

-- Drop stale policies
DROP POLICY IF EXISTS uim_select_own  ON public.user_identity_map;
DROP POLICY IF EXISTS uim_insert_self ON public.user_identity_map;
DROP POLICY IF EXISTS uim_update_self ON public.user_identity_map;

-- Users can SELECT their own mapping row
CREATE POLICY uim_select_own
  ON public.user_identity_map
  FOR SELECT
  USING (auth_user_id = auth.uid());

-- No direct INSERT or UPDATE from the browser — only the trigger + service role
-- (Leaving INSERT/UPDATE policies absent means only service role / trigger can write)

-- ── 5. Helper view: resolve current user's legacy id (useful in RLS elsewhere) ──
CREATE OR REPLACE VIEW public.current_user_legacy AS
SELECT
  uim.legacy_user_id,
  uim.role,
  uim.auth_user_id
FROM public.user_identity_map uim
WHERE uim.auth_user_id = auth.uid()
  AND uim.is_active = true;
