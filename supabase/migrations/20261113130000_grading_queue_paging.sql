-- Paged grading queue (GET /api/instructor/submissions?limit=…).
--
-- Pages are ordered by (submitted_at DESC, id DESC) with a keyset cursor, so
-- submitted_at must never be NULL (it already defaults to now()).
update public.submissions set submitted_at = now() where submitted_at is null;
alter table public.submissions alter column submitted_at set not null;

-- Ungraded submissions, newest first, per college: serves the admin view and
-- the "pending" count without sorting the whole table.
create index if not exists idx_submissions_pending_queue
  on public.submissions (institution_id, submitted_at desc, id desc)
  where grade is null;
