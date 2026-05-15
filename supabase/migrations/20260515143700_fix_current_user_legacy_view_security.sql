-- Drop and recreate current_user_legacy as SECURITY INVOKER
-- (removes SECURITY DEFINER advisory error)
drop view if exists public.current_user_legacy;

create or replace view public.current_user_legacy
  with (security_invoker = true)
as
  select
    legacy_user_id,
    role,
    auth_user_id
  from public.user_identity_map uim
  where auth_user_id = auth.uid()
    and is_active = true;
