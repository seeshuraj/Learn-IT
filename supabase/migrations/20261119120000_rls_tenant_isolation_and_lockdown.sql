-- RLS repair, tenant isolation and PostgREST lockdown.
--
-- Before:
--   * The RLS helpers (is_admin, current_user_role, current_legacy_user_id, ...)
--     ran as the caller, so evaluating a policy re-entered the same table's
--     policy: every query by a signed-in user through PostgREST failed with
--     "infinite recursion detected in policy" or "stack depth limit exceeded".
--   * courses_select and enrollments_* referenced each other through RLS-checked
--     subqueries (a second recursion).
--   * No policy checked institution_id, and is_admin() was true for an admin of
--     any college, so fixing the recursion alone would have let one college's
--     admin read every college's rows.
--   * anon and authenticated kept Supabase's default table privileges
--     (including TRUNCATE, which RLS does not cover), and new tables inherited them.
--
-- After:
--   * Helpers are SECURITY DEFINER (owner bypasses RLS): no recursion.
--   * Every policy-bearing table has a RESTRICTIVE tenant policy, so all access
--     by the authenticated role is limited to the caller's own college.
--   * anon and authenticated have no table or sequence privileges in public,
--     now or for future tables. The frontend never reads tables through
--     PostgREST (it uses Supabase only for Auth), and the API connects as the
--     table owner, so nothing in the app depends on these privileges. RLS stays
--     enabled as the second layer if a grant is ever re-added.

-- ── Tenant helpers ──────────────────────────────────────────────────────────
create or replace function private.is_member_of(p_institution_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.institution_members im
    where im.institution_id = p_institution_id
      and im.user_id = (select private.current_user_id())
      and im.status = 'active'
  )
$$;

create or replace function private.shares_institution_with(p_user_id integer)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institution_members me
    join public.institution_members them on them.institution_id = me.institution_id
    where me.user_id = (select private.current_user_id())
      and me.status = 'active'
      and them.user_id = p_user_id
  )
$$;

revoke all on function private.is_member_of(uuid) from public, anon;
revoke all on function private.shares_institution_with(integer) from public, anon;
grant execute on function private.is_member_of(uuid) to authenticated;
grant execute on function private.shares_institution_with(integer) to authenticated;

-- ── Stop the recursion: helpers read their tables as the owner ──────────────
alter function public.current_user_role()             security definer;
alter function public.current_legacy_user_id()        security definer;
alter function public.is_admin()                      security definer;
alter function public.is_instructor_for_course(integer) security definer;
alter function public.is_enrolled_in_course(integer)  security definer;
alter function public.can_access_module(integer)      security definer;

revoke execute on function public.current_user_role()              from public, anon;
revoke execute on function public.current_legacy_user_id()         from public, anon;
revoke execute on function public.is_admin()                       from public, anon;
revoke execute on function public.is_instructor_for_course(integer) from public, anon;
revoke execute on function public.is_enrolled_in_course(integer)   from public, anon;
revoke execute on function public.can_access_module(integer)       from public, anon;
grant execute on function public.current_user_role()              to authenticated;
grant execute on function public.current_legacy_user_id()         to authenticated;
grant execute on function public.is_admin()                       to authenticated;
grant execute on function public.is_instructor_for_course(integer) to authenticated;
grant execute on function public.is_enrolled_in_course(integer)   to authenticated;
grant execute on function public.can_access_module(integer)       to authenticated;

-- ── courses <-> enrollments: use the helpers instead of RLS-checked subqueries
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated
  using (
    (select public.is_admin())
    or instructor_id = (select public.current_legacy_user_id())
    or public.is_enrolled_in_course(id)
  );

drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments for select to authenticated
  using (
    (select public.is_admin())
    or student_id = (select public.current_legacy_user_id())
    or public.is_instructor_for_course(course_id)
  );

drop policy if exists enrollments_insert on public.enrollments;
create policy enrollments_insert on public.enrollments for insert to authenticated
  with check ((select public.is_admin()) or public.is_instructor_for_course(course_id));

drop policy if exists enrollments_delete on public.enrollments;
create policy enrollments_delete on public.enrollments for delete to authenticated
  using ((select public.is_admin()) or public.is_instructor_for_course(course_id));

-- ── note_chunks: one SELECT policy (the ALL policy duplicated it) ───────────
drop policy if exists note_chunks_manage on public.note_chunks;
do $$
declare
  cmd text;
  manage_expr constant text := $e$
    note_id in (
      select n.id from public.notes n
      join public.modules m on m.id = n.module_id
      join public.courses c on c.id = m.course_id
      where (select public.is_admin())
         or c.instructor_id = (select public.current_legacy_user_id())
    )$e$;
begin
  foreach cmd in array array['insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on public.note_chunks', 'note_chunks_' || cmd);
    if cmd = 'insert' then
      execute format('create policy %I on public.note_chunks for insert to authenticated with check (%s)', 'note_chunks_' || cmd, manage_expr);
    elsif cmd = 'update' then
      execute format('create policy %I on public.note_chunks for update to authenticated using (%s) with check (%s)', 'note_chunks_' || cmd, manage_expr, manage_expr);
    else
      execute format('create policy %I on public.note_chunks for delete to authenticated using (%s)', 'note_chunks_' || cmd, manage_expr);
    end if;
  end loop;
end $$;

-- ── Tenant isolation: RESTRICTIVE policies are ANDed with every other policy
do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'institution_id'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated
         using (private.is_member_of(institution_id))
         with check (private.is_member_of(institution_id))', t);
  end loop;
end $$;

-- users and user_identity_map carry no institution_id: scope by membership.
drop policy if exists tenant_isolation on public.users;
create policy tenant_isolation on public.users as restrictive for all to authenticated
  using (id = (select private.current_user_id()) or private.shares_institution_with(id))
  with check (id = (select private.current_user_id()) or private.shares_institution_with(id));

drop policy if exists tenant_isolation on public.user_identity_map;
create policy tenant_isolation on public.user_identity_map as restrictive for all to authenticated
  using (legacy_user_id = (select private.current_user_id()) or private.shares_institution_with(legacy_user_id))
  with check (legacy_user_id = (select private.current_user_id()) or private.shares_institution_with(legacy_user_id));

-- ── PostgREST lockdown ─────────────────────────────────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
