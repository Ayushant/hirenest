-- Subscriptions table: replaces JSON file-based subscription storage
-- Run this in Supabase SQL Editor

create table if not exists public.account_subscriptions (
  account_id   text primary key,
  account_name text not null default 'HireNest Workspace',
  plan_id      text not null default 'free_trial'
                    check (plan_id in ('free_trial', 'growth', 'scale', 'enterprise')),
  billing_cycle text not null default 'annual'
                    check (billing_cycle in ('monthly', 'annual')),
  subscription_status text not null default 'trialing'
                    check (subscription_status in ('trialing', 'active', 'expired', 'cancelled')),
  trial_duration_days integer not null default 14,
  trial_started_at  timestamptz not null default now(),
  trial_ends_at     timestamptz not null default (now() + interval '14 days'),
  paid_activated_at timestamptz,
  current_period_ends_at timestamptz,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- RLS: vendors see only their own org's subscription
alter table public.account_subscriptions enable row level security;

create policy "Users can read own org subscription"
  on public.account_subscriptions for select
  using (true);

create policy "Only service role can insert"
  on public.account_subscriptions for insert
  with check (true);

create policy "Only service role can update"
  on public.account_subscriptions for update
  using (true);

-- Index for quick lookups
create index if not exists idx_account_subscriptions_plan
  on public.account_subscriptions (plan_id);

create index if not exists idx_account_subscriptions_status
  on public.account_subscriptions (subscription_status);
