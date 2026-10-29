DO $$
DECLARE
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  uid_admin      uuid := gen_random_uuid();
  uid_sarah      uuid := gen_random_uuid();
  uid_michael    uuid := gen_random_uuid();
  uid_instructor uuid := gen_random_uuid();
BEGIN

  -- 1. Remove placeholder auth rows
  DELETE FROM auth.users
  WHERE id IN (
    'a1000001-0000-0000-0000-000000000001'::uuid,
    'a1000001-0000-0000-0000-000000000002'::uuid,
    'a1000001-0000-0000-0000-000000000003'::uuid,
    'a1000001-0000-0000-0000-000000000004'::uuid
  );

  -- 2. Insert real Supabase Auth users
  INSERT INTO auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES
  (
    v_instance_id, uid_admin, 'authenticated', 'authenticated',
    '<redacted-email>', crypt('<redacted>', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Admin User"}'::jsonb,
    false, '', '', '', ''
  ),
  (
    v_instance_id, uid_instructor, 'authenticated', 'authenticated',
    '<redacted-email>', crypt('<redacted>', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Dr. Aris"}'::jsonb,
    false, '', '', '', ''
  ),
  (
    v_instance_id, uid_sarah, 'authenticated', 'authenticated',
    '<redacted-email>', crypt('<redacted>', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sarah Johnson"}'::jsonb,
    false, '', '', '', ''
  ),
  (
    v_instance_id, uid_michael, 'authenticated', 'authenticated',
    '<redacted-email>', crypt('<redacted>', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Michael Chen"}'::jsonb,
    false, '', '', '', ''
  );

  -- 3. Wire up auth.identities (id column is uuid in newer Supabase versions)
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at, provider_id
  ) VALUES
  (
    uid_admin, uid_admin,
    json_build_object('sub', uid_admin::text, 'email', '<redacted-email>'),
    'email', now(), now(), now(), '<redacted-email>'
  ),
  (
    uid_instructor, uid_instructor,
    json_build_object('sub', uid_instructor::text, 'email', '<redacted-email>'),
    'email', now(), now(), now(), '<redacted-email>'
  ),
  (
    uid_sarah, uid_sarah,
    json_build_object('sub', uid_sarah::text, 'email', '<redacted-email>'),
    'email', now(), now(), now(), '<redacted-email>'
  ),
  (
    uid_michael, uid_michael,
    json_build_object('sub', uid_michael::text, 'email', '<redacted-email>'),
    'email', now(), now(), now(), '<redacted-email>'
  );

  -- 4. Sync user_identity_map with the new real UUIDs (matched by email)
  UPDATE public.user_identity_map uim
  SET auth_user_id = au.id, updated_at = now()
  FROM auth.users au
  JOIN public.users pu ON lower(pu.email) = lower(au.email)
  WHERE uim.legacy_user_id = pu.id;

END;
$$;
