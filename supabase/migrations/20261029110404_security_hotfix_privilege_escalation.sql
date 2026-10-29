-- Security hotfix: privilege escalation and storage exposure via PostgREST.
--
-- Verified on 2026-10-29 (in rolled-back transactions) that an authenticated
-- student, using only the public anon key and their own session, could:
--   1. UPDATE their own public.users row and set role = 'admin'; the
--      SECURITY DEFINER trigger sync_user_role_to_identity_map then copies
--      it into user_identity_map, which the API trusts for authorization.
--   2. List and read every object in the learnit-notes and
--      learnit-submissions buckets (bucket-wide SELECT policies).
-- Also fixed:
--   3. submissions_update lets a student update their own submission's
--      grade/feedback/ai_* columns (currently masked only by an unrelated
--      RLS recursion error on courses).
--   4. handle_new_auth_user re-pointed an EXISTING users row (matched by
--      email) at any newly created auth user, so a sign-up using an existing
--      user's email could take over that account.
--
-- The browser never writes to these tables through PostgREST (all writes go
-- through the API, which connects as the postgres role and is unaffected).

begin;

-- 1. users: authenticated users may edit only harmless profile fields.
revoke insert, update, delete on table public.users from anon, authenticated;
grant update (name, major, year) on table public.users to authenticated;

-- 3. submissions: students may edit only their submission content.
revoke update, delete on table public.submissions from anon, authenticated;
grant update (content) on table public.submissions to authenticated;

-- user_identity_map holds roles: never writable from the client.
revoke insert, update, delete on table public.user_identity_map from anon, authenticated;

-- 2. storage: no direct client reads. Files are served only through
-- API-issued short-lived signed URLs after server-side authorization.
drop policy if exists "authenticated read notes" on storage.objects;
drop policy if exists "authenticated read submissions" on storage.objects;

-- 4. Never re-point an existing identity mapping at a new auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_legacy_id integer;
  v_user_name text;
begin
  v_user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  insert into public.users (name, email, role, active)
  values (v_user_name, lower(new.email), 'student', 1)
  on conflict (email) do nothing;

  select id into v_legacy_id from public.users where lower(email) = lower(new.email);
  if v_legacy_id is null then
    return new;
  end if;

  -- DO NOTHING (was DO UPDATE SET auth_user_id = ...): an existing mapping is
  -- never transferred to a different auth account.
  insert into public.user_identity_map (legacy_user_id, auth_user_id, role, is_active)
  select v_legacy_id, new.id, u.role, (u.active = 1)
  from public.users u
  where u.id = v_legacy_id
  on conflict (legacy_user_id) do nothing;

  return new;
end;
$function$;

-- SECURITY DEFINER functions must not resolve names via a mutable search_path.
alter function public.sync_user_role_to_identity_map() set search_path = '';

commit;
