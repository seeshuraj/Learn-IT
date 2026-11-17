-- Course notice board: what a course's professor posts for its students
-- ("bring your drawing kit tomorrow", "prepare Unit 2 for the test").
--
-- kind: notice | bring | exam_prep | reminder. due_date is the day it is
-- for ("tomorrow"), optional; pinned notices stay at the top. Students of the
-- course are notified when one is posted (notifications, type course_notice).
-- Backend-only access, like the other tenant tables.

create table if not exists public.course_announcements (
  id             serial primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  course_id      integer not null,
  author_id      integer references public.users(id) on delete set null,
  kind           text not null default 'notice' check (kind in ('notice', 'bring', 'exam_prep', 'reminder')),
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  body           text check (body is null or char_length(body) <= 4000),
  due_date       date,
  pinned         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (course_id, institution_id) references public.courses (id, institution_id) on delete cascade
);
create index if not exists course_announcements_course
  on public.course_announcements (course_id, pinned desc, due_date, created_at desc);
create index if not exists course_announcements_due
  on public.course_announcements (institution_id, due_date) where due_date is not null;
create index if not exists course_announcements_author on public.course_announcements (author_id);

alter table public.course_announcements enable row level security;
revoke all on table public.course_announcements from anon, authenticated;
