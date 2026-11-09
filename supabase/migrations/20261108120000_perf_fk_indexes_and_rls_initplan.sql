-- Performance tuning (advisor findings, 2026-11-08). No data changes.
--
-- 1. Indexes for every foreign key without one. Most are the composite
--    (parent_id, institution_id) tenancy keys, so these also serve the
--    common "rows of X in this college" lookups and make deletes of parent
--    rows cheap.
-- 2. RLS policies called auth.uid() once per row. Wrapping it in a scalar
--    sub-select makes Postgres evaluate it once per statement
--    (https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
--    The conditions are otherwise identical.
-- 3. uim_select_own is fully covered by uim_select (own row OR admin); two
--    permissive SELECT policies are both evaluated on every read.

-- 1 ── Foreign-key indexes ──────────────────────────────────────────────────
create index if not exists idx_assignments_module_tenant_fk           on public.assignments (module_id, institution_id);
create index if not exists idx_course_snapshots_course_tenant_fk      on public.course_analytics_snapshots (course_id, institution_id);
create index if not exists idx_courses_instructor_tenant_fk           on public.courses (instructor_id, institution_id);
create index if not exists idx_enrollments_course_tenant_fk           on public.enrollments (course_id, institution_id);
create index if not exists idx_enrollments_student_tenant_fk          on public.enrollments (student_id, institution_id);
create index if not exists idx_materials_module_tenant_fk             on public.materials (module_id, institution_id);
create index if not exists idx_modules_course_tenant_fk               on public.modules (course_id, institution_id);
create index if not exists idx_note_chunks_note_tenant_fk             on public.note_chunks (note_id, institution_id);
create index if not exists idx_notes_module_tenant_fk                 on public.notes (module_id, institution_id);
create index if not exists idx_notes_uploader_tenant_fk               on public.notes (uploaded_by, institution_id);
create index if not exists idx_notifications_user_tenant_fk           on public.notifications (user_id, institution_id);
create index if not exists idx_roadmap_milestones_roadmap_tenant_fk   on public.roadmap_milestones (roadmap_id, institution_id);
create index if not exists idx_student_roadmaps_course_tenant_fk      on public.student_roadmaps (course_id, institution_id);
create index if not exists idx_student_roadmaps_student_tenant_fk     on public.student_roadmaps (student_id, institution_id);
create index if not exists idx_submission_files_submission_tenant_fk  on public.submission_files (submission_id, institution_id);
create index if not exists idx_submissions_assignment_tenant_fk       on public.submissions (assignment_id, institution_id);
create index if not exists idx_submissions_student_tenant_fk          on public.submissions (student_id, institution_id);
create index if not exists idx_unit_exam_imports_exam_tenant_fk       on public.unit_exam_imports (unit_exam_id, institution_id);
create index if not exists idx_unit_exam_imports_imported_by_fkey     on public.unit_exam_imports (imported_by);
create index if not exists idx_unit_exam_results_exam_tenant_fk       on public.unit_exam_results (unit_exam_id, institution_id);
create index if not exists idx_unit_exam_results_student_tenant_fk    on public.unit_exam_results (student_id, institution_id);
create index if not exists idx_unit_exam_topics_exam_tenant_fk        on public.unit_exam_topic_analysis (unit_exam_id, institution_id);
create index if not exists idx_unit_exams_course_tenant_fk            on public.unit_exams (course_id, institution_id);
create index if not exists idx_unit_exams_created_by_fkey             on public.unit_exams (created_by);

-- 2 ── auth.uid() evaluated once per statement ──────────────────────────────
alter policy user_own_notifications_select on public.notifications
  using (user_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));
alter policy user_own_notifications_update on public.notifications
  using      (user_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())))
  with check (user_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));

alter policy student_own_roadmaps_select on public.student_roadmaps
  using (student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));
alter policy student_own_roadmaps_insert on public.student_roadmaps
  with check (student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));
alter policy student_own_roadmaps_update on public.student_roadmaps
  using      (student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())))
  with check (student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));
alter policy student_own_roadmaps_delete on public.student_roadmaps
  using (student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())));

alter policy student_own_milestones_select on public.roadmap_milestones
  using (roadmap_id in (select sr.id from public.student_roadmaps sr
         where sr.student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid()))));
alter policy student_own_milestones_insert on public.roadmap_milestones
  with check (roadmap_id in (select sr.id from public.student_roadmaps sr
         where sr.student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid()))));
alter policy student_own_milestones_update on public.roadmap_milestones
  using      (roadmap_id in (select sr.id from public.student_roadmaps sr
              where sr.student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid()))))
  with check (roadmap_id in (select sr.id from public.student_roadmaps sr
              where sr.student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid()))));
alter policy student_own_milestones_delete on public.roadmap_milestones
  using (roadmap_id in (select sr.id from public.student_roadmaps sr
         where sr.student_id = (select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid()))));

-- 3 ── Redundant permissive policy ─────────────────────────────────────────
drop policy if exists uim_select_own on public.user_identity_map;
