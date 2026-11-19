-- Covering indexes for the composite (…, institution_id) foreign keys flagged by
-- the Supabase performance advisor. Without them, deleting or re-keying a
-- parent row (department, course, timetable) scans the child table.
create index if not exists idx_course_announcements_course_tenant_fk
  on public.course_announcements (course_id, institution_id);
create index if not exists idx_courses_department_tenant_fk
  on public.courses (department_id, institution_id);
create index if not exists idx_tt_entries_course_tenant_fk
  on public.exam_timetable_entries (course_id, institution_id);
create index if not exists idx_tt_entries_department_tenant_fk
  on public.exam_timetable_entries (department_id, institution_id);
create index if not exists idx_tt_entries_timetable_tenant_fk
  on public.exam_timetable_entries (timetable_id, institution_id);
create index if not exists idx_members_department_tenant_fk
  on public.institution_members (department_id, institution_id);
