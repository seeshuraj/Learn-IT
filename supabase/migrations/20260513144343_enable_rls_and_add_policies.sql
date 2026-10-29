-- ============================================================
-- Migration: enable_rls_and_add_policies
-- Enables RLS on all 11 public tables and adds role-scoped
-- policies for student / instructor / admin.
-- Depends on: user_identity_map, helper functions from
--             add_user_identity_map_and_indexes migration.
-- ============================================================

begin;

-- ============================================================
-- ENABLE RLS
-- ============================================================
alter table public.user_identity_map   enable row level security;
alter table public.users               enable row level security;
alter table public.courses             enable row level security;
alter table public.enrollments         enable row level security;
alter table public.modules             enable row level security;
alter table public.materials           enable row level security;
alter table public.assignments         enable row level security;
alter table public.submissions         enable row level security;
alter table public.submission_files    enable row level security;
alter table public.notes               enable row level security;
alter table public.note_chunks         enable row level security;
alter table public.settings            enable row level security;

-- ============================================================
-- TABLE: user_identity_map
-- Users see only their own row; admin sees all.
-- ============================================================
drop policy if exists uim_select on public.user_identity_map;
create policy uim_select
on public.user_identity_map for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists uim_update on public.user_identity_map;
create policy uim_update
on public.user_identity_map for update
to authenticated
using  ((select public.is_admin()))
with check ((select public.is_admin()));

-- ============================================================
-- TABLE: users
-- Own row only for read/update; admin full access.
-- No direct insert/delete from client — managed server-side.
-- ============================================================
drop policy if exists users_select on public.users;
create policy users_select
on public.users for select
to authenticated
using (
  id = (select public.current_legacy_user_id())
  or (select public.is_admin())
);

drop policy if exists users_update on public.users;
create policy users_update
on public.users for update
to authenticated
using  (id = (select public.current_legacy_user_id()) or (select public.is_admin()))
with check (id = (select public.current_legacy_user_id()) or (select public.is_admin()));

