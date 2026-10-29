-- Schema alignment: additive changes so the API's queries match the database.
--
-- An EXPLAIN of every SQL statement in the server against the live schema
-- (2026-10-29) found 27 that fail. Most are fixed in code; this migration
-- adds the columns and tables the code legitimately needs. Additive only:
-- nothing is dropped or renamed, so the running app is unaffected until the
-- matching code deploys.

-- ── notes: who uploaded it, and file size ────────────────────────────────────
-- notes.student_id was overloaded as "uploader" (NULL for instructor notes).
-- uploaded_by records the uploader for every note; student_id is left as is.
alter table public.notes
  add column if not exists uploaded_by integer references public.users(id) on delete set null,
  add column if not exists file_size   bigint;
update public.notes set uploaded_by = student_id
  where uploaded_by is null and student_id is not null;
create index if not exists idx_notes_uploaded_by on public.notes (uploaded_by);

alter table public.submission_files
  add column if not exists file_size bigint;

-- ── submissions: grading timestamps ──────────────────────────────────────────
alter table public.submissions
  add column if not exists graded_at  timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- ── notifications / identity map ─────────────────────────────────────────────
alter table public.notifications
  add column if not exists read_at timestamptz;
alter table public.user_identity_map
  add column if not exists last_password_change timestamptz;

-- ── password_reset_tokens (repo migration 009 was never applied) ─────────────
create table if not exists public.password_reset_tokens (
  id          bigserial    primary key,
  user_id     integer      not null references public.users(id) on delete cascade,
  token       uuid         not null unique default gen_random_uuid(),
  expires_at  timestamptz  not null default (now() + interval '1 hour'),
  used_at     timestamptz,
  created_at  timestamptz  not null default now()
);
create index if not exists idx_prt_user on public.password_reset_tokens (user_id, created_at desc);

-- ── unit exams (repo migration 011 was never applied; it also used a
--    subquery in a generated column, which Postgres rejects. The API computes
--    percentage itself, so it is a plain column here). Academic records use
--    RESTRICT; import logs and derived topic analysis cascade. ─────────────────
create table if not exists public.unit_exams (
  id                  serial       primary key,
  course_id           integer      not null references public.courses(id) on delete restrict,
  title               text         not null,
  exam_date           date,
  max_marks           numeric(6,2) not null default 100 check (max_marks > 0),
  grading_schema      jsonb        not null default '{"strong":75,"moderate":50}'::jsonb,
  paper_storage_path  text,
  paper_text          text,
  analysis_status     text         not null default 'pending'
                        check (analysis_status in ('pending','processing','done','failed')),
  created_by          integer      references public.users(id) on delete set null,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);
create index if not exists idx_unit_exams_course on public.unit_exams (course_id);

create table if not exists public.unit_exam_results (
  id                serial        primary key,
  unit_exam_id      integer       not null references public.unit_exams(id) on delete restrict,
  student_id        integer       not null references public.users(id) on delete restrict,
  marks_obtained    numeric(6,2)  not null check (marks_obtained >= 0),
  percentage        numeric(5,2),
  performance_band  text          check (performance_band in ('strong','moderate','weak')),
  topic_breakdown   jsonb,
  raw_row           jsonb,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  unique (unit_exam_id, student_id)
);
create index if not exists idx_unit_exam_results_student on public.unit_exam_results (student_id);

create table if not exists public.unit_exam_imports (
  id            serial       primary key,
  unit_exam_id  integer      not null references public.unit_exams(id) on delete cascade,
  file_name     text         not null,
  import_type   text         not null check (import_type in ('csv','xlsx')),
  status        text         not null default 'pending'
                  check (status in ('pending','processing','done','failed')),
  rows_total    integer      default 0,
  rows_matched  integer      default 0,
  rows_failed   integer      default 0,
  error_report  jsonb,
  imported_by   integer      references public.users(id) on delete set null,
  created_at    timestamptz  not null default now()
);
create index if not exists idx_unit_exam_imports_exam on public.unit_exam_imports (unit_exam_id);

create table if not exists public.unit_exam_topic_analysis (
  id            serial       primary key,
  unit_exam_id  integer      not null references public.unit_exams(id) on delete cascade,
  topic_name    text         not null,
  weight        numeric(5,2),
  difficulty    text         check (difficulty in ('easy','medium','hard')),
  evidence      jsonb,
  created_at    timestamptz  not null default now()
);
create index if not exists idx_unit_exam_topics_exam on public.unit_exam_topic_analysis (unit_exam_id);

-- New tables are server-only for now: RLS on, no client policies, no client
-- grants (Supabase's default privileges would otherwise grant them).
alter table public.password_reset_tokens    enable row level security;
alter table public.unit_exams               enable row level security;
alter table public.unit_exam_results        enable row level security;
alter table public.unit_exam_imports        enable row level security;
alter table public.unit_exam_topic_analysis enable row level security;
revoke all on table
  public.password_reset_tokens, public.unit_exams, public.unit_exam_results,
  public.unit_exam_imports, public.unit_exam_topic_analysis
from anon, authenticated;

-- ── Storage bucket used by unit exam paper uploads (private) ─────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learnit-exam-papers', 'learnit-exam-papers', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
