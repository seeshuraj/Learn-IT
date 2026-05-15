-- ===================================
-- Enable RLS on all 6 tables
-- ===================================
alter table public.audit_logs enable row level security;
alter table public.admin_stats_snapshots enable row level security;
alter table public.course_analytics_snapshots enable row level security;
alter table public.student_roadmaps enable row level security;
alter table public.roadmap_milestones enable row level security;
alter table public.notifications enable row level security;

-- ===================================
-- audit_logs: service_role only
-- ===================================
create policy "service_role_audit_logs_all" on public.audit_logs
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- admin_stats_snapshots: service_role only
-- ===================================
create policy "service_role_admin_stats_all" on public.admin_stats_snapshots
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- course_analytics_snapshots: service_role only
-- ===================================
create policy "service_role_course_analytics_all" on public.course_analytics_snapshots
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- student_roadmaps: student owns their rows
-- ===================================
create policy "student_own_roadmaps_select" on public.student_roadmaps
  as permissive for select to authenticated
  using (student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "student_own_roadmaps_insert" on public.student_roadmaps
  as permissive for insert to authenticated
  with check (student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "student_own_roadmaps_update" on public.student_roadmaps
  as permissive for update to authenticated
  using (student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()))
  with check (student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "student_own_roadmaps_delete" on public.student_roadmaps
  as permissive for delete to authenticated
  using (student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "service_role_student_roadmaps_all" on public.student_roadmaps
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- roadmap_milestones: via student_roadmaps
-- ===================================
create policy "student_own_milestones_select" on public.roadmap_milestones
  as permissive for select to authenticated
  using (
    roadmap_id in (
      select id from public.student_roadmaps
      where student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid())
    )
  );

create policy "student_own_milestones_insert" on public.roadmap_milestones
  as permissive for insert to authenticated
  with check (
    roadmap_id in (
      select id from public.student_roadmaps
      where student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid())
    )
  );

create policy "student_own_milestones_update" on public.roadmap_milestones
  as permissive for update to authenticated
  using (
    roadmap_id in (
      select id from public.student_roadmaps
      where student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid())
    )
  )
  with check (
    roadmap_id in (
      select id from public.student_roadmaps
      where student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid())
    )
  );

create policy "student_own_milestones_delete" on public.roadmap_milestones
  as permissive for delete to authenticated
  using (
    roadmap_id in (
      select id from public.student_roadmaps
      where student_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid())
    )
  );

create policy "service_role_roadmap_milestones_all" on public.roadmap_milestones
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- notifications: user owns their rows
-- ===================================
create policy "user_own_notifications_select" on public.notifications
  as permissive for select to authenticated
  using (user_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "user_own_notifications_update" on public.notifications
  as permissive for update to authenticated
  using (user_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()))
  with check (user_id = (select legacy_user_id from public.user_identity_map where auth_user_id = auth.uid()));

create policy "service_role_notifications_all" on public.notifications
  as permissive for all to service_role
  using (true) with check (true);

-- ===================================
-- Revoke public EXECUTE on SECURITY DEFINER functions
-- ===================================
revoke execute on function public.handle_new_auth_user() from anon, authenticated;
revoke execute on function public.sync_user_role_to_identity_map() from anon, authenticated;
