-- Background job queue (src/server/lib/jobs.ts) and note processing status.
--
-- Only the backend (service role / postgres) touches jobs: RLS is on with no
-- policies, and anon/authenticated have no grants. Payloads hold ids, never
-- document text or credentials.

create table if not exists public.jobs (
  id             bigint generated always as identity primary key,
  kind           text        not null check (kind ~ '^[a-z_.]{1,60}$'),
  payload        jsonb       not null default '{}'::jsonb,
  status         text        not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  institution_id uuid        references public.institutions(id) on delete cascade,
  created_by     integer,
  dedupe_key     text,
  attempts       integer     not null default 0,
  max_attempts   integer     not null default 5 check (max_attempts between 1 and 20),
  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  locked_by      text,
  last_error     text,
  result         jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);

comment on table public.jobs is 'Background work queue; claimed with FOR UPDATE SKIP LOCKED by API/worker processes.';

-- Workers claim due jobs in order.
create index if not exists jobs_due on public.jobs (run_after, id) where status = 'queued';
-- Stale-lock recovery.
create index if not exists jobs_running on public.jobs (locked_at) where status = 'running';
-- One pending job per dedupe key (e.g. one processing run per note).
create unique index if not exists jobs_dedupe_pending on public.jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
-- Status lookups by college, and cleanup of finished jobs.
create index if not exists jobs_tenant on public.jobs (institution_id, id);
create index if not exists jobs_finished on public.jobs (finished_at) where status in ('done', 'failed');

alter table public.jobs enable row level security;
revoke all on table public.jobs from anon, authenticated;

-- Note processing state, so the UI can show "processing" / "failed".
alter table public.notes add column if not exists processing_status text not null default 'ready'
  check (processing_status in ('pending', 'ready', 'failed'));
alter table public.notes add column if not exists processing_error text;
