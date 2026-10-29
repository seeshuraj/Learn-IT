-- ============================================================
-- Migration: drop_password_column_and_fix_function_search_paths
-- P1-3: Removes legacy plaintext password column from
-- public.users (auth is now handled by Supabase Auth).
-- Fixes mutable search_path warning on all 7 helper functions
-- by adding SET search_path = '' to each definition.
-- ============================================================

begin;

-- ── 1. Drop legacy password column ───────────────────────────
-- Supabase Auth is now the source of truth for credentials.
-- This column was flagged as a sensitive exposed column by
-- the Supabase security advisor.
alter table public.users drop column if exists password;

-- ── 2. Fix search_path on all helper functions ────────────────
-- Each function is recreated with SET search_path = ''
-- and all schema references fully qualified.
-- This closes the function_search_path_mutable WARN advisory.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_legacy_user_id()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select uim.legacy_user_id
  from   public.user_identity_map uim
  where  uim.auth_user_id = (select auth.uid())
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select uim.role
  from   public.user_identity_map uim
  where  uim.auth_user_id = (select auth.uid())
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select public.current_user_role()) = 'admin',
    false
  )
$$;

create or replace function public.is_instructor_for_course(p_course_id integer)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from   public.courses c
    where  c.id = p_course_id
      and  c.instructor_id = (select public.current_legacy_user_id())
  )
$$;

create or replace function public.is_enrolled_in_course(p_course_id integer)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from   public.enrollments e
    where  e.course_id = p_course_id
      and  e.student_id = (select public.current_legacy_user_id())
  )
$$;

create or replace function public.can_access_module(p_module_id integer)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from   public.modules m
    where  m.id = p_module_id
      and  (
        (select public.is_admin())
        or (select public.is_instructor_for_course(m.course_id))
        or (select public.is_enrolled_in_course(m.course_id))
      )
  )
$$;

commit;