-- ============================================================
-- TABLE: courses
-- Visible to: enrolled students, owning instructor, admin.
-- Mutable by: owning instructor, admin.
-- ============================================================
drop policy if exists courses_select on public.courses;
create policy courses_select
on public.courses for select
to authenticated
using (
  (select public.is_admin())
  or instructor_id = (select public.current_legacy_user_id())
  or id in (
      select e.course_id
      from   public.enrollments e
      where  e.student_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists courses_insert on public.courses;
create policy courses_insert
on public.courses for insert
to authenticated
with check (
  (select public.is_admin())
  or instructor_id = (select public.current_legacy_user_id())
);

drop policy if exists courses_update on public.courses;
create policy courses_update
on public.courses for update
to authenticated
using  ((select public.is_admin()) or instructor_id = (select public.current_legacy_user_id()))
with check ((select public.is_admin()) or instructor_id = (select public.current_legacy_user_id()));

drop policy if exists courses_delete on public.courses;
create policy courses_delete
on public.courses for delete
to authenticated
using ((select public.is_admin()));

-- ============================================================
-- TABLE: enrollments
-- Student sees own rows; instructor sees rows for own courses;
-- admin sees all. Insert/delete managed by instructor or admin.
-- ============================================================
drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select
on public.enrollments for select
to authenticated
using (
  (select public.is_admin())
  or student_id = (select public.current_legacy_user_id())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists enrollments_insert on public.enrollments;
create policy enrollments_insert
on public.enrollments for insert
to authenticated
with check (
  (select public.is_admin())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists enrollments_delete on public.enrollments;
create policy enrollments_delete
on public.enrollments for delete
to authenticated
using (
  (select public.is_admin())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: modules
-- Readable by enrolled students, owning instructor, admin.
-- Mutable by owning instructor or admin.
-- ============================================================
drop policy if exists modules_select on public.modules;
create policy modules_select
on public.modules for select
to authenticated
using ((select public.can_access_module(id)));

drop policy if exists modules_insert on public.modules;
create policy modules_insert
on public.modules for insert
to authenticated
with check (
  (select public.is_admin())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists modules_update on public.modules;
create policy modules_update
on public.modules for update
to authenticated
using (
  (select public.is_admin())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  (select public.is_admin())
  or course_id in (
      select c.id from public.courses c
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists modules_delete on public.modules;
create policy modules_delete
on public.modules for delete
to authenticated
using ((select public.is_admin()));

-- ============================================================
-- TABLE: materials
-- Same visibility as their parent module.
-- ============================================================
drop policy if exists materials_select on public.materials;
create policy materials_select
on public.materials for select
to authenticated
using ((select public.can_access_module(module_id)));

drop policy if exists materials_insert on public.materials;
create policy materials_insert
on public.materials for insert
to authenticated
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists materials_update on public.materials;
create policy materials_update
on public.materials for update
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists materials_delete on public.materials;
create policy materials_delete
on public.materials for delete
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: assignments
-- Same visibility as parent module.
-- ============================================================
drop policy if exists assignments_select on public.assignments;
create policy assignments_select
on public.assignments for select
to authenticated
using ((select public.can_access_module(module_id)));

drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert
on public.assignments for insert
to authenticated
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists assignments_update on public.assignments;
create policy assignments_update
on public.assignments for update
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists assignments_delete on public.assignments;
create policy assignments_delete
on public.assignments for delete
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: submissions
-- Student: own rows only (select + insert + update own draft).
-- Instructor: select + update (grading) for own course submissions.
-- Admin: full.
-- ============================================================
drop policy if exists submissions_select on public.submissions;
create policy submissions_select
on public.submissions for select
to authenticated
using (
  (select public.is_admin())
  or student_id = (select public.current_legacy_user_id())
  or assignment_id in (
      select a.id from public.assignments a
      join   public.modules m on m.id = a.module_id
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert
on public.submissions for insert
to authenticated
with check (
  student_id = (select public.current_legacy_user_id())
  and assignment_id in (
      select a.id from public.assignments a
      join   public.modules m on m.id = a.module_id
      join   public.enrollments e on e.course_id = m.course_id
      where  e.student_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists submissions_update on public.submissions;
create policy submissions_update
on public.submissions for update
to authenticated
using (
  (select public.is_admin())
  or student_id = (select public.current_legacy_user_id())
  or assignment_id in (
      select a.id from public.assignments a
      join   public.modules m on m.id = a.module_id
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  (select public.is_admin())
  or student_id = (select public.current_legacy_user_id())
  or assignment_id in (
      select a.id from public.assignments a
      join   public.modules m on m.id = a.module_id
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists submissions_delete on public.submissions;
create policy submissions_delete
on public.submissions for delete
to authenticated
using ((select public.is_admin()));

-- ============================================================
-- TABLE: submission_files
-- Mirrors access of the parent submission.
-- ============================================================
drop policy if exists sub_files_select on public.submission_files;
create policy sub_files_select
on public.submission_files for select
to authenticated
using (
  submission_id in (
      select s.id from public.submissions s
      where
        (select public.is_admin())
        or s.student_id = (select public.current_legacy_user_id())
        or s.assignment_id in (
            select a.id from public.assignments a
            join   public.modules m on m.id = a.module_id
            join   public.courses c on c.id = m.course_id
            where  c.instructor_id = (select public.current_legacy_user_id())
        )
  )
);

drop policy if exists sub_files_insert on public.submission_files;
create policy sub_files_insert
on public.submission_files for insert
to authenticated
with check (
  submission_id in (
      select s.id from public.submissions s
      where  s.student_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists sub_files_delete on public.submission_files;
create policy sub_files_delete
on public.submission_files for delete
to authenticated
using (
  (select public.is_admin())
  or submission_id in (
      select s.id from public.submissions s
      where  s.student_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: notes
-- Readable by anyone who can access the module.
-- Mutable by instructor of parent course or admin.
-- ============================================================
drop policy if exists notes_select on public.notes;
create policy notes_select
on public.notes for select
to authenticated
using ((select public.can_access_module(module_id)));

drop policy if exists notes_insert on public.notes;
create policy notes_insert
on public.notes for insert
to authenticated
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists notes_update on public.notes;
create policy notes_update
on public.notes for update
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

drop policy if exists notes_delete on public.notes;
create policy notes_delete
on public.notes for delete
to authenticated
using (
  (select public.is_admin())
  or module_id in (
      select m.id from public.modules m
      join   public.courses c on c.id = m.course_id
      where  c.instructor_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: note_chunks
-- Mirrors visibility of the parent note.
-- Backend service role manages insert/update (embedding pipeline).
-- ============================================================
drop policy if exists note_chunks_select on public.note_chunks;
create policy note_chunks_select
on public.note_chunks for select
to authenticated
using (
  note_id in (
      select n.id from public.notes n
      where  (select public.can_access_module(n.module_id))
  )
);

drop policy if exists note_chunks_manage on public.note_chunks;
create policy note_chunks_manage
on public.note_chunks for all
to authenticated
using (
  note_id in (
      select n.id from public.notes n
      join   public.modules m on m.id = n.module_id
      join   public.courses c on c.id = m.course_id
      where  (select public.is_admin())
          or c.instructor_id = (select public.current_legacy_user_id())
  )
)
with check (
  note_id in (
      select n.id from public.notes n
      join   public.modules m on m.id = n.module_id
      join   public.courses c on c.id = m.course_id
      where  (select public.is_admin())
          or c.instructor_id = (select public.current_legacy_user_id())
  )
);

-- ============================================================
-- TABLE: settings
-- Admin only — no client reads or writes for other roles.
-- ============================================================
drop policy if exists settings_admin_only on public.settings;
create policy settings_admin_only
on public.settings for all
to authenticated
using  ((select public.is_admin()))
with check ((select public.is_admin()));

commit;
