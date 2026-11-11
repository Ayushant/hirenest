-- Idempotency for cron-driven alerts (SLA warnings, morning digests, compliance reminders).
create table if not exists public.alert_log (
  dedupe_key text primary key,
  created_at timestamptz not null default now()
);
alter table public.alert_log enable row level security;

-- Time on platform (heartbeat-based), one row per user per day.
create table if not exists public.platform_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default current_date,
  seconds integer not null default 0,
  primary key (user_id, day)
);
alter table public.platform_usage enable row level security;
