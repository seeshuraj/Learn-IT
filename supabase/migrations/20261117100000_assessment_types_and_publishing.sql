-- Assessments: types, end-semester marks and grades, draft → publish.
--
-- unit_exams now covers every internal and university assessment:
--   unit_test (CIA), model, end_semester, quiz, lab, other.
-- End-semester assessments split marks into internal + external and carry
-- credits and a semester number, so grades and SGPA can be computed.
--
-- Results stay a draft until the professor publishes the assessment
-- (published_at). Students only ever see published assessments; the API
-- enforces this (these tables have no client grants, see 20261029112118).
--
-- Additive and backward compatible: existing rows get assessment_type
-- 'unit_test' and stay unpublished; marks_obtained becomes nullable only for
-- rows marked absent.

alter table public.unit_exams
  add column if not exists assessment_type text not null default 'unit_test',
  add column if not exists internal_max    numeric(6,2),
  add column if not exists external_max    numeric(6,2),
  add column if not exists credits         numeric(3,1),
  add column if not exists semester        smallint,
  add column if not exists grade_scale     jsonb,
  add column if not exists published_at    timestamptz,
  add column if not exists published_by    integer references public.users(id) on delete set null;

alter table public.unit_exams
  add constraint unit_exams_assessment_type_check
    check (assessment_type in ('unit_test', 'model', 'end_semester', 'quiz', 'lab', 'other')),
  add constraint unit_exams_split_check
    check (
      (internal_max is null and external_max is null)
      or (internal_max >= 0 and external_max > 0 and internal_max + external_max = max_marks)
    ),
  add constraint unit_exams_credits_check  check (credits is null or (credits >= 0 and credits <= 30)),
  add constraint unit_exams_semester_check check (semester is null or semester between 1 and 12),
  add constraint unit_exams_grade_scale_check check (grade_scale is null or jsonb_typeof(grade_scale) = 'object');

comment on column public.unit_exams.grade_scale is
  'Optional per-assessment grade scale; null means the default (Anna University style O..C, RA, AB). See src/server/lib/examGrading.ts.';
comment on column public.unit_exams.published_at is
  'When results were released to students. Null = draft, visible only to staff.';

alter table public.unit_exam_results
  alter column marks_obtained drop not null,
  add column if not exists is_absent      boolean not null default false,
  add column if not exists internal_marks numeric(6,2),
  add column if not exists external_marks numeric(6,2),
  add column if not exists grade          text,
  add column if not exists grade_point    numeric(3,1),
  add column if not exists remarks        text,
  add column if not exists entered_by     integer references public.users(id) on delete set null;

alter table public.unit_exam_results
  add constraint unit_exam_results_absent_check   check (is_absent or marks_obtained is not null),
  add constraint unit_exam_results_internal_check check (internal_marks is null or internal_marks >= 0),
  add constraint unit_exam_results_external_check check (external_marks is null or external_marks >= 0),
  add constraint unit_exam_results_grade_check    check (grade is null or grade ~ '^[A-Z][A-Z+]{0,2}$'),
  add constraint unit_exam_results_gp_check       check (grade_point is null or grade_point between 0 and 10),
  add constraint unit_exam_results_remarks_check  check (remarks is null or char_length(remarks) <= 500);

-- Professors list a course's assessments by type; students read their own
-- published results (idx_unit_exam_results_student already covers that).
create index if not exists idx_unit_exams_course_type
  on public.unit_exams (course_id, assessment_type, exam_date desc);
create index if not exists idx_unit_exams_published
  on public.unit_exams (institution_id, published_at) where published_at is not null;
create index if not exists idx_unit_exam_results_entered_by
  on public.unit_exam_results (entered_by) where entered_by is not null;
create index if not exists idx_unit_exams_published_by
  on public.unit_exams (published_by) where published_by is not null;
