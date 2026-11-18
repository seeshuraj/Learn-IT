-- Class enrolment: students get their department's courses for the semester
-- their year of study is in. Enrolments made that way are 'auto' and are
-- withdrawn when the student or course stops matching; enrolments an admin
-- made by hand are 'manual' and are never removed automatically.
--
-- Backward-compatible: existing rows (all made by hand) become 'manual'.

alter table public.enrollments
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'enrollments_source_check') then
    alter table public.enrollments
      add constraint enrollments_source_check check (source in ('manual', 'auto'));
  end if;
end $$;

-- Lookups use the existing idx_members_department_year and idx_courses_department.
