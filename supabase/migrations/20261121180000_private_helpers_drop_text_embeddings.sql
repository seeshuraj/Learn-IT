-- 1. Permission helpers out of the exposed API schema.
--
-- The RLS helpers (current_user_role, is_admin, …) are SECURITY DEFINER and
-- were callable by any signed-in user through /rest/v1/rpc/*. They only
-- answer about the caller, but nothing outside the database needs them. Move
-- them to `private`, which PostgREST does not expose. Policies reference
-- functions by OID, so every policy keeps working unchanged; `authenticated`
-- keeps EXECUTE so RLS still evaluates if a table grant is ever re-added
-- (e2e/tenancy.mjs checks that layer).

alter function public.current_user_role()               set schema private;
alter function public.current_legacy_user_id()          set schema private;
alter function public.is_admin()                        set schema private;
alter function public.is_instructor_for_course(integer) set schema private;
alter function public.is_enrolled_in_course(integer)    set schema private;
alter function public.can_access_module(integer)        set schema private;

-- Bodies that call one another by name now name the new schema.
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select private.current_user_role()) = 'admin', false)
$$;

create or replace function private.is_enrolled_in_course(p_course_id integer)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id
      and e.student_id = (select private.current_legacy_user_id())
  )
$$;

create or replace function private.is_instructor_for_course(p_course_id integer)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id
      and c.instructor_id = (select private.current_legacy_user_id())
  )
$$;

create or replace function private.can_access_module(p_module_id integer)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.modules m
    where m.id = p_module_id
      and (
        (select private.is_admin())
        or (select private.is_instructor_for_course(m.course_id))
        or (select private.is_enrolled_in_course(m.course_id))
      )
  )
$$;

-- 2. Drop the text copy of chunk embeddings.
--
-- 20261113120000 moved search to note_chunks.embedding_vec (halfvec) and kept
-- the JSON-text `embedding` only until the code stopped writing it, which it
-- has. The text copy is ~7x the size of the halfvec and would push the
-- database past its plan at a few thousand notes. Nothing reads it.

do $$
begin
  if exists (select 1 from public.note_chunks where embedding_vec is null and embedding is not null) then
    raise exception 'note_chunks rows without embedding_vec: backfill before dropping embedding';
  end if;
end $$;

drop trigger if exists note_chunks_sync_embedding_vec on public.note_chunks;
drop function if exists public.note_chunks_sync_embedding_vec();
alter table public.note_chunks drop column if exists embedding;

-- 3. Submission files: 25 MB per file (the API also caps a submission at
-- 25 MB in total across at most 5 files).
update storage.buckets set file_size_limit = 26214400 where id = 'learnit-submissions';
