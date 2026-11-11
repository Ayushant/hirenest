-- Idempotency for cron-driven alerts (SLA warnings, morning digests, compliance reminders).
create table if not exists public.alert_log (
  dedupe_key text primary key,
  created_at timestamptz not null default now()
);
alter table public.alert_log enable row level security;
