-- A second college for the tenant-isolation checks (e2e/tenancy.mjs). Only ever
-- applied to the throwaway CI database; the passwords are test values.

insert into public.institutions (id, name, slug) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'Other College', 'other') on conflict do nothing;
insert into public.users (id, name, email, role, active) values
 (101,'Bob Admin','admin@other.test','admin',1),(102,'Prof Other','prof@other.test','instructor',1),(103,'Stu Other','stu@other.test','student',1)
 on conflict (id) do nothing;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at) values
 ('bbbb0000-0000-4000-8000-000000000101','authenticated','authenticated','admin@other.test',extensions.crypt('Other-pass-1',extensions.gen_salt('bf')),now()),
 ('bbbb0000-0000-4000-8000-000000000102','authenticated','authenticated','prof@other.test', extensions.crypt('Other-pass-1',extensions.gen_salt('bf')),now()),
 ('bbbb0000-0000-4000-8000-000000000103','authenticated','authenticated','stu@other.test',  extensions.crypt('Other-pass-1',extensions.gen_salt('bf')),now());
insert into public.user_identity_map (legacy_user_id, auth_user_id, role, force_password_change) values
 (101,'bbbb0000-0000-4000-8000-000000000101','admin',false),(102,'bbbb0000-0000-4000-8000-000000000102','instructor',false),(103,'bbbb0000-0000-4000-8000-000000000103','student',false)
 on conflict (legacy_user_id) do update set auth_user_id=excluded.auth_user_id, role=excluded.role, force_password_change=false, is_active=true;
delete from public.institution_members where user_id in (101,102,103);
insert into public.institution_members (institution_id, user_id, role) values
 ('bbbbbbbb-0000-4000-8000-00000000000b',101,'institution_admin'),('bbbbbbbb-0000-4000-8000-00000000000b',102,'instructor'),('bbbbbbbb-0000-4000-8000-00000000000b',103,'student');
insert into public.courses (id, code, name, instructor_id, institution_id) values (901,'OTH101','Other Course',102,'bbbbbbbb-0000-4000-8000-00000000000b');
insert into public.enrollments (course_id, student_id) values (901,103);
insert into public.modules (id, course_id, name, content, display_order, institution_id) values (901,901,'Other Module','secret module content',1,'bbbbbbbb-0000-4000-8000-00000000000b');
insert into public.notes (id, student_id, module_id, filename, original_name, content_text, file_type, uploaded_by, institution_id, processing_status) values (901,103,901,'x.txt','other-secret.txt','TENANT-B-SECRET-NOTE','text/plain',103,'bbbbbbbb-0000-4000-8000-00000000000b','ready');
insert into public.assignments (id, module_id, title, description, max_points, status, institution_id) values (901,901,'Other Assignment','desc',10,'published','bbbbbbbb-0000-4000-8000-00000000000b');
insert into public.submissions (id, assignment_id, student_id, content, institution_id) values (901,901,103,'TENANT-B-SECRET-SUBMISSION','bbbbbbbb-0000-4000-8000-00000000000b');

