-- ============================================================
-- Migration: create_auth_users_and_backfill_identity_map
-- Creates Supabase Auth users for all 4 legacy app users,
-- then backfills user_identity_map.auth_user_id.
-- Passwords are temporary — users should reset on first login.
-- ============================================================

begin;

-- Insert the 4 users directly into auth.users
-- UUIDs are deterministic so the backfill below is safe to re-run
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  (
    'a1000001-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '<redacted-email>',
    crypt('<redacted>', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Admin User","legacy_role":"admin"}',
    now(), now(), '', '', '', ''
  ),
  (
    'a1000001-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '<redacted-email>',
    crypt('<redacted>', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Sarah Johnson","legacy_role":"student"}',
    now(), now(), '', '', '', ''
  ),
  (
    'a1000001-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '<redacted-email>',
    crypt('<redacted>', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Michael Chen","legacy_role":"student"}',
    now(), now(), '', '', '', ''
  ),
  (
    'a1000001-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    '<redacted-email>',
    crypt('<redacted>', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Dr. Aris","legacy_role":"instructor"}',
    now(), now(), '', '', '', ''
  )
on conflict (id) do nothing;

-- Also insert identity rows (required for Supabase Auth to work correctly)
insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    'a1000001-0000-0000-0000-000000000001',
    'a1000001-0000-0000-0000-000000000001',
    '<redacted-email>',
    'email',
    '<redacted-email>',
    now(), now(), now()
  ),
  (
    'a1000001-0000-0000-0000-000000000002',
    'a1000001-0000-0000-0000-000000000002',
    '<redacted-email>',
    'email',
    '<redacted-email>',
    now(), now(), now()
  ),
  (
    'a1000001-0000-0000-0000-000000000003',
    'a1000001-0000-0000-0000-000000000003',
    '<redacted-email>',
    'email',
    '<redacted-email>',
    now(), now(), now()
  ),
  (
    'a1000001-0000-0000-0000-000000000004',
    'a1000001-0000-0000-0000-000000000004',
    '<redacted-email>',
    'email',
    '<redacted-email>',
    now(), now(), now()
  )
on conflict (provider, provider_id) do nothing;

-- Backfill user_identity_map with the known UUIDs
update public.user_identity_map set
  auth_user_id = 'a1000001-0000-0000-0000-000000000001',
  migrated_at  = now()
where legacy_user_id = 1;

update public.user_identity_map set
  auth_user_id = 'a1000001-0000-0000-0000-000000000002',
  migrated_at  = now()
where legacy_user_id = 2;

update public.user_identity_map set
  auth_user_id = 'a1000001-0000-0000-0000-000000000003',
  migrated_at  = now()
where legacy_user_id = 3;

update public.user_identity_map set
  auth_user_id = 'a1000001-0000-0000-0000-000000000004',
  migrated_at  = now()
where legacy_user_id = 4;

commit;
