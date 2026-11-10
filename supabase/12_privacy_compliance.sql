-- Privacy & Compliance tables
-- Run this in Supabase SQL Editor

-- Safe re-run: these tables are new, so drop any earlier partial attempt
drop table if exists public.privacy_notices, public.privacy_acknowledgements, public.data_processing_records,
  public.privacy_requests, public.retention_policies, public.deletion_jobs, public.privacy_incidents,
  public.privacy_audit_events cascade;

create table if not exists public.privacy_notices (
  notice_id text primary key,
  version text,
  locale text default 'en-IN',
  title text not null,
  purposes jsonb default '[]',
  legal_bases_supported jsonb default '[]',
  effective_at timestamptz,
  published_by text,
  status text default 'active',
  content_summary text,
  fiduciary_entity text,
  grievance_officer_contact text,
  created_at timestamptz not null default now()
);

create table if not exists public.privacy_acknowledgements (
  id text primary key,
  subject_ref text not null,
  subject_name text,
  tenant_id text,
  notice_id text,
  version text,
  purpose text,
  processing_basis text,
  action text,
  communication_preferences jsonb default '{}',
  timestamp timestamptz not null default now(),
  capture_source text,
  evidence_ref text
);

create table if not exists public.data_processing_records (
  id text primary key,
  workflow text,
  data_categories jsonb default '[]',
  source text,
  purpose text,
  responsible_entity text,
  legal_role text,
  processing_basis text,
  recipients jsonb default '[]',
  systems jsonb default '[]',
  retention_policy_id text,
  status text default 'active'
);

create table if not exists public.privacy_requests (
  request_id text primary key,
  tenant_id text,
  requester_ref text,
  requester_name text,
  requester_email text,
  request_type text,
  summary text,
  received_at timestamptz,
  sla_due_at timestamptz,
  verification_status text,
  status text default 'pending',
  assigned_to text,
  decision text,
  resolved_at timestamptz,
  notes text
);

create table if not exists public.retention_policies (
  policy_id text primary key,
  data_category text,
  purpose text,
  trigger text,
  duration_rule text,
  duration_days integer,
  legal_hold_exception boolean default false,
  legal_hold_reason text,
  owner text,
  version text,
  status text default 'active'
);

create table if not exists public.deletion_jobs (
  job_id text primary key,
  tenant_id text,
  subject_ref text,
  subject_label text,
  scope text,
  requested_at timestamptz,
  status text default 'pending',
  target_systems jsonb default '{}',
  attempts integer default 1,
  verified_at timestamptz,
  exception_reason text
);

create table if not exists public.privacy_incidents (
  incident_id text primary key,
  tenant_id text,
  title text not null,
  detected_at timestamptz,
  severity text,
  affected_systems jsonb default '[]',
  affected_records_estimate integer default 0,
  assessment text,
  containment text,
  notification_status text,
  accountable_owner text,
  closure_evidence text
);

create table if not exists public.privacy_audit_events (
  event_id text primary key,
  actor_ref text,
  actor_role text,
  tenant_id text,
  action text,
  resource_type text,
  resource_ref text,
  purpose text,
  timestamp timestamptz not null default now(),
  outcome text,
  correlation_id text
);

-- RLS
alter table public.privacy_notices enable row level security;
alter table public.privacy_acknowledgements enable row level security;
alter table public.data_processing_records enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.retention_policies enable row level security;
alter table public.deletion_jobs enable row level security;
alter table public.privacy_incidents enable row level security;
alter table public.privacy_audit_events enable row level security;

create policy "privacy_notices_all" on public.privacy_notices for all using (true) with check (true);
create policy "privacy_acknowledgements_all" on public.privacy_acknowledgements for all using (true) with check (true);
create policy "data_processing_records_all" on public.data_processing_records for all using (true) with check (true);
create policy "privacy_requests_all" on public.privacy_requests for all using (true) with check (true);
create policy "retention_policies_all" on public.retention_policies for all using (true) with check (true);
create policy "deletion_jobs_all" on public.deletion_jobs for all using (true) with check (true);
create policy "privacy_incidents_all" on public.privacy_incidents for all using (true) with check (true);
create policy "privacy_audit_events_all" on public.privacy_audit_events for all using (true) with check (true);

-- Indexes
create index if not exists idx_privacy_ack_subject on public.privacy_acknowledgements(subject_ref);
create index if not exists idx_privacy_requests_status on public.privacy_requests(status);
create index if not exists idx_privacy_audit_timestamp on public.privacy_audit_events(timestamp);
create index if not exists idx_deletion_jobs_status on public.deletion_jobs(status);
