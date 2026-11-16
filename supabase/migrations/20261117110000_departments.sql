-- Departments, and where students, professors and courses sit in them.
--
-- Exam timetables are published per department + year of study, so LearnIT
-- needs to know each member's department and year and each course's
-- department and semester. Until now the only signal was users.major, free
-- text from bulk import.
--
-- - departments: per college, with a short code (CSE, ECE…) and a name.
-- - institution_members.department_id / year_of_study: a member's place in
--   *this* college (users rows are global, so it lives on the membership).
-- - courses.department_id / semester: year of study = ceil(semester / 2).
--
-- Backfill: one department per distinct users.major in each college, and
-- members linked to it; users.year becomes year_of_study for students.
-- Additive: users.major/year stay as they were.

create table if not exists public.departments (
  id             serial primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  code           text not null check (code ~ '^[A-Z0-9][A-Z0-9&.\-]{0,19}$'),
  name           text not null check (char_length(name) between 1 and 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (institution_id, code),
  unique (id, institution_id)
);
create unique index if not exists departments_name_ci on public.departments (institution_id, lower(name));

alter table public.departments enable row level security;
revoke all on table public.departments from anon, authenticated;

alter table public.institution_members
  add column if not exists department_id integer,
  add column if not exists year_of_study smallint;
alter table public.institution_members
  add constraint institution_members_year_check check (year_of_study is null or year_of_study between 1 and 10),
  add constraint institution_members_department_fk foreign key (department_id, institution_id)
    references public.departments (id, institution_id) on delete set null (department_id);
create index if not exists idx_members_department_year
  on public.institution_members (institution_id, department_id, year_of_study) where status = 'active';

alter table public.courses
  add column if not exists department_id integer,
  add column if not exists semester smallint;
alter table public.courses
  add constraint courses_semester_check check (semester is null or semester between 1 and 12),
  add constraint courses_department_fk foreign key (department_id, institution_id)
    references public.departments (id, institution_id) on delete set null (department_id);
create index if not exists idx_courses_department on public.courses (institution_id, department_id, semester);
-- Timetable rows are matched to courses by code within a college.
create index if not exists idx_courses_code_ci on public.courses (institution_id, upper(code));

-- ── Backfill from users.major / users.year ──────────────────────────────────
insert into public.departments (institution_id, code, name)
select distinct on (im.institution_id, upper(left(regexp_replace(trim(u.major), '[^A-Za-z0-9]', '', 'g'), 20)))
       im.institution_id,
       upper(left(regexp_replace(trim(u.major), '[^A-Za-z0-9]', '', 'g'), 20)),
       trim(u.major)
from public.institution_members im
join public.users u on u.id = im.user_id
where nullif(trim(u.major), '') is not null
  and regexp_replace(trim(u.major), '[^A-Za-z0-9]', '', 'g') <> ''
on conflict do nothing;

update public.institution_members im
set department_id = d.id
from public.users u, public.departments d
where u.id = im.user_id
  and d.institution_id = im.institution_id
  and lower(d.name) = lower(trim(u.major))
  and im.department_id is null;

update public.institution_members im
set year_of_study = u.year
from public.users u
where u.id = im.user_id and im.role = 'student'
  and u.year between 1 and 10 and im.year_of_study is null;
