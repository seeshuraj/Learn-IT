-- Exam timetables: the admin uploads one (Excel/CSV, image or PDF), checks
-- the rows, and publishes. Publishing schedules each exam for its course's
-- professor (a draft assessment with the date set) and its students.
--
-- exam_timetables         one upload: title, type, status, source file
-- exam_timetable_entries  one exam: date, session/time, course, department,
--                         year, hall; linked to the assessment it created
--
-- Server-only like the other academic tables: RLS on, no client grants.

create table if not exists public.exam_timetables (
  id               serial primary key,
  institution_id   uuid not null references public.institutions(id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 200),
  assessment_type  text not null check (assessment_type in ('unit_test', 'model', 'end_semester', 'quiz', 'lab', 'other')),
  status           text not null default 'draft' check (status in ('extracting', 'draft', 'published', 'failed')),
  source_kind      text check (source_kind in ('xlsx', 'csv', 'image', 'pdf')),
  source_path      text,
  source_name      text,
  extraction_note  text,
  created_by       integer references public.users(id) on delete set null,
  published_at     timestamptz,
  published_by     integer references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, institution_id)
);
create index if not exists idx_exam_timetables_tenant on public.exam_timetables (institution_id, created_at desc);
create index if not exists idx_exam_timetables_created_by on public.exam_timetables (created_by) where created_by is not null;
create index if not exists idx_exam_timetables_published_by on public.exam_timetables (published_by) where published_by is not null;

create table if not exists public.exam_timetable_entries (
  id              serial primary key,
  timetable_id    integer not null,
  institution_id  uuid not null,
  row_number      integer,
  exam_date       date,            -- null until the admin fixes an unreadable date; publishing needs all
  session         text check (session is null or session in ('FN', 'AN')),
  start_time      time,
  end_time        time,
  course_code     text check (course_code is null or char_length(course_code) <= 50),
  course_name     text check (course_name is null or char_length(course_name) <= 255),
  department_text text check (department_text is null or char_length(department_text) <= 200),
  department_id   integer,
  year_of_study   smallint check (year_of_study is null or year_of_study between 1 and 10),
  semester        smallint check (semester is null or semester between 1 and 12),
  venue           text check (venue is null or char_length(venue) <= 200),
  course_id       integer,
  unit_exam_id    integer references public.unit_exams(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (timetable_id, institution_id) references public.exam_timetables (id, institution_id) on delete cascade,
  foreign key (department_id, institution_id) references public.departments (id, institution_id) on delete set null (department_id),
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete set null (course_id),
  check (end_time is null or start_time is null or end_time > start_time)
);
create index if not exists idx_tt_entries_timetable on public.exam_timetable_entries (timetable_id, exam_date);
create index if not exists idx_tt_entries_course on public.exam_timetable_entries (course_id, exam_date) where course_id is not null;
create index if not exists idx_tt_entries_dept_year on public.exam_timetable_entries (institution_id, department_id, year_of_study, exam_date);
create index if not exists idx_tt_entries_unit_exam on public.exam_timetable_entries (unit_exam_id) where unit_exam_id is not null;

alter table public.exam_timetables enable row level security;
alter table public.exam_timetable_entries enable row level security;
revoke all on table public.exam_timetables, public.exam_timetable_entries from anon, authenticated;

-- Uploaded timetable files (private; read through the API only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learnit-timetables', 'learnit-timetables', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'text/csv', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
