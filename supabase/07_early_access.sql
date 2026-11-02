-- =====================================================================
-- HireNestOS: Early Access Applications
-- ---------------------------------------------------------------------
-- Run this AFTER 01_schema.sql.
-- Creates the early_access_applications table for storing public
-- early access registration data, visible to admins.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. ENUM for early access status
-- ---------------------------------------------------------------------
create type public.early_access_status as enum (
  'submitted',
  'under_review',
  'approved',
  'waitlisted',
  'rejected'
);

-- ---------------------------------------------------------------------
-- 2. TABLE
-- ---------------------------------------------------------------------
create table public.early_access_applications (
  id               uuid primary key default gen_random_uuid(),
  application_id   text unique not null,      -- EA-XXXXX format
  contact_name     text not null,
  designation      text default '',
  business_email   text not null,
  phone            text default '',
  company_name     text not null,
  company_website  text default '',
  business_type    text not null default 'staffing_agency',
  country          text not null default 'India',
  company_size     text not null default '11-50',
  recruitment_team_size text default '',
  business_requirements text default '',
  interested_modules    text[] default '{}',
  current_challenges    text default '',
  linkedin_url     text default '',
  comments         text default '',
  privacy_consent  boolean not null default false,
  status           public.early_access_status not null default 'submitted',
  assigned_to      text,
  admin_notes      text default '',
  follow_up_date   date,
  invitation_sent_at  timestamptz,
  registered_at       timestamptz,
  trial_activated_at  timestamptz,
  paid_converted_at   timestamptz,
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Unique email constraint to prevent duplicate applications
create unique index early_access_email_unique on public.early_access_applications (business_email);

-- Index for status filtering
create index early_access_status_idx on public.early_access_applications (status);

-- Index for chronological listing
create index early_access_submitted_idx on public.early_access_applications (submitted_at desc);

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.early_access_applications enable row level security;

-- Public can insert (submit application) - no auth required
create policy "Anyone can submit early access application"
  on public.early_access_applications
  for insert
  with check (true);

-- Only admins can read all applications
create policy "Admins can read all early access applications"
  on public.early_access_applications
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- Only admins can update applications
create policy "Admins can update early access applications"
  on public.early_access_applications
  for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- 4. AUTO-UPDATE updated_at
-- ---------------------------------------------------------------------
create or replace function public.update_early_access_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger early_access_updated_at
  before update on public.early_access_applications
  for each row
  execute function public.update_early_access_updated_at();

commit;
