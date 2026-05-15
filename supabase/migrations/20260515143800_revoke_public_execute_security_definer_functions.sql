-- Revoke EXECUTE from public role on SECURITY DEFINER functions
-- Prevents anon and authenticated from calling these via /rest/v1/rpc/
revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.sync_user_role_to_identity_map() from public;
