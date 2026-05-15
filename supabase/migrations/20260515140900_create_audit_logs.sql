create table if not exists public.audit_logs (
  id            bigserial primary key,
  action        text not null,
  resource_type text,
  resource_id   text,
  actor_user_id int,
  actor_email   text,
  actor_role    text,
  metadata      jsonb,
  ip            text,
  request_id    text,
  created_at    timestamptz default now()
);

create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_user_id);

create index if not exists idx_audit_logs_action
  on public.audit_logs (action);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);
