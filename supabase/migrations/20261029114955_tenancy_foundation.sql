-- Phase 1: strict multi-tenancy foundation.
--
-- * institutions + institution_members (sole source of tenant membership and
--   institutional role) + platform_admins (LearnIT staff, not a member role).
-- * institution_id on every tenant-owned table, backfilled to the existing
--   "LearnIT Demo" institution, then NOT NULL.
-- * Composite (id, institution_id) keys on parents and composite foreign keys
--   on children, so a row can never reference a parent (or a user) in another
--   institution. RESTRICT for academic records, CASCADE only for derived data.
-- * BEFORE INSERT triggers inherit institution_id from the parent row, so the
--   API cannot forget or mistype it; the composite FKs reject any mismatch.
-- * private.* helpers for the Phase 2 RLS rewrite.
--
-- users stays global identity (a person may later belong to several
-- institutions); user_identity_map stays the auth bridge.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Institutions, membership, platform admins
-- ═════════════════════════════════════════════════════════════════════════
create table public.institutions (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) > 0),
  slug        text        not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status      text        not null default 'active' check (status in ('active','suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.institution_members (
  institution_id  uuid        not null references public.institutions(id) on delete restrict,
  user_id         integer     not null references public.users(id) on delete restrict,
  role            text        not null check (role in ('student','instructor','institution_admin','institution_owner')),
  status          text        not null default 'active' check (status in ('active','suspended','removed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (institution_id, user_id),
  constraint institution_members_user_institution_key unique (user_id, institution_id)
);
-- v1: one active institution per user.
create unique index institution_members_one_active_per_user
  on public.institution_members (user_id) where status = 'active';
create index institution_members_active_role_lookup
  on public.institution_members (user_id, institution_id, role) where status = 'active';

create table public.platform_admins (
  user_id     integer     primary key references public.users(id) on delete restrict,
  granted_at  timestamptz not null default now()
);

insert into public.institutions (name, slug) values ('LearnIT Demo', 'learnit-demo');

insert into public.institution_members (institution_id, user_id, role)
select i.id, u.id,
       case coalesce(m.role, u.role)
         when 'admin' then 'institution_admin'
         when 'instructor' then 'instructor'
         else 'student'
       end
from public.users u
left join public.user_identity_map m on m.legacy_user_id = u.id
cross join (select id from public.institutions where slug = 'learnit-demo') i;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. institution_id inheritance (runs before composite FK checks)
-- ═════════════════════════════════════════════════════════════════════════
create schema if not exists private;
revoke all on schema private from public, anon;

-- TG_ARGV[0] = parent table, TG_ARGV[1] = parent key column on NEW.
-- Parent tables expose institution_id; for 'institution_members' the key is
-- the user and only the active membership counts.
create function private.inherit_institution_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_key text := to_jsonb(new) ->> tg_argv[1];
  inherited  uuid;
begin
  if new.institution_id is not null or parent_key is null then
    return new;
  end if;
  if tg_argv[0] = 'institution_members' then
    select im.institution_id into inherited
    from public.institution_members im
    where im.user_id = parent_key::integer and im.status = 'active';
  else
    execute format('select institution_id from public.%I where id = $1', tg_argv[0])
      into inherited using parent_key::bigint;
  end if;
  new.institution_id := inherited;
  return new;
end;
$$;
revoke all on function private.inherit_institution_id() from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Add, backfill and enforce institution_id
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare
  demo uuid := (select id from public.institutions where slug = 'learnit-demo');
  t text;
begin
  foreach t in array array[
    'courses','enrollments','modules','materials','assignments','submissions',
    'submission_files','notes','note_chunks','student_roadmaps','roadmap_milestones',
    'notifications','settings','course_analytics_snapshots','admin_stats_snapshots',
    'unit_exams','unit_exam_results','unit_exam_imports','unit_exam_topic_analysis','audit_logs'
  ] loop
    execute format('alter table public.%I add column institution_id uuid references public.institutions(id) on delete restrict', t);
    execute format('update public.%I set institution_id = $1', t) using demo;
    execute format('create index %I on public.%I (institution_id)', 'idx_' || t || '_institution', t);
  end loop;
  -- audit_logs keeps nullable institution_id (pre-auth events such as failed logins).
  foreach t in array array[
    'courses','enrollments','modules','materials','assignments','submissions',
    'submission_files','notes','note_chunks','student_roadmaps','roadmap_milestones',
    'notifications','settings','course_analytics_snapshots','admin_stats_snapshots',
    'unit_exams','unit_exam_results','unit_exam_imports','unit_exam_topic_analysis'
  ] loop
    execute format('alter table public.%I alter column institution_id set not null', t);
  end loop;
end $$;

-- Settings are per institution.
alter table public.settings drop constraint settings_pkey;
alter table public.settings add primary key (institution_id, key);

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Tenant-safe parent keys
-- ═════════════════════════════════════════════════════════════════════════
alter table public.courses          add constraint courses_id_institution_id_key          unique (id, institution_id);
alter table public.modules          add constraint modules_id_institution_id_key          unique (id, institution_id);
alter table public.assignments      add constraint assignments_id_institution_id_key      unique (id, institution_id);
alter table public.submissions      add constraint submissions_id_institution_id_key      unique (id, institution_id);
alter table public.notes            add constraint notes_id_institution_id_key            unique (id, institution_id);
alter table public.student_roadmaps add constraint student_roadmaps_id_institution_id_key unique (id, institution_id);
alter table public.unit_exams       add constraint unit_exams_id_institution_id_key       unique (id, institution_id);

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Composite foreign keys (replace single-column ones)
-- ═════════════════════════════════════════════════════════════════════════
-- courses
alter table public.courses drop constraint courses_instructor_id_fkey;
alter table public.courses add constraint courses_instructor_tenant_fk
  foreign key (instructor_id, institution_id) references public.institution_members (user_id, institution_id);

-- enrollments
alter table public.enrollments drop constraint enrollments_course_id_fkey;
alter table public.enrollments drop constraint enrollments_student_id_fkey;
alter table public.enrollments add constraint enrollments_course_tenant_fk
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete restrict;
alter table public.enrollments add constraint enrollments_student_tenant_fk
  foreign key (student_id, institution_id) references public.institution_members (user_id, institution_id);

-- modules / materials / assignments
alter table public.modules drop constraint modules_course_id_fkey;
alter table public.modules add constraint modules_course_tenant_fk
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete restrict;
alter table public.materials drop constraint materials_module_id_fkey;
alter table public.materials add constraint materials_module_tenant_fk
  foreign key (module_id, institution_id) references public.modules (id, institution_id) on delete restrict;
alter table public.assignments drop constraint assignments_module_id_fkey;
alter table public.assignments add constraint assignments_module_tenant_fk
  foreign key (module_id, institution_id) references public.modules (id, institution_id) on delete restrict;

-- submissions / files (academic records: RESTRICT)
alter table public.submissions drop constraint submissions_assignment_id_fkey;
alter table public.submissions add constraint submissions_assignment_tenant_fk
  foreign key (assignment_id, institution_id) references public.assignments (id, institution_id) on delete restrict;
alter table public.submissions add constraint submissions_student_tenant_fk
  foreign key (student_id, institution_id) references public.institution_members (user_id, institution_id);
alter table public.submission_files drop constraint submission_files_submission_id_fkey;
alter table public.submission_files add constraint submission_files_submission_tenant_fk
  foreign key (submission_id, institution_id) references public.submissions (id, institution_id) on delete restrict;

-- notes / chunks (chunks are derived: CASCADE)
alter table public.notes drop constraint notes_module_id_fkey;
alter table public.notes add constraint notes_module_tenant_fk
  foreign key (module_id, institution_id) references public.modules (id, institution_id) on delete restrict;
alter table public.notes drop constraint notes_uploaded_by_fkey;
alter table public.notes add constraint notes_uploader_tenant_fk
  foreign key (uploaded_by, institution_id) references public.institution_members (user_id, institution_id)
  on delete set null (uploaded_by);
alter table public.note_chunks drop constraint note_chunks_note_id_fkey;
alter table public.note_chunks add constraint note_chunks_note_tenant_fk
  foreign key (note_id, institution_id) references public.notes (id, institution_id) on delete cascade;

-- roadmaps (AI-generated milestones are derived: CASCADE)
alter table public.student_roadmaps drop constraint student_roadmaps_course_id_fkey;
alter table public.student_roadmaps drop constraint student_roadmaps_student_id_fkey;
alter table public.student_roadmaps add constraint student_roadmaps_course_tenant_fk
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete restrict;
alter table public.student_roadmaps add constraint student_roadmaps_student_tenant_fk
  foreign key (student_id, institution_id) references public.institution_members (user_id, institution_id);
alter table public.roadmap_milestones drop constraint roadmap_milestones_roadmap_id_fkey;
alter table public.roadmap_milestones add constraint roadmap_milestones_roadmap_tenant_fk
  foreign key (roadmap_id, institution_id) references public.student_roadmaps (id, institution_id) on delete cascade;

-- notifications
alter table public.notifications drop constraint notifications_user_id_fkey;
alter table public.notifications add constraint notifications_user_tenant_fk
  foreign key (user_id, institution_id) references public.institution_members (user_id, institution_id);

-- course analytics snapshots (derived)
alter table public.course_analytics_snapshots add constraint course_snapshots_course_tenant_fk
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete cascade;

-- unit exams
alter table public.unit_exams drop constraint unit_exams_course_id_fkey;
alter table public.unit_exams add constraint unit_exams_course_tenant_fk
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete restrict;
alter table public.unit_exam_results drop constraint unit_exam_results_unit_exam_id_fkey;
alter table public.unit_exam_results drop constraint unit_exam_results_student_id_fkey;
alter table public.unit_exam_results add constraint unit_exam_results_exam_tenant_fk
  foreign key (unit_exam_id, institution_id) references public.unit_exams (id, institution_id) on delete restrict;
alter table public.unit_exam_results add constraint unit_exam_results_student_tenant_fk
  foreign key (student_id, institution_id) references public.institution_members (user_id, institution_id);
alter table public.unit_exam_imports drop constraint unit_exam_imports_unit_exam_id_fkey;
alter table public.unit_exam_imports add constraint unit_exam_imports_exam_tenant_fk
  foreign key (unit_exam_id, institution_id) references public.unit_exams (id, institution_id) on delete cascade;
alter table public.unit_exam_topic_analysis drop constraint unit_exam_topic_analysis_unit_exam_id_fkey;
alter table public.unit_exam_topic_analysis add constraint unit_exam_topics_exam_tenant_fk
  foreign key (unit_exam_id, institution_id) references public.unit_exams (id, institution_id) on delete cascade;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Inheritance triggers (parent table, parent key column)
-- ═════════════════════════════════════════════════════════════════════════
create trigger inherit_institution before insert on public.courses                    for each row execute function private.inherit_institution_id('institution_members', 'instructor_id');
create trigger inherit_institution before insert on public.enrollments                for each row execute function private.inherit_institution_id('courses', 'course_id');
create trigger inherit_institution before insert on public.modules                    for each row execute function private.inherit_institution_id('courses', 'course_id');
create trigger inherit_institution before insert on public.materials                  for each row execute function private.inherit_institution_id('modules', 'module_id');
create trigger inherit_institution before insert on public.assignments                for each row execute function private.inherit_institution_id('modules', 'module_id');
create trigger inherit_institution before insert on public.submissions                for each row execute function private.inherit_institution_id('assignments', 'assignment_id');
create trigger inherit_institution before insert on public.submission_files           for each row execute function private.inherit_institution_id('submissions', 'submission_id');
create trigger inherit_institution before insert on public.notes                      for each row execute function private.inherit_institution_id('modules', 'module_id');
create trigger inherit_institution before insert on public.note_chunks                for each row execute function private.inherit_institution_id('notes', 'note_id');
create trigger inherit_institution before insert on public.student_roadmaps           for each row execute function private.inherit_institution_id('courses', 'course_id');
create trigger inherit_institution before insert on public.roadmap_milestones         for each row execute function private.inherit_institution_id('student_roadmaps', 'roadmap_id');
create trigger inherit_institution before insert on public.notifications              for each row execute function private.inherit_institution_id('institution_members', 'user_id');
create trigger inherit_institution before insert on public.course_analytics_snapshots for each row execute function private.inherit_institution_id('courses', 'course_id');
create trigger inherit_institution before insert on public.unit_exams                 for each row execute function private.inherit_institution_id('courses', 'course_id');
create trigger inherit_institution before insert on public.unit_exam_results          for each row execute function private.inherit_institution_id('unit_exams', 'unit_exam_id');
create trigger inherit_institution before insert on public.unit_exam_imports          for each row execute function private.inherit_institution_id('unit_exams', 'unit_exam_id');
create trigger inherit_institution before insert on public.unit_exam_topic_analysis   for each row execute function private.inherit_institution_id('unit_exams', 'unit_exam_id');
create trigger inherit_institution before insert on public.audit_logs                 for each row execute function private.inherit_institution_id('institution_members', 'actor_user_id');

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Hot-path indexes (institution-first)
-- ═════════════════════════════════════════════════════════════════════════
create index idx_enrollments_tenant_student on public.enrollments (institution_id, student_id, course_id);
create index idx_submissions_tenant_student on public.submissions (institution_id, student_id);
create index idx_notes_tenant_module        on public.notes (institution_id, module_id);
create index idx_audit_logs_tenant_time     on public.audit_logs (institution_id, created_at desc);
create index idx_course_snapshots_tenant    on public.course_analytics_snapshots (institution_id, course_id, snapshotted_at desc);

-- ═════════════════════════════════════════════════════════════════════════
-- 8. RLS helpers for the Phase 2 policy rewrite (tenant from JWT claim,
--    role checked live against institution_members)
-- ═════════════════════════════════════════════════════════════════════════
create function private.current_user_id()
returns integer language sql stable security definer set search_path = '' as $$
  select uim.legacy_user_id from public.user_identity_map uim where uim.auth_user_id = (select auth.uid())
$$;

create function private.current_institution_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select nullif(auth.jwt() ->> 'institution_id', '')::uuid
$$;

create function private.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.institution_members im
    where im.user_id = (select private.current_user_id())
      and im.institution_id = (select private.current_institution_id())
      and im.status = 'active')
$$;

create function private.has_role(required_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.institution_members im
    where im.user_id = (select private.current_user_id())
      and im.institution_id = (select private.current_institution_id())
      and im.status = 'active'
      and im.role = required_role)
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_user_id(), private.current_institution_id(),
  private.is_active_member(), private.has_role(text) to authenticated;
revoke execute on function private.current_user_id(), private.current_institution_id(),
  private.is_active_member(), private.has_role(text) from public, anon;

-- ═════════════════════════════════════════════════════════════════════════
-- 9. New tables are server-only until the Phase 2 policies land
-- ═════════════════════════════════════════════════════════════════════════
alter table public.institutions        enable row level security;
alter table public.institution_members enable row level security;
alter table public.platform_admins     enable row level security;
revoke all on table public.institutions, public.institution_members, public.platform_admins from anon, authenticated;
