-- AI usage metering and per-college monthly allowances.
--
-- ai_usage_events: one row per chat-model call made while serving a request,
-- written in batches by the backend (service role). No policies: browsers
-- never read or write it; admins see aggregates via /api/admin/ai-usage.
-- Prompts and answers are not stored, only counts and timings.
--
-- institutions.ai_monthly_token_budget: tokens per calendar month (UTC).
-- NULL falls back to the AI_MONTHLY_TOKEN_BUDGET env var; neither set means
-- unlimited. Set by LearnIT (platform), not by the college's own admins.

create table public.ai_usage_events (
  id                bigint generated always as identity primary key,
  institution_id    uuid        not null references public.institutions(id) on delete cascade,
  user_id           integer     references public.users(id) on delete set null,
  course_id         integer     references public.courses(id) on delete set null,
  feature           text        not null check (length(feature) between 1 and 40),
  model             text        not null check (length(model) between 1 and 120),
  prompt_tokens     integer     not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer     not null default 0 check (completion_tokens >= 0),
  estimated         boolean     not null default false,
  latency_ms        integer     not null default 0 check (latency_ms >= 0),
  status            text        not null check (status in ('ok', 'error')),
  created_at        timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'One row per LLM call (counts and timings only, no content). Backend-only; RLS on with no policies.';

create index ai_usage_events_tenant_time on public.ai_usage_events (institution_id, created_at desc);
create index ai_usage_events_user        on public.ai_usage_events (user_id);
create index ai_usage_events_course      on public.ai_usage_events (course_id);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;

alter table public.institutions
  add column ai_monthly_token_budget bigint
  check (ai_monthly_token_budget is null or ai_monthly_token_budget >= 0);

comment on column public.institutions.ai_monthly_token_budget is
  'Monthly LLM token allowance (prompt + completion). NULL = AI_MONTHLY_TOKEN_BUDGET env default; 0 = unlimited.';
