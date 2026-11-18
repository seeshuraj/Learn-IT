-- Question-wise marks (Part A / B / C) and mark conversion.
--
-- - unit_exams.question_pattern: the paper's parts, questions and marks per
--   question, either/or and "answer any N" (shape validated by the API,
--   src/server/lib/questionPattern.ts). Null = total-only entry, as before.
-- - unit_exams.counted_out_of: "written out of 50, counts as 20".
-- - unit_exam_results.question_marks: a student's mark per question, e.g.
--   {"1": 2, "11": {"m": 10, "o": "b"}}. marks_obtained / external_marks
--   stay the stored total, so grades, publishing and study plans keep reading
--   the same columns.
-- - unit_exam_results.converted_marks: total on the counted_out_of scale.
-- - exam_patterns: a college's saved patterns, reused across assessments.
--
-- Additive: new nullable columns and a new table. Backend-only access, like
-- the other tenant tables (RLS on, nothing granted to anon/authenticated).

alter table public.unit_exams
  add column if not exists question_pattern jsonb,
  add column if not exists counted_out_of numeric(6,2);
alter table public.unit_exams
  add constraint unit_exams_question_pattern_check check (question_pattern is null or jsonb_typeof(question_pattern) = 'object'),
  add constraint unit_exams_counted_out_of_check check (counted_out_of is null or (counted_out_of > 0 and counted_out_of <= 1000));

alter table public.unit_exam_results
  add column if not exists question_marks jsonb,
  add column if not exists converted_marks numeric(6,2);
alter table public.unit_exam_results
  add constraint unit_exam_results_question_marks_check check (question_marks is null or jsonb_typeof(question_marks) = 'object'),
  add constraint unit_exam_results_converted_check check (converted_marks is null or converted_marks >= 0);

create table if not exists public.exam_patterns (
  id              serial primary key,
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  assessment_type text check (assessment_type is null or assessment_type in ('unit_test','model','end_semester','quiz','lab','other')),
  pattern         jsonb not null check (jsonb_typeof(pattern) = 'object'),
  created_by      integer references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists exam_patterns_name_ci on public.exam_patterns (institution_id, lower(btrim(name)));
create index if not exists exam_patterns_created_by on public.exam_patterns (created_by);

alter table public.exam_patterns enable row level security;
revoke all on table public.exam_patterns from anon, authenticated;
