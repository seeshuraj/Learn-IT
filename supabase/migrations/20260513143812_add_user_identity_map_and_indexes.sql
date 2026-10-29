-- ============================================================
-- Migration: add_user_identity_map_and_indexes
-- Purpose: Phase 1 auth bridge — maps legacy integer user IDs
-- to future Supabase Auth UUIDs. RLS is NOT enabled here.
-- auth_user_id is nullable until real Auth users are created.
-- ============================================================

begin;

-- ── 1. Identity bridge table ─────────────────────────────────
-- Maps each public.users(id) to a future auth.users(id) UUID.
-- auth_user_id stays NULL until the user signs in or is invited.
create table if not exists public.user_identity_map (
  legacy_user_id  integer     primary key references public.users(id) on delete cascade,
  auth_user_id    uuid        unique,           -- NULL until migrated
  role            text        not null default 'student'
                              check (role in ('student', 'instructor', 'admin')),
  is_active       boolean     not null default true,
  migrated_at     timestamptz,                  -- set when auth_user_id is populated
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── 2. Pre-populate from existing public.users ───────────────
insert into public.user_identity_map (legacy_user_id, role, is_active)
select
  u.id,
  case
    when lower(coalesce(u.role,'student')) in ('student','instructor','admin')
      then lower(u.role)
    else 'student'
  end,
  coalesce(u.active, 1) = 1
from public.users u
on conflict (legacy_user_id) do update
  set
    role      = excluded.role,
    is_active = excluded.is_active;

-- ── 3. updated_at trigger ────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists uim_set_updated_at on public.user_identity_map;
create trigger uim_set_updated_at
  before update on public.user_identity_map
  for each row execute procedure public.set_updated_at();

-- ── 4. Indexes ───────────────────────────────────────────────
create index if not exists idx_uim_auth_user_id         on public.user_identity_map(auth_user_id);
create index if not exists idx_uim_role                 on public.user_identity_map(role);
create index if not exists idx_courses_instructor_id    on public.courses(instructor_id);
create index if not exists idx_enrollments_student      on public.enrollments(student_id);
create index if not exists idx_enrollments_course       on public.enrollments(course_id);
create index if not exists idx_enrollments_student_course on public.enrollments(student_id, course_id);
create index if not exists idx_modules_course_id        on public.modules(course_id);
create index if not exists idx_materials_module_id      on public.materials(module_id);
create index if not exists idx_assignments_module_id    on public.assignments(module_id);
create index if not exists idx_submissions_student_id   on public.submissions(student_id);
create index if not exists idx_submissions_assignment_id on public.submissions(assignment_id);
create index if not exists idx_sub_files_submission_id  on public.submission_files(submission_id);
create index if not exists idx_notes_student_id         on public.notes(student_id);
create index if not exists idx_notes_module_id          on public.notes(module_id);
create index if not exists idx_note_chunks_note_id      on public.note_chunks(note_id);

-- ── 5. Helper functions for RLS (ready but not yet in use) ───
-- Returns the legacy integer user ID for the authenticated caller.
create or replace function public.current_legacy_user_id()
returns integer language sql stable as $$
  select uim.legacy_user_id
  from   public.user_identity_map uim
  where  uim.auth_user_id = (select auth.uid())
$$;

-- Returns the role string for the authenticated caller.
create or replace function public.current_user_role()
returns text language sql stable as $$
  select uim.role
  from   public.user_identity_map uim
  where  uim.auth_user_id = (select auth.uid())
$$;

-- TRUE when caller is an admin.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((select public.current_user_role()) = 'admin', false)
$$;

-- TRUE when caller is the instructor for a given course.
create or replace function public.is_instructor_for_course(p_course_id integer)
returns boolean language sql stable as $$
  select exists (
    select 1
    from   public.courses c
    where  c.id = p_course_id
      and  c.instructor_id = (select public.current_legacy_user_id())
  )
$$;

-- TRUE when caller (student) is enrolled in a given course.
create or replace function public.is_enrolled_in_course(p_course_id integer)
returns boolean language sql stable as $$
  select exists (
    select 1
    from   public.enrollments e
    where  e.course_id = p_course_id
      and  e.student_id = (select public.current_legacy_user_id())
  )
$$;

-- TRUE when caller can access a given module
-- (admin OR instructor of parent course OR enrolled student).
create or replace function public.can_access_module(p_module_id integer)
returns boolean language sql stable as $$
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

-- ── NEXT STEPS (do NOT run yet) ──────────────────────────────
-- 1. Invite / sign up each user in public.users via Supabase Auth.
-- 2. After auth_user_id is known, run:
--    UPDATE public.user_identity_map
--    SET auth_user_id = '<uuid>', migrated_at = now()
--    WHERE legacy_user_id = <id>;
-- 3. Apply the follow-up migration: enable_rls_and_add_policies
-- ─────────────────────────────────────────────────────────────
