-- Exam-aware study plans.
--
-- - unit_exams.portion_module_ids / portion_notes: what an exam covers
--   ("Units 1–2"), set by the professor. Drives what the plan revises.
-- - student_roadmaps: the exam a plan counts down to, and a "stale" flag set
--   when exam dates, portions or published marks change, so the student is
--   asked to refresh (plans are regenerated on request, never in bulk, to
--   keep AI cost per college predictable).
-- - roadmap_milestones: a date, a kind (learn/practice/revise/assignment/
--   exam), the topic and module it targets, and a time estimate.
-- Additive: existing plans keep working without dates.

alter table public.unit_exams
  add column if not exists portion_module_ids integer[],
  add column if not exists portion_notes      text;
alter table public.unit_exams
  add constraint unit_exams_portion_notes_check check (portion_notes is null or char_length(portion_notes) <= 1000),
  add constraint unit_exams_portion_size_check check (portion_module_ids is null or cardinality(portion_module_ids) <= 100);

alter table public.student_roadmaps
  add column if not exists target_unit_exam_id integer references public.unit_exams(id) on delete set null,
  add column if not exists target_exam_date    date,
  add column if not exists stale_reason        text,
  add column if not exists stale_since         timestamptz;
alter table public.student_roadmaps
  add constraint student_roadmaps_stale_reason_check check (stale_reason is null or char_length(stale_reason) <= 200);
create index if not exists idx_student_roadmaps_target_exam
  on public.student_roadmaps (target_unit_exam_id) where target_unit_exam_id is not null;
create index if not exists idx_student_roadmaps_course
  on public.student_roadmaps (course_id);

alter table public.roadmap_milestones
  add column if not exists due_date     date,
  add column if not exists kind         text,
  add column if not exists topic        text,
  add column if not exists module_id    integer references public.modules(id) on delete set null,
  add column if not exists est_minutes  smallint;
alter table public.roadmap_milestones
  add constraint roadmap_milestones_kind_check check (kind is null or kind in ('learn', 'practice', 'revise', 'assignment', 'exam', 'other')),
  add constraint roadmap_milestones_topic_check check (topic is null or char_length(topic) <= 200),
  add constraint roadmap_milestones_minutes_check check (est_minutes is null or est_minutes between 5 and 600);
create index if not exists idx_roadmap_milestones_due on public.roadmap_milestones (roadmap_id, due_date);
create index if not exists idx_roadmap_milestones_module on public.roadmap_milestones (module_id) where module_id is not null;
