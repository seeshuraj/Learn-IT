-- Test accounts and a small course for the end-to-end run. Only ever applied
-- to the throwaway CI database. The passwords are test values for this run.

update public.users set email = 'admin@e2e.test',      name = 'Asha Admin'     where id = 1;
update public.users set email = 'sarah@e2e.test',      name = 'Sarah Johnson'  where id = 2;
update public.users set email = 'michael@e2e.test',    name = 'Michael Chen'   where id = 3;
update public.users set email = 'professor@e2e.test',  name = 'Dr. Aris'       where id = 4;

delete from auth.users where email in ('admin@e2e.test', 'sarah@e2e.test', 'michael@e2e.test', 'professor@e2e.test');
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at) values
  ('e2e00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@e2e.test',     extensions.crypt('E2e-admin-pass1', extensions.gen_salt('bf')), now()),
  ('e2e00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sarah@e2e.test',     extensions.crypt('E2e-student-pass1', extensions.gen_salt('bf')), now()),
  ('e2e00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'michael@e2e.test',   extensions.crypt('E2e-student-pass2', extensions.gen_salt('bf')), now()),
  ('e2e00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'professor@e2e.test', extensions.crypt('E2e-prof-pass1', extensions.gen_salt('bf')), now());

insert into public.user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
values (1, 'e2e00000-0000-4000-8000-000000000001', 'admin', false),
       (2, 'e2e00000-0000-4000-8000-000000000002', 'student', false),
       (3, 'e2e00000-0000-4000-8000-000000000003', 'student', false),
       (4, 'e2e00000-0000-4000-8000-000000000004', 'instructor', false)
on conflict (legacy_user_id) do update
  set auth_user_id = excluded.auth_user_id, role = excluded.role, force_password_change = false, is_active = true;

-- Course placement: Database Systems in CSE, semester 5, Sarah and Michael enrolled.
update public.courses set department_id = (select id from public.departments where code = 'COMPUTERSCIENCE'), semester = 5 where id = 2;
insert into public.enrollments (course_id, student_id) values (2, 2), (2, 3) on conflict do nothing;

-- A course Sarah is not enrolled in, for access checks.
insert into public.courses (code, name, instructor_id, institution_id)
select 'ME2001', 'Engineering Drawing', null, institution_id from public.courses where id = 2
on conflict (code) do nothing;
