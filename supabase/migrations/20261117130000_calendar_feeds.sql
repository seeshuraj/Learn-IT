-- Private calendar subscription links (Google/Apple/Outlook) for exams.
--
-- Calendar apps can't send a login, so the link carries a random token.
-- Only its SHA-256 is stored; making a new link replaces (revokes) the old
-- one. The feed only lists the member's own exams. Server-only table.

create table if not exists public.calendar_feed_tokens (
  user_id        integer not null references public.users(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  primary key (user_id, institution_id)
);
create index if not exists idx_calendar_feed_tokens_institution on public.calendar_feed_tokens (institution_id);

alter table public.calendar_feed_tokens enable row level security;
revoke all on table public.calendar_feed_tokens from anon, authenticated;
