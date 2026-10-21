-- =====================================================================
-- HireNestOS MVP: Supabase database schema
-- ---------------------------------------------------------------------
-- HOW TO USE
--   1. Create a NEW Supabase project (do not run this on a project that
--      already has HireNest tables).
--   2. Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. Then run 02_bootstrap_admin.sql (after you sign up once) to make
--      yourself the first admin.
--
-- SECURITY MODEL (summary)
--   * Every table has Row Level Security ON. Nothing is readable or
--     writable unless a policy below allows it.
--   * Pipeline-critical writes (candidates, submissions, stage changes,
--     interviews, shares, overrides) go through SECURITY DEFINER RPCs that
--     validate role, tenant and state. The browser cannot insert or update
--     those tables directly.
--   * Roles are stored in public.profiles and can only be changed by an
--     admin RPC. Sign-up metadata is never trusted for privileges.
--   * Helper functions live in the "private" schema, which is NOT exposed
--     through the Supabase API.
--   * Candidate contact details (email/phone/LinkedIn) live in a separate
--     table that clients cannot read (PII masking).
--   * Client budget and platform margin live in separate tables so vendors
--     never receive them, even by calling the API directly.
--   * AI provider is pinned to 'ollama' by CHECK constraints (no paid
--     fallback).
-- =====================================================================

begin;

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'admin',            -- HireNest HQ administrator
  'recruiter',        -- HireNest internal recruiter / operations
  'client_manager',   -- client hiring manager (can create requirements)
  'client_member',    -- client panel member / interviewer (read + feedback)
  'vendor_admin',     -- vendor agency owner
  'vendor_recruiter', -- vendor agency recruiter
  'candidate',        -- direct candidate
  'pending'           -- signed up as vendor/client, waiting for admin approval
);
create type public.user_status        as enum ('active', 'pending_approval', 'suspended');
create type public.org_type           as enum ('internal', 'client', 'vendor');
create type public.org_status         as enum ('pending_review', 'approved', 'suspended', 'rejected');
create type public.requirement_status as enum ('draft', 'pending_approval', 'open', 'on_hold', 'closed', 'filled');
create type public.candidate_source   as enum ('vendor', 'direct', 'internal');
create type public.submission_stage   as enum (
  'applied', 'recruiter_review', 'client_review', 'interviewing',
  'offered', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn', 'onboarded'
);
create type public.interview_round    as enum ('initial_screening', 'technical', 'managerial', 'final', 'ai_screening');
create type public.interview_status   as enum ('scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show');
create type public.interview_decision as enum ('advance', 'hold', 'reject', 'additional_assessment');
create type public.ai_modality        as enum ('text', 'audio', 'video');
create type public.dispute_status     as enum ('open', 'upheld', 'rejected');

-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- Tenants: HireNest HQ (internal), client companies, vendor agencies.
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 255),
  type          public.org_type not null,
  status        public.org_status not null default 'pending_review',
  industry      text,
  domain        text,
  gst_number    text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  sla_tier      text not null default 'standard' check (sla_tier in ('standard', 'premium', 'enterprise')),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Exactly one HireNest HQ organization.
create unique index organizations_one_internal on public.organizations (type) where type = 'internal';
create index organizations_type_status on public.organizations (type, status);

-- One profile per auth user. Role + org decide everything the user can see.
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  org_id            uuid references public.organizations (id) on delete restrict,
  role              public.app_role not null default 'candidate',
  status            public.user_status not null default 'active',
  full_name         text not null default '',
  email             text,
  phone             text,
  requested_role    text,   -- informational only (from sign-up form), never trusted
  requested_company text,   -- informational only
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_org on public.profiles (org_id);
create index profiles_role_status on public.profiles (role, status);

-- Canonical job / JD record. There is no separate "jobs" table.
create table public.requirements (
  id                    uuid primary key default gen_random_uuid(),
  client_org_id         uuid not null references public.organizations (id) on delete restrict,
  title                 text not null check (char_length(title) between 3 and 200),
  description           text not null check (char_length(description) >= 20),
  skills                text[] not null default '{}',
  min_experience        numeric(4,1) check (min_experience >= 0),
  max_experience        numeric(4,1) check (max_experience >= 0),
  location              text,
  work_mode             text check (work_mode in ('onsite', 'hybrid', 'remote')),
  employment_type       text check (employment_type in ('full_time', 'contract', 'contract_to_hire', 'part_time')),
  openings              integer not null default 1 check (openings > 0),
  vendor_visible_budget numeric(14,2) check (vendor_visible_budget >= 0),
  currency              text not null default 'INR',
  status                public.requirement_status not null default 'draft',
  is_public             boolean not null default false,  -- visible to direct candidates
  submission_sla_hours  integer not null default 48 check (submission_sla_hours between 1 and 720),
  created_by            uuid not null default auth.uid() references auth.users (id) on delete restrict,
  opened_at             timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (max_experience is null or min_experience is null or max_experience >= min_experience)
);
create index requirements_client_status on public.requirements (client_org_id, status);
create index requirements_public_open on public.requirements (status, is_public);
create index requirements_skills_gin on public.requirements using gin (skills);

-- Client-only financials (vendors can never read this table).
create table public.requirement_financials (
  requirement_id       uuid primary key references public.requirements (id) on delete cascade,
  actual_client_budget numeric(14,2) check (actual_client_budget >= 0),
  notes                text,
  updated_by           uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

-- HireNest-only margin (admin only).
create table public.requirement_margins (
  requirement_id  uuid primary key references public.requirements (id) on delete cascade,
  platform_margin numeric(14,2) check (platform_margin >= 0),
  margin_type     text check (margin_type in ('fixed', 'percentage')),
  updated_by      uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- Which vendor can see which requirement + the SLA clock for that vendor.
create table public.requirement_vendor_shares (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid not null references public.requirements (id) on delete cascade,
  vendor_org_id   uuid not null references public.organizations (id) on delete restrict,
  shared_by       uuid not null references auth.users (id) on delete restrict,
  shared_at       timestamptz not null default now(),
  due_at          timestamptz not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  revoked_at      timestamptz,
  unique (requirement_id, vendor_org_id),
  check (due_at > shared_at)
);
create index shares_vendor on public.requirement_vendor_shares (vendor_org_id, shared_at desc);

-- Master candidate registry. NO pipeline status here (status lives on submissions).
create table public.candidates (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid unique references auth.users (id) on delete set null, -- set for direct candidates
  full_name              text not null check (char_length(full_name) between 2 and 200),
  current_title          text,
  location               text,
  total_experience_years numeric(4,1) check (total_experience_years between 0 and 60),
  skills                 text[] not null default '{}',
  summary                text,
  resume_path            text,  -- storage path in the private "resumes" bucket
  resume_hash            text,  -- SHA-256 of the resume file, computed in the browser
  parsed_data            jsonb not null default '{}'::jsonb,
  original_source        public.candidate_source not null,          -- how the candidate first entered
  source_vendor_org_id   uuid references public.organizations (id), -- vendor that first brought them (never changes)
  owner_vendor_org_id    uuid references public.organizations (id), -- current vendor association (admin can change)
  created_by             uuid not null references auth.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((original_source = 'vendor') = (source_vendor_org_id is not null))
);
create unique index candidates_resume_hash on public.candidates (resume_hash) where resume_hash is not null;
create index candidates_owner_vendor on public.candidates (owner_vendor_org_id, created_at desc);
create index candidates_source on public.candidates (original_source, created_at desc);
create index candidates_skills_gin on public.candidates using gin (skills);

-- Contact PII, separated so clients never receive it.
create table public.candidate_contacts (
  candidate_id     uuid primary key references public.candidates (id) on delete cascade,
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text,
  linkedin_url     text,
  email_normalized text generated always as (lower(btrim(email))) stored,
  phone_normalized text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored,
  updated_at       timestamptz not null default now()
);
create unique index candidate_contacts_email on public.candidate_contacts (email_normalized) where email_normalized is not null;
create unique index candidate_contacts_phone on public.candidate_contacts (phone_normalized) where char_length(phone_normalized) = 10;

-- Duplicate / ownership conflicts are flagged for admin review, never silently merged.
create table public.duplicate_flags (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('candidate', 'submission')),
  match_type            text not null,  -- email | phone | resume_hash | same_requirement
  existing_candidate_id uuid references public.candidates (id) on delete cascade,
  requirement_id        uuid references public.requirements (id) on delete cascade,
  attempted_by          uuid not null references auth.users (id) on delete cascade,
  attempted_org_id      uuid references public.organizations (id) on delete set null,
  attempted_name        text,
  status                text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note       text,
  resolved_by           uuid references auth.users (id) on delete set null,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);
create index duplicate_flags_open on public.duplicate_flags (status, created_at desc);

-- Potential matches (explainable). A match is NOT an application.
create table public.candidate_matches (
  id               uuid primary key default gen_random_uuid(),
  requirement_id   uuid not null references public.requirements (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  computed_score   numeric(5,2) not null check (computed_score between 0 and 100),
  skill_score      numeric(5,2) check (skill_score between 0 and 100),
  experience_score numeric(5,2) check (experience_score between 0 and 100),
  override_score   numeric(5,2) check (override_score between 0 and 100),
  final_score      numeric(5,2) generated always as (coalesce(override_score, computed_score)) stored,
  matched_skills   text[] not null default '{}',
  unproven_skills  text[] not null default '{}',  -- not found on profile; NOT proof the skill is missing
  experience_note  text,
  evidence         jsonb not null default '{}'::jsonb,
  engine_version   text not null,
  calculated_at    timestamptz not null default now(),
  override_reason  text,
  overridden_by    uuid references auth.users (id) on delete set null,
  overridden_at    timestamptz,
  unique (requirement_id, candidate_id),
  check (override_score is null or char_length(coalesce(override_reason, '')) >= 5)
);
create index matches_requirement_score on public.candidate_matches (requirement_id, final_score desc);
create index matches_candidate_score on public.candidate_matches (candidate_id, final_score desc);

-- The candidate <-> requirement pipeline transaction (vendor submission OR direct application).
create table public.submissions (
  id                    uuid primary key default gen_random_uuid(),
  requirement_id        uuid not null references public.requirements (id) on delete restrict,
  candidate_id          uuid not null references public.candidates (id) on delete restrict,
  source                public.candidate_source not null,          -- vendor | direct | internal
  vendor_org_id         uuid references public.organizations (id), -- only for source = vendor
  submitted_by          uuid not null references auth.users (id) on delete restrict,
  stage                 public.submission_stage not null,
  stage_changed_at      timestamptz not null default now(),
  shared_with_client_at timestamptz,                               -- client can see it only after this is set
  is_valid              boolean not null default true,             -- recruiter can mark invalid (excluded from SLA)
  invalid_reason        text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (requirement_id, candidate_id),
  check ((source = 'vendor') = (vendor_org_id is not null))
);
create index submissions_requirement_stage on public.submissions (requirement_id, stage);
create index submissions_candidate on public.submissions (candidate_id);
create index submissions_vendor on public.submissions (vendor_org_id, created_at desc);

create table public.submission_stage_history (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  from_stage    public.submission_stage,
  to_stage      public.submission_stage not null,
  actor_id      uuid references auth.users (id) on delete set null,
  actor_role    public.app_role,
  reason        text,
  created_at    timestamptz not null default now()
);
create index stage_history_submission on public.submission_stage_history (submission_id, created_at);

create table public.interviews (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references public.submissions (id) on delete cascade,
  round_type       public.interview_round not null,
  round_number     integer not null check (round_number between 1 and 20),
  scheduled_at     timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  mode             text not null default 'video' check (mode in ('video', 'phone', 'in_person', 'ai_text')),
  meeting_link     text,
  status           public.interview_status not null default 'scheduled',
  created_by       uuid not null references auth.users (id) on delete restrict,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (submission_id, round_number)
);
create index interviews_submission on public.interviews (submission_id, scheduled_at);
create index interviews_status on public.interviews (status, scheduled_at);

-- Client rating after each interview round (1 = Poor, 5 = Excellent). Immutable once saved.
create table public.interview_feedback (
  id                     uuid primary key default gen_random_uuid(),
  interview_id           uuid not null references public.interviews (id) on delete cascade,
  rated_by               uuid not null default auth.uid() references auth.users (id) on delete restrict,
  rater_org_id           uuid references public.organizations (id),
  skill_rating           smallint not null check (skill_rating between 1 and 5),
  communication_rating   smallint not null check (communication_rating between 1 and 5),
  overall_rating         smallint not null check (overall_rating between 1 and 5),
  decision               public.interview_decision not null,
  feedback               text not null check (char_length(feedback) >= 10),
  evidence               text,
  visible_to_vendor      boolean not null default false, -- admin approves sharing
  visibility_approved_by uuid references auth.users (id) on delete set null,
  excluded_from_score    boolean not null default false, -- set when a dispute is upheld
  created_at             timestamptz not null default now(),
  unique (interview_id, rated_by)
);
create index interview_feedback_interview on public.interview_feedback (interview_id);

-- Candidate quality rating per submission (feeds the vendor quality score).
create table public.candidate_quality_feedback (
  id                     uuid primary key default gen_random_uuid(),
  submission_id          uuid not null references public.submissions (id) on delete cascade,
  rated_by               uuid not null default auth.uid() references auth.users (id) on delete restrict,
  rater_org_id           uuid references public.organizations (id),
  jd_skill_alignment     smallint not null check (jd_skill_alignment between 1 and 5),
  relevant_experience    smallint not null check (relevant_experience between 1 and 5),
  resume_accuracy        smallint not null check (resume_accuracy between 1 and 5),
  communication          smallint not null check (communication between 1 and 5),
  interview_readiness    smallint not null check (interview_readiness between 1 and 5),
  overall_suitability    smallint not null check (overall_suitability between 1 and 5),
  comments               text,
  visible_to_vendor      boolean not null default false,
  visibility_approved_by uuid references auth.users (id) on delete set null,
  excluded_from_score    boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (submission_id, rated_by)
);
create index quality_feedback_submission on public.candidate_quality_feedback (submission_id);

-- Vendor disputes on feedback that was shared with them.
create table public.rating_disputes (
  id              uuid primary key default gen_random_uuid(),
  feedback_kind   text not null check (feedback_kind in ('interview', 'quality')),
  feedback_id     uuid not null,
  vendor_org_id   uuid not null references public.organizations (id) on delete cascade,
  raised_by       uuid not null references auth.users (id) on delete restrict,
  reason          text not null check (char_length(reason) >= 20),
  status          public.dispute_status not null default 'open',
  resolved_by     uuid references auth.users (id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create unique index rating_disputes_one_open on public.rating_disputes (feedback_kind, feedback_id) where status = 'open';

-- AI first-round screening (Phase 2, behind a feature flag). Ollama only.
create table public.ai_screening_sessions (
  id                       uuid primary key default gen_random_uuid(),
  submission_id            uuid not null references public.submissions (id) on delete cascade,
  modality                 public.ai_modality not null default 'text',
  status                   text not null default 'not_started'
                           check (status in ('not_started', 'consent_pending', 'in_progress', 'completed', 'failed')),
  consent_at               timestamptz,
  questions                jsonb not null default '[]'::jsonb,
  responses                jsonb not null default '[]'::jsonb,
  communication_assessment jsonb,  -- kept separate from skill assessment (PRD 4.13)
  skill_assessment         jsonb,
  strengths                text[] not null default '{}',
  gaps                     text[] not null default '{}',
  follow_ups               text[] not null default '{}',
  model_provider           text not null default 'ollama' check (model_provider = 'ollama'),
  model_name               text,
  prompt_version           text,
  error                    text,
  created_by               uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at               timestamptz not null default now(),
  completed_at             timestamptz,
  check (status not in ('in_progress', 'completed') or consent_at is not null)
);
create index ai_sessions_submission on public.ai_screening_sessions (submission_id);

-- Single-row platform settings (score weights need explicit admin approval).
create table public.platform_settings (
  id                                smallint primary key default 1 check (id = 1),
  timing_weight                     numeric(5,2) not null default 30,
  quality_weight                    numeric(5,2) not null default 50,
  compliance_weight                 numeric(5,2) not null default 20,
  weights_approved                  boolean not null default false,
  weights_approved_by               uuid references auth.users (id) on delete set null,
  min_sample_size                   integer not null default 5 check (min_sample_size between 1 and 100),
  default_submission_sla_hours      integer not null default 48 check (default_submission_sla_hours between 1 and 720),
  share_vendor_summary_with_clients boolean not null default false,
  ai_provider                       text not null default 'ollama' check (ai_provider = 'ollama'),
  ai_screening_enabled              boolean not null default false,
  updated_by                        uuid references auth.users (id) on delete set null,
  updated_at                        timestamptz not null default now(),
  check (timing_weight >= 0 and quality_weight >= 0 and compliance_weight >= 0),
  check (timing_weight + quality_weight + compliance_weight = 100)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, read_at, created_at desc);

-- Event outbox (idempotent): future workers (email, WhatsApp, AI) consume this.
create table public.event_outbox (
  id              bigint generated always as identity primary key,
  event_type      text not null,
  entity_type     text not null,
  entity_id       uuid,
  payload         jsonb not null default '{}'::jsonb,
  actor_id        uuid,
  idempotency_key text not null unique,
  status          text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create index event_outbox_pending on public.event_outbox (status, created_at);

-- Append-only audit trail written by triggers.
create table public.audit_logs (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  uuid,
  action     text not null,
  actor_id   uuid,
  actor_role public.app_role,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_record on public.audit_logs (table_name, record_id, created_at desc);
create index audit_logs_created on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 3. PRIVATE HELPERS (not exposed through the API)
-- ---------------------------------------------------------------------

-- Current user's role, or NULL if suspended / pending / org not approved.
create or replace function private.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role
  from public.profiles p
  left join public.organizations o on o.id = p.org_id
  where p.id = auth.uid()
    and p.status = 'active'
    and (p.org_id is null or o.status = 'approved');
$$;

create or replace function private.my_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.org_id
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  where p.id = auth.uid() and p.status = 'active' and o.status = 'approved';
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false);
$$;

create or replace function private.is_internal()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('admin', 'recruiter'), false);
$$;

create or replace function private.is_client_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('client_manager', 'client_member'), false);
$$;

create or replace function private.is_vendor_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('vendor_admin', 'vendor_recruiter'), false);
$$;

create or replace function private.my_candidate_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.candidates c
  where c.user_id = auth.uid() and private.my_role() = 'candidate';
$$;

create or replace function private.internal_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select o.id from public.organizations o where o.type = 'internal';
$$;

create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function private.can_view_requirement(p_req uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requirements r
    where r.id = p_req
      and (
        private.is_internal()
        or (private.is_client_user() and r.client_org_id = private.my_org())
        or (private.is_vendor_user()
            and r.status in ('open', 'on_hold', 'closed', 'filled')
            and exists (select 1 from public.requirement_vendor_shares s
                        where s.requirement_id = r.id
                          and s.vendor_org_id = private.my_org()
                          and s.revoked_at is null))
        or (private.my_role() = 'candidate'
            and ((r.is_public and r.status = 'open')
                 or exists (select 1 from public.submissions sb
                            where sb.requirement_id = r.id
                              and sb.candidate_id = private.my_candidate_id())))
      )
  );
$$;

create or replace function private.can_view_candidate(p_cand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.candidates c
    where c.id = p_cand
      and (
        private.is_internal()
        or c.user_id = auth.uid()
        or (private.is_vendor_user()
            and (c.owner_vendor_org_id = private.my_org()
                 or exists (select 1 from public.submissions s
                            where s.candidate_id = c.id and s.vendor_org_id = private.my_org())))
        or (private.is_client_user()
            and exists (select 1 from public.submissions s
                        join public.requirements r on r.id = s.requirement_id
                        where s.candidate_id = c.id
                          and s.shared_with_client_at is not null
                          and r.client_org_id = private.my_org()))
      )
  );
$$;

-- Who may edit a candidate profile, its contacts and its resume file.
create or replace function private.can_manage_candidate(p_cand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.candidates c
    where c.id = p_cand
      and (
        private.is_internal()
        or (c.user_id = auth.uid() and private.my_role() = 'candidate')
        or (private.is_vendor_user() and c.owner_vendor_org_id = private.my_org())
      )
  );
$$;

create or replace function private.can_view_submission(p_sub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    join public.requirements r on r.id = s.requirement_id
    where s.id = p_sub
      and (
        private.is_internal()
        or (private.is_vendor_user() and s.vendor_org_id = private.my_org())
        or (private.is_client_user() and r.client_org_id = private.my_org() and s.shared_with_client_at is not null)
        or (s.candidate_id = private.my_candidate_id())
      )
  );
$$;

-- Client users of the requirement's company (after the submission is shared), or HQ.
create or replace function private.is_submission_client(p_sub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    join public.requirements r on r.id = s.requirement_id
    where s.id = p_sub
      and private.is_client_user()
      and r.client_org_id = private.my_org()
      and s.shared_with_client_at is not null
  );
$$;

create or replace function private.can_rate_interview(p_interview uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.interviews i
    where i.id = p_interview
      and i.status = 'completed'
      and (private.is_internal() or private.is_submission_client(i.submission_id))
  );
$$;

create or replace function private.can_rate_submission(p_sub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_sub
      and s.shared_with_client_at is not null
      and (private.is_internal() or private.is_submission_client(s.id))
  );
$$;

create or replace function private.can_edit_requirement_financials(p_req uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requirements r
    where r.id = p_req
      and (private.is_internal()
           or (private.my_role() = 'client_manager' and r.client_org_id = private.my_org()))
  );
$$;

create or replace function private.can_view_org(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    private.is_internal()
    or p_org = private.my_org()
    -- clients see the name of vendors whose candidates were shared with them
    or (private.is_client_user() and exists (
          select 1 from public.submissions s
          join public.requirements r on r.id = s.requirement_id
          where s.vendor_org_id = p_org
            and r.client_org_id = private.my_org()
            and s.shared_with_client_at is not null));
$$;

create or replace function private.is_allowed_transition(p_from public.submission_stage, p_to public.submission_stage)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from::text || '>' || p_to::text) = any (array[
    'applied>recruiter_review', 'applied>rejected', 'applied>withdrawn',
    'recruiter_review>client_review', 'recruiter_review>rejected', 'recruiter_review>withdrawn',
    'client_review>interviewing', 'client_review>rejected', 'client_review>withdrawn',
    'interviewing>offered', 'interviewing>rejected', 'interviewing>withdrawn',
    'offered>offer_accepted', 'offered>offer_declined', 'offered>withdrawn',
    'offer_accepted>onboarded', 'offer_accepted>withdrawn'
  ]);
$$;

create or replace function private.emit_event(
  p_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb, p_key text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.event_outbox (event_type, entity_type, entity_id, payload, actor_id, idempotency_key)
  values (p_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), auth.uid(),
          coalesce(p_key, p_type || ':' || coalesce(p_entity_id::text, '') || ':' || gen_random_uuid()::text))
  on conflict (idempotency_key) do nothing;
$$;

create or replace function private.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p_user, p_kind, p_title, p_body, p_link where p_user is not null;
$$;

create or replace function private.notify_org(p_org uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, p_kind, p_title, p_body, p_link
  from public.profiles p
  where p.org_id = p_org and p.status = 'active';
$$;

-- ---------------------------------------------------------------------
-- 4. TRIGGERS: timestamps, profile creation, integrity guards, audit
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'profiles', 'requirements', 'requirement_financials',
                           'requirement_margins', 'candidates', 'candidate_contacts', 'submissions',
                           'interviews', 'platform_settings']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;

-- New sign-up -> profile. Self sign-up can only ever become 'candidate' or 'pending'.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_intent text := coalesce(new.raw_user_meta_data ->> 'signup_intent', 'candidate');
begin
  insert into public.profiles (id, email, full_name, role, status, requested_role, requested_company)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_intent = 'candidate' then 'candidate'::public.app_role else 'pending'::public.app_role end,
    case when v_intent = 'candidate' then 'active'::public.user_status else 'pending_approval'::public.user_status end,
    left(v_intent, 30),
    left(new.raw_user_meta_data ->> 'company_name', 200)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Role must match the organization type.
create or replace function private.enforce_profile_consistency()
returns trigger language plpgsql set search_path = '' as $$
declare v_type public.org_type;
begin
  if new.org_id is not null then
    select o.type into v_type from public.organizations o where o.id = new.org_id;
  end if;

  if new.role in ('admin', 'recruiter') and v_type is distinct from 'internal' then
    raise exception 'Role % requires the HireNest internal organization', new.role;
  elsif new.role in ('client_manager', 'client_member') and v_type is distinct from 'client' then
    raise exception 'Role % requires a client organization', new.role;
  elsif new.role in ('vendor_admin', 'vendor_recruiter') and v_type is distinct from 'vendor' then
    raise exception 'Role % requires a vendor organization', new.role;
  elsif new.role in ('candidate', 'pending') and new.org_id is not null then
    raise exception 'Role % cannot belong to an organization', new.role;
  end if;
  return new;
end;
$$;

create trigger enforce_profile_consistency
  before insert or update of role, org_id on public.profiles
  for each row execute function private.enforce_profile_consistency();

-- Requirements must belong to a client org; non-HQ users always start in draft.
create or replace function private.requirement_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = new.client_org_id and o.type = 'client') then
    raise exception 'client_org_id must reference a client organization';
  end if;
  if tg_op = 'INSERT' and not private.is_internal() then
    new.status := 'draft';
    new.is_public := false;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger requirement_guard
  before insert or update of client_org_id on public.requirements
  for each row execute function private.requirement_guard();

-- Feedback: stamp rater identity server-side.
create or replace function private.stamp_rater()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.rated_by := auth.uid();
  new.rater_org_id := private.my_org();
  new.visible_to_vendor := false;
  new.visibility_approved_by := null;
  new.excluded_from_score := false;
  return new;
end;
$$;

create trigger stamp_rater before insert on public.interview_feedback
  for each row execute function private.stamp_rater();
create trigger stamp_rater before insert on public.candidate_quality_feedback
  for each row execute function private.stamp_rater();

create or replace function private.stamp_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  if new.weights_approved and (not old.weights_approved
      or new.timing_weight <> old.timing_weight
      or new.quality_weight <> old.quality_weight
      or new.compliance_weight <> old.compliance_weight) then
    new.weights_approved_by := auth.uid();
  elsif not new.weights_approved then
    new.weights_approved_by := null;
  end if;
  return new;
end;
$$;

create trigger stamp_settings before update on public.platform_settings
  for each row execute function private.stamp_settings();

-- Generic audit trigger. Contact PII is never copied into the audit log.
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_table_name = 'candidate_contacts' then
    v_old := case when v_old is not null then jsonb_build_object('redacted', true) end;
    v_new := case when v_new is not null then jsonb_build_object('redacted', true) end;
  end if;
  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data, new_data)
  values (
    tg_table_name,
    private.try_uuid(coalesce(v_row ->> 'id', v_row ->> 'requirement_id', v_row ->> 'candidate_id')),
    tg_op,
    auth.uid(),
    private.my_role(),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'profiles', 'requirements', 'requirement_financials',
                           'requirement_margins', 'requirement_vendor_shares', 'candidates',
                           'candidate_contacts', 'candidate_matches', 'submissions', 'interviews',
                           'interview_feedback', 'candidate_quality_feedback', 'rating_disputes',
                           'ai_screening_sessions', 'platform_settings', 'duplicate_flags']
  loop
    execute format('create trigger audit_row after insert or update or delete on public.%I
                    for each row execute function private.audit_row()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. DETERMINISTIC MATCHING ENGINE (no AI, no cost). Version: deterministic-v1
--    score = 70% skill overlap + 30% experience fit. Recruiter override wins.
-- ---------------------------------------------------------------------
create or replace function private.upsert_match(p_req uuid, p_cand uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  c public.candidates;
  v_req       text[];
  v_cand      text[];
  v_matched   text[];
  v_unproven  text[];
  v_skill     numeric;
  v_exp       numeric;
  v_note      text;
  v_score     numeric;
begin
  select * into r from public.requirements where id = p_req;
  select * into c from public.candidates where id = p_cand;
  if r.id is null or c.id is null then
    return;
  end if;

  v_req      := array(select distinct lower(btrim(x)) from unnest(r.skills) x where btrim(x) <> '');
  v_cand     := array(select distinct lower(btrim(x)) from unnest(c.skills) x where btrim(x) <> '');
  v_matched  := array(select x from unnest(v_req) x where x = any (v_cand) order by x);
  v_unproven := array(select x from unnest(v_req) x where not (x = any (v_cand)) order by x);

  if cardinality(v_req) = 0 then
    v_skill := null;
  else
    v_skill := round(100.0 * cardinality(v_matched) / cardinality(v_req), 2);
  end if;

  if c.total_experience_years is null then
    v_exp := null;
    v_note := 'Experience not stated on profile';
  elsif r.min_experience is null and r.max_experience is null then
    v_exp := 100;
    v_note := 'No experience range specified on requirement';
  elsif r.min_experience is not null and c.total_experience_years < r.min_experience then
    v_exp := greatest(0, 100 - (r.min_experience - c.total_experience_years) * 25);
    v_note := format('%s yrs vs minimum %s yrs', c.total_experience_years, r.min_experience);
  elsif r.max_experience is not null and c.total_experience_years > r.max_experience then
    v_exp := 80;
    v_note := format('%s yrs is above maximum %s yrs', c.total_experience_years, r.max_experience);
  else
    v_exp := 100;
    v_note := 'Within required experience range';
  end if;

  v_score := round(coalesce(v_skill, 0) * 0.7 + coalesce(v_exp, 0) * 0.3, 2);

  insert into public.candidate_matches (
    requirement_id, candidate_id, computed_score, skill_score, experience_score,
    matched_skills, unproven_skills, experience_note, evidence, engine_version, calculated_at)
  values (
    p_req, p_cand, v_score, v_skill, v_exp, v_matched, v_unproven, v_note,
    jsonb_build_object(
      'required_skills', to_jsonb(v_req),
      'weights', jsonb_build_object('skills', 0.7, 'experience', 0.3),
      'note', 'Unproven skills were not found on the profile; this is not proof the candidate lacks them.'),
    'deterministic-v1', now())
  on conflict (requirement_id, candidate_id) do update set
    computed_score   = excluded.computed_score,
    skill_score      = excluded.skill_score,
    experience_score = excluded.experience_score,
    matched_skills   = excluded.matched_skills,
    unproven_skills  = excluded.unproven_skills,
    experience_note  = excluded.experience_note,
    evidence         = excluded.evidence,
    engine_version   = excluded.engine_version,
    calculated_at    = excluded.calculated_at;
end;
$$;

create or replace function private.recompute_for_requirement(p_req uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.requirements where id = p_req and status = 'open') then
    perform private.upsert_match(p_req, c.id) from public.candidates c;
  end if;
end;
$$;

create or replace function private.recompute_for_candidate(p_cand uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.upsert_match(r.id, p_cand) from public.requirements r where r.status = 'open';
end;
$$;

create or replace function private.trg_requirement_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' then
    perform private.recompute_for_requirement(new.id);
  end if;
  return null;
end;
$$;

create trigger requirement_matches
  after insert or update of status, skills, min_experience, max_experience on public.requirements
  for each row execute function private.trg_requirement_matches();

create or replace function private.trg_candidate_matches()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recompute_for_candidate(new.id);
  return null;
end;
$$;

create trigger candidate_matches
  after insert or update of skills, total_experience_years on public.candidates
  for each row execute function private.trg_candidate_matches();

-- ---------------------------------------------------------------------
-- 6. VENDOR PERFORMANCE METRICS (timing, quality, compliance kept separate)
-- ---------------------------------------------------------------------
create or replace function private.vendor_metrics(p_vendor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  st public.platform_settings;
  v_timing  record;
  v_quality record;
  v_comp    record;
  v_interview_avg numeric;
  v_timing_score  numeric;
  v_quality_score numeric;
  v_comp_score    numeric;
  v_overall       numeric;
  v_overall_status text;
begin
  select * into st from public.platform_settings where id = 1;

  -- A. Submission timing / SLA
  with s as (
    select sh.*,
           (select min(sb.created_at) from public.submissions sb
             where sb.requirement_id = sh.requirement_id
               and sb.vendor_org_id = sh.vendor_org_id
               and sb.is_valid and sb.stage <> 'withdrawn') as first_sub
    from public.requirement_vendor_shares sh
    where sh.vendor_org_id = p_vendor
  ), ev as (
    select * from s
    where (first_sub is not null or due_at < now())
      and (revoked_at is null or first_sub is not null)
  )
  select
    count(*)                                                                    as evaluable,
    count(*) filter (where first_sub is not null and first_sub <= due_at)       as met,
    count(*) filter (where first_sub is not null and first_sub <= due_at
                       and shared_at > now() - interval '90 days')               as met_90d,
    count(*) filter (where shared_at > now() - interval '90 days')               as evaluable_90d,
    round(avg(extract(epoch from (acknowledged_at - shared_at)) / 3600)::numeric, 1) as avg_response_hours,
    round((avg(extract(epoch from (first_sub - shared_at)) / 3600)
           filter (where first_sub is not null))::numeric, 1)                      as avg_turnaround_hours
  into v_timing
  from ev;

  -- B. Candidate quality (client feedback on submitted candidates)
  select
    count(distinct q.submission_id) as rated_submissions,
    round(avg((q.jd_skill_alignment + q.relevant_experience + q.resume_accuracy
               + q.communication + q.interview_readiness + q.overall_suitability) / 6.0), 2) as avg_rating,
    round(avg(q.jd_skill_alignment), 2)  as jd_skill_alignment,
    round(avg(q.relevant_experience), 2) as relevant_experience,
    round(avg(q.resume_accuracy), 2)     as resume_accuracy,
    round(avg(q.communication), 2)       as communication,
    round(avg(q.interview_readiness), 2) as interview_readiness,
    round(avg(q.overall_suitability), 2) as overall_suitability
  into v_quality
  from public.candidate_quality_feedback q
  join public.submissions sb on sb.id = q.submission_id
  where sb.vendor_org_id = p_vendor and not q.excluded_from_score;

  select round(avg(f.overall_rating), 2) into v_interview_avg
  from public.interview_feedback f
  join public.interviews i on i.id = f.interview_id
  join public.submissions sb on sb.id = i.submission_id
  where sb.vendor_org_id = p_vendor and not f.excluded_from_score;

  -- C. Process compliance (valid + complete submissions)
  select
    count(*) as total,
    count(*) filter (where sb.is_valid and c.resume_path is not null and cardinality(c.skills) > 0) as compliant
  into v_comp
  from public.submissions sb
  join public.candidates c on c.id = sb.candidate_id
  where sb.vendor_org_id = p_vendor and sb.stage <> 'withdrawn';

  v_timing_score  := case when v_timing.evaluable >= st.min_sample_size
                          then round(100.0 * v_timing.met / v_timing.evaluable, 1) end;
  v_quality_score := case when v_quality.rated_submissions >= st.min_sample_size
                          then round((v_quality.avg_rating - 1) / 4.0 * 100, 1) end;
  v_comp_score    := case when v_comp.total >= st.min_sample_size
                          then round(100.0 * v_comp.compliant / v_comp.total, 1) end;

  if not st.weights_approved then
    v_overall_status := 'weights_not_approved';
  elsif v_timing_score is null or v_quality_score is null or v_comp_score is null then
    v_overall_status := 'not_enough_data';
  else
    v_overall := round((v_timing_score * st.timing_weight + v_quality_score * st.quality_weight
                        + v_comp_score * st.compliance_weight) / 100.0, 1);
    v_overall_status := 'ok';
  end if;

  return jsonb_build_object(
    'vendor_org_id', p_vendor,
    'min_sample_size', st.min_sample_size,
    'timing', jsonb_build_object(
      'status', case when v_timing_score is null then 'not_enough_data' else 'ok' end,
      'score', v_timing_score,
      'evaluable_shares', v_timing.evaluable,
      'sla_met', v_timing.met,
      'sla_compliance_90d_pct', case when v_timing.evaluable_90d > 0
                                     then round(100.0 * v_timing.met_90d / v_timing.evaluable_90d, 1) end,
      'avg_response_hours', v_timing.avg_response_hours,
      'avg_turnaround_hours', v_timing.avg_turnaround_hours),
    'quality', jsonb_build_object(
      'status', case when v_quality_score is null then 'not_enough_data' else 'ok' end,
      'score', v_quality_score,
      'rated_submissions', v_quality.rated_submissions,
      'avg_rating_1_to_5', v_quality.avg_rating,
      'dimensions', jsonb_build_object(
        'jd_skill_alignment', v_quality.jd_skill_alignment,
        'relevant_experience', v_quality.relevant_experience,
        'resume_accuracy', v_quality.resume_accuracy,
        'communication', v_quality.communication,
        'interview_readiness', v_quality.interview_readiness,
        'overall_suitability', v_quality.overall_suitability),
      'avg_interview_overall_1_to_5', v_interview_avg),
    'compliance', jsonb_build_object(
      'status', case when v_comp_score is null then 'not_enough_data' else 'ok' end,
      'score', v_comp_score,
      'submissions', v_comp.total,
      'compliant', v_comp.compliant),
    'overall', jsonb_build_object(
      'status', v_overall_status,
      'score', v_overall,
      'weights', jsonb_build_object('timing', st.timing_weight, 'quality', st.quality_weight,
                                    'compliance', st.compliance_weight, 'approved', st.weights_approved))
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.organizations              enable row level security;
alter table public.profiles                   enable row level security;
alter table public.requirements               enable row level security;
alter table public.requirement_financials     enable row level security;
alter table public.requirement_margins        enable row level security;
alter table public.requirement_vendor_shares  enable row level security;
alter table public.candidates                 enable row level security;
alter table public.candidate_contacts         enable row level security;
alter table public.duplicate_flags            enable row level security;
alter table public.candidate_matches          enable row level security;
alter table public.submissions                enable row level security;
alter table public.submission_stage_history   enable row level security;
alter table public.interviews                 enable row level security;
alter table public.interview_feedback         enable row level security;
alter table public.candidate_quality_feedback enable row level security;
alter table public.rating_disputes            enable row level security;
alter table public.ai_screening_sessions      enable row level security;
alter table public.platform_settings          enable row level security;
alter table public.notifications              enable row level security;
alter table public.event_outbox               enable row level security;
alter table public.audit_logs                 enable row level security;

-- organizations
create policy org_select on public.organizations for select to authenticated
  using (private.can_view_org(id));
create policy org_admin_insert on public.organizations for insert to authenticated
  with check (private.is_admin());
create policy org_admin_update on public.organizations for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- profiles
create policy profile_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_internal() or (org_id is not null and org_id = private.my_org()));
create policy profile_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- requirements
-- Evaluated on the row's own columns (not a lookup by id) so INSERT ... RETURNING works.
create policy req_select on public.requirements for select to authenticated
  using (
    private.is_internal()
    or (private.is_client_user() and client_org_id = private.my_org())
    or (private.is_vendor_user()
        and status in ('open', 'on_hold', 'closed', 'filled')
        and exists (select 1 from public.requirement_vendor_shares s
                    where s.requirement_id = requirements.id
                      and s.vendor_org_id = private.my_org()
                      and s.revoked_at is null))
    or (private.my_role() = 'candidate'
        and ((is_public and status = 'open')
             or exists (select 1 from public.submissions sb
                        where sb.requirement_id = requirements.id
                          and sb.candidate_id = private.my_candidate_id())))
  );
create policy req_insert on public.requirements for insert to authenticated
  with check (private.is_internal()
              or (private.my_role() = 'client_manager' and client_org_id = private.my_org()));
create policy req_update on public.requirements for update to authenticated
  using (private.is_internal()
         or (private.my_role() = 'client_manager' and client_org_id = private.my_org()
             and status in ('draft', 'pending_approval', 'open', 'on_hold')))
  with check (private.is_internal()
              or (private.my_role() = 'client_manager' and client_org_id = private.my_org()));

-- requirement_financials (client manager + HQ)
create policy fin_all on public.requirement_financials for all to authenticated
  using (private.can_edit_requirement_financials(requirement_id)
         or (private.is_client_user() and exists (select 1 from public.requirements r
               where r.id = requirement_id and r.client_org_id = private.my_org())))
  with check (private.can_edit_requirement_financials(requirement_id));

-- requirement_margins (admin only)
create policy margin_admin on public.requirement_margins for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- requirement_vendor_shares (HQ + the vendor itself; writes via RPC)
create policy share_select on public.requirement_vendor_shares for select to authenticated
  using (private.is_internal() or (private.is_vendor_user() and vendor_org_id = private.my_org()));

-- candidates (writes: insert via RPC, update via column grants below)
create policy cand_select on public.candidates for select to authenticated
  using (private.can_view_candidate(id));
create policy cand_update on public.candidates for update to authenticated
  using (private.can_manage_candidate(id)) with check (private.can_manage_candidate(id));

-- candidate_contacts (never clients)
create policy contact_select on public.candidate_contacts for select to authenticated
  using (private.can_manage_candidate(candidate_id));
create policy contact_update on public.candidate_contacts for update to authenticated
  using (private.can_manage_candidate(candidate_id)) with check (private.can_manage_candidate(candidate_id));

-- duplicate_flags (HQ only; resolve via RPC)
create policy dup_select on public.duplicate_flags for select to authenticated
  using (private.is_internal());

-- candidate_matches (read-only for users; written by the engine)
create policy match_select on public.candidate_matches for select to authenticated
  using (
    private.is_internal()
    or (private.is_vendor_user()
        and private.can_view_requirement(requirement_id)
        and exists (select 1 from public.candidates c
                    where c.id = candidate_id and c.owner_vendor_org_id = private.my_org()))
    or (private.is_client_user()
        and exists (select 1 from public.submissions s
                    join public.requirements r on r.id = s.requirement_id
                    where s.requirement_id = candidate_matches.requirement_id
                      and s.candidate_id = candidate_matches.candidate_id
                      and s.shared_with_client_at is not null
                      and r.client_org_id = private.my_org()))
    or (candidate_id = private.my_candidate_id() and private.can_view_requirement(requirement_id))
  );

-- submissions + history (writes via RPC only)
create policy sub_select on public.submissions for select to authenticated
  using (private.can_view_submission(id));
create policy hist_select on public.submission_stage_history for select to authenticated
  using (private.can_view_submission(submission_id));

-- interviews (writes via RPC only)
create policy interview_select on public.interviews for select to authenticated
  using (private.can_view_submission(submission_id));

-- interview_feedback
create policy ifb_select on public.interview_feedback for select to authenticated
  using (
    private.is_internal()
    or exists (select 1 from public.interviews i
               where i.id = interview_id and private.is_submission_client(i.submission_id))
    or (visible_to_vendor and private.is_vendor_user() and exists (
          select 1 from public.interviews i
          join public.submissions s on s.id = i.submission_id
          where i.id = interview_id and s.vendor_org_id = private.my_org()))
  );
create policy ifb_insert on public.interview_feedback for insert to authenticated
  with check (private.can_rate_interview(interview_id));

-- candidate_quality_feedback
create policy qfb_select on public.candidate_quality_feedback for select to authenticated
  using (
    private.is_internal()
    or private.is_submission_client(submission_id)
    or (visible_to_vendor and private.is_vendor_user() and exists (
          select 1 from public.submissions s
          where s.id = submission_id and s.vendor_org_id = private.my_org()))
  );
create policy qfb_insert on public.candidate_quality_feedback for insert to authenticated
  with check (private.can_rate_submission(submission_id));

-- rating_disputes (writes via RPC)
create policy dispute_select on public.rating_disputes for select to authenticated
  using (private.is_internal() or (private.is_vendor_user() and vendor_org_id = private.my_org()));

-- ai_screening_sessions (HQ manages; client reads completed reports for shared submissions)
create policy ai_select on public.ai_screening_sessions for select to authenticated
  using (private.is_internal() or (status = 'completed' and private.is_submission_client(submission_id)));
create policy ai_write on public.ai_screening_sessions for insert to authenticated
  with check (private.is_internal());
create policy ai_update on public.ai_screening_sessions for update to authenticated
  using (private.is_internal()) with check (private.is_internal());

-- platform_settings
create policy settings_select on public.platform_settings for select to authenticated
  using (private.is_internal());
create policy settings_update on public.platform_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- notifications
create policy notif_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notif_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- event_outbox / audit_logs
create policy outbox_select on public.event_outbox for select to authenticated
  using (private.is_admin());
create policy audit_select on public.audit_logs for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- 8. PRIVILEGES (least privilege; RLS still applies on top)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

grant insert, update on public.organizations to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

grant insert (client_org_id, title, description, skills, min_experience, max_experience, location,
              work_mode, employment_type, openings, vendor_visible_budget, currency, submission_sla_hours)
  on public.requirements to authenticated;
grant update (title, description, skills, min_experience, max_experience, location, work_mode,
              employment_type, openings, vendor_visible_budget, currency, submission_sla_hours)
  on public.requirements to authenticated;

-- update(requirement_id) is needed because supabase-js .upsert() sets every payload column
-- (including the key) on conflict; RLS WITH CHECK still limits which requirement it can target.
grant insert (requirement_id, actual_client_budget, notes), update (requirement_id, actual_client_budget, notes)
  on public.requirement_financials to authenticated;
grant insert (requirement_id, platform_margin, margin_type), update (requirement_id, platform_margin, margin_type)
  on public.requirement_margins to authenticated;

grant update (full_name, current_title, location, total_experience_years, skills, summary,
              resume_path, resume_hash, parsed_data)
  on public.candidates to authenticated;
grant update (email, phone, linkedin_url) on public.candidate_contacts to authenticated;

grant insert (interview_id, skill_rating, communication_rating, overall_rating, decision, feedback, evidence)
  on public.interview_feedback to authenticated;
grant insert (submission_id, jd_skill_alignment, relevant_experience, resume_accuracy, communication,
              interview_readiness, overall_suitability, comments)
  on public.candidate_quality_feedback to authenticated;

grant insert (submission_id, modality, status, consent_at, questions, model_name, prompt_version)
  on public.ai_screening_sessions to authenticated;
grant update (status, consent_at, questions, responses, communication_assessment, skill_assessment,
              strengths, gaps, follow_ups, model_name, prompt_version, error, completed_at)
  on public.ai_screening_sessions to authenticated;

grant update (timing_weight, quality_weight, compliance_weight, weights_approved, min_sample_size,
              default_submission_sla_hours, share_vendor_summary_with_clients, ai_screening_enabled)
  on public.platform_settings to authenticated;

grant update (read_at) on public.notifications to authenticated;

grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- 9. RPC FUNCTIONS (call with supabase.rpc('name', { ... }))
-- ---------------------------------------------------------------------

-- Admin: give a user a role + organization (also used to approve pending sign-ups).
create or replace function public.admin_assign_user(
  p_user_id uuid, p_role public.app_role, p_org_id uuid default null,
  p_status public.user_status default 'active')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role or status';
  end if;
  update public.profiles
     set role = p_role, org_id = p_org_id, status = p_status
   where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;
  perform private.emit_event('USER_ROLE_UPDATED', 'profile', p_user_id,
                             jsonb_build_object('role', p_role, 'org_id', p_org_id, 'status', p_status));
  perform private.notify_user(p_user_id, 'account', 'Your account access was updated',
                              'Your role is now ' || p_role::text || '.', '/');
end;
$$;

-- Requirement status workflow.
create or replace function public.set_requirement_status(
  p_requirement_id uuid, p_status public.requirement_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_ok boolean := false;
begin
  select * into r from public.requirements where id = p_requirement_id for update;
  if r.id is null then
    raise exception 'Requirement not found';
  end if;

  if private.is_internal() then
    v_ok := true;
  elsif private.my_role() = 'client_manager' and r.client_org_id = private.my_org() then
    v_ok := (r.status::text || '>' || p_status::text) = any (array[
      'draft>pending_approval', 'open>on_hold', 'on_hold>open', 'open>closed', 'on_hold>closed',
      'draft>closed', 'pending_approval>draft']);
  end if;

  if not v_ok then
    raise exception 'FORBIDDEN: cannot move requirement from % to %', r.status, p_status using errcode = '42501';
  end if;

  update public.requirements
     set status    = p_status,
         opened_at = case when p_status = 'open' and opened_at is null then now() else opened_at end,
         closed_at = case when p_status in ('closed', 'filled') then now() else null end
   where id = p_requirement_id;

  perform private.emit_event('REQUIREMENT_STATUS_UPDATED', 'requirement', p_requirement_id,
                             jsonb_build_object('from', r.status, 'to', p_status, 'reason', p_reason));
  if p_status = 'pending_approval' then
    perform private.notify_org(private.internal_org(), 'requirement', 'Requirement awaiting approval',
                               r.title, '/admin/requirements/' || r.id);
  end if;
end;
$$;

create or replace function public.set_requirement_public(p_requirement_id uuid, p_is_public boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.requirements set is_public = p_is_public where id = p_requirement_id;
  perform private.emit_event('REQUIREMENT_VISIBILITY_UPDATED', 'requirement', p_requirement_id,
                             jsonb_build_object('is_public', p_is_public));
end;
$$;

-- Share an open requirement with vendors. Starts each vendor's SLA clock.
create or replace function public.share_requirement_with_vendors(
  p_requirement_id uuid, p_vendor_org_ids uuid[], p_sla_hours integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_vendor uuid;
  v_hours integer;
  v_count integer := 0;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into r from public.requirements where id = p_requirement_id;
  if r.id is null or r.status <> 'open' then
    raise exception 'Requirement must exist and be open before sharing';
  end if;
  v_hours := coalesce(p_sla_hours, r.submission_sla_hours);

  foreach v_vendor in array coalesce(p_vendor_org_ids, '{}') loop
    if not exists (select 1 from public.organizations o
                   where o.id = v_vendor and o.type = 'vendor' and o.status = 'approved') then
      raise exception 'Organization % is not an approved vendor', v_vendor;
    end if;

    insert into public.requirement_vendor_shares (requirement_id, vendor_org_id, shared_by, shared_at, due_at)
    values (p_requirement_id, v_vendor, auth.uid(), now(), now() + make_interval(hours => v_hours))
    on conflict (requirement_id, vendor_org_id) do update
      set revoked_at = null,
          shared_by = excluded.shared_by,
          shared_at = excluded.shared_at,
          due_at = excluded.due_at,
          acknowledged_at = null,
          acknowledged_by = null
      where public.requirement_vendor_shares.revoked_at is not null;

    if found then
      v_count := v_count + 1;
      perform private.notify_org(v_vendor, 'requirement', 'New requirement shared with you',
                                 r.title || ' (submit within ' || v_hours || ' hours)',
                                 '/vendor/requirements/' || r.id);
      perform private.emit_event('REQUIREMENT_SHARED', 'requirement', p_requirement_id,
                                 jsonb_build_object('vendor_org_id', v_vendor, 'sla_hours', v_hours));
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.revoke_requirement_share(p_requirement_id uuid, p_vendor_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.requirement_vendor_shares
     set revoked_at = now()
   where requirement_id = p_requirement_id and vendor_org_id = p_vendor_org_id and revoked_at is null;
  perform private.emit_event('REQUIREMENT_SHARE_REVOKED', 'requirement', p_requirement_id,
                             jsonb_build_object('vendor_org_id', p_vendor_org_id));
end;
$$;

-- Vendor acknowledges a shared requirement (response-speed metric).
create or replace function public.acknowledge_requirement(p_requirement_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_vendor_user() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.requirement_vendor_shares
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where requirement_id = p_requirement_id
     and vendor_org_id = private.my_org()
     and revoked_at is null
     and acknowledged_at is null;
end;
$$;

-- Duplicate check before upload. Reveals only whether a duplicate exists, never whose.
create or replace function public.check_candidate_duplicate(
  p_email text default null, p_phone text default null, p_resume_hash text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cand uuid;
  v_type text;
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if private.my_role() is null or private.my_role() = 'pending' or private.is_client_user() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_resume_hash is not null then
    select id into v_cand from public.candidates where resume_hash = p_resume_hash;
    if v_cand is not null then v_type := 'resume_hash'; end if;
  end if;
  if v_cand is null and p_email is not null then
    select candidate_id into v_cand from public.candidate_contacts where email_normalized = lower(btrim(p_email));
    if v_cand is not null then v_type := 'email'; end if;
  end if;
  if v_cand is null and char_length(v_phone) = 10 then
    select candidate_id into v_cand from public.candidate_contacts where phone_normalized = v_phone;
    if v_cand is not null then v_type := 'phone'; end if;
  end if;

  return jsonb_build_object(
    'is_duplicate', v_cand is not null,
    'match_type', v_type,
    'can_access_existing', case when v_cand is null then null else private.can_manage_candidate(v_cand) end,
    'existing_candidate_id', case when v_cand is not null and private.can_manage_candidate(v_cand) then v_cand end);
end;
$$;

-- Create a candidate. Source is derived from the caller's role, never from input.
-- Returns {status:'created', candidate_id} or {status:'duplicate', match_type, flag_id}.
create or replace function public.create_candidate(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_linkedin_url text default null,
  p_current_title text default null,
  p_location text default null,
  p_total_experience_years numeric default null,
  p_skills text[] default '{}',
  p_summary text default null,
  p_resume_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_org uuid := private.my_org();
  v_source public.candidate_source;
  v_dup jsonb;
  v_flag uuid;
  v_id uuid;
begin
  if v_role in ('vendor_admin', 'vendor_recruiter') then
    v_source := 'vendor';
  elsif v_role in ('admin', 'recruiter') then
    v_source := 'internal';
  elsif v_role = 'candidate' then
    v_source := 'direct';
    if exists (select 1 from public.candidates where user_id = auth.uid()) then
      raise exception 'You already have a candidate profile';
    end if;
  else
    raise exception 'FORBIDDEN: your role cannot create candidates' using errcode = '42501';
  end if;

  v_dup := public.check_candidate_duplicate(p_email, p_phone, p_resume_hash);
  if (v_dup ->> 'is_duplicate')::boolean then
    insert into public.duplicate_flags (kind, match_type, existing_candidate_id, attempted_by, attempted_org_id, attempted_name)
    select 'candidate', v_dup ->> 'match_type', c.id, auth.uid(), v_org, left(p_full_name, 200)
    from public.candidates c
    where c.id = coalesce(
      (select id from public.candidates where resume_hash = p_resume_hash),
      (select candidate_id from public.candidate_contacts where email_normalized = lower(btrim(p_email))),
      (select candidate_id from public.candidate_contacts
        where phone_normalized = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
          and char_length(phone_normalized) = 10))
    returning id into v_flag;

    perform private.notify_org(private.internal_org(), 'duplicate', 'Duplicate candidate attempt',
                               'Matched on ' || (v_dup ->> 'match_type') || '. Review ownership.', '/admin/duplicates');
    perform private.emit_event('CANDIDATE_DUPLICATE_DETECTED', 'duplicate_flag', v_flag, v_dup - 'existing_candidate_id');
    return jsonb_build_object('status', 'duplicate', 'match_type', v_dup ->> 'match_type', 'flag_id', v_flag,
                              'existing_candidate_id', v_dup -> 'existing_candidate_id');
  end if;

  insert into public.candidates (
    user_id, full_name, current_title, location, total_experience_years, skills, summary, resume_hash,
    original_source, source_vendor_org_id, owner_vendor_org_id, created_by)
  values (
    case when v_source = 'direct' then auth.uid() end,
    btrim(p_full_name), p_current_title, p_location, p_total_experience_years,
    coalesce(p_skills, '{}'), p_summary, p_resume_hash,
    v_source,
    case when v_source = 'vendor' then v_org end,
    case when v_source = 'vendor' then v_org end,
    auth.uid())
  returning id into v_id;

  insert into public.candidate_contacts (candidate_id, email, phone, linkedin_url)
  values (v_id, nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_linkedin_url), ''));

  perform private.emit_event('CANDIDATE_CREATED', 'candidate', v_id, jsonb_build_object('source', v_source));
  return jsonb_build_object('status', 'created', 'candidate_id', v_id);
end;
$$;

-- Vendor or HQ submits a candidate to a requirement.
create or replace function public.submit_candidate(
  p_requirement_id uuid, p_candidate_id uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_source public.candidate_source;
  v_vendor uuid;
  v_existing uuid;
  v_id uuid;
begin
  select * into r from public.requirements where id = p_requirement_id;
  if r.id is null or r.status <> 'open' then
    raise exception 'Requirement is not open for submissions';
  end if;

  if private.is_vendor_user() then
    v_source := 'vendor';
    v_vendor := private.my_org();
    if not exists (select 1 from public.requirement_vendor_shares s
                   where s.requirement_id = r.id and s.vendor_org_id = v_vendor and s.revoked_at is null) then
      raise exception 'FORBIDDEN: requirement is not shared with your agency' using errcode = '42501';
    end if;
    if not exists (select 1 from public.candidates c where c.id = p_candidate_id and c.owner_vendor_org_id = v_vendor) then
      raise exception 'FORBIDDEN: candidate is not associated with your agency' using errcode = '42501';
    end if;
  elsif private.is_internal() then
    v_source := 'internal';
    v_vendor := null;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select id into v_existing from public.submissions
   where requirement_id = p_requirement_id and candidate_id = p_candidate_id;
  if v_existing is not null then
    insert into public.duplicate_flags (kind, match_type, existing_candidate_id, requirement_id, attempted_by, attempted_org_id)
    values ('submission', 'same_requirement', p_candidate_id, p_requirement_id, auth.uid(), private.my_org());
    perform private.notify_org(private.internal_org(), 'duplicate', 'Duplicate submission attempt',
                               r.title, '/admin/duplicates');
    return jsonb_build_object('status', 'duplicate', 'reason', 'Candidate is already in the pipeline for this requirement');
  end if;

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, notes)
  values (p_requirement_id, p_candidate_id, v_source, v_vendor, auth.uid(), 'recruiter_review', p_notes)
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'recruiter_review', auth.uid(), private.my_role(), 'Submitted');

  perform private.emit_event('SUBMISSION_CREATED', 'submission', v_id,
                             jsonb_build_object('source', v_source, 'vendor_org_id', v_vendor),
                             'SUBMISSION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New candidate submission',
                             r.title, '/admin/submissions/' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- Direct candidate explicitly applies (a match alone never creates an application).
create or replace function public.apply_to_requirement(p_requirement_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cand uuid := private.my_candidate_id();
  r public.requirements;
  v_id uuid;
begin
  if v_cand is null then
    raise exception 'Create your candidate profile before applying';
  end if;
  select * into r from public.requirements where id = p_requirement_id;
  if r.id is null or r.status <> 'open' or not r.is_public then
    raise exception 'This requirement is not open for direct applications';
  end if;
  if exists (select 1 from public.submissions where requirement_id = p_requirement_id and candidate_id = v_cand) then
    return jsonb_build_object('status', 'duplicate', 'reason', 'You are already in the pipeline for this requirement');
  end if;

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage)
  values (p_requirement_id, v_cand, 'direct', null, auth.uid(), 'applied')
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'applied', auth.uid(), 'candidate', 'Direct application');

  perform private.emit_event('DIRECT_APPLICATION_CREATED', 'submission', v_id, '{}'::jsonb,
                             'DIRECT_APPLICATION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New direct application',
                             r.title, '/admin/submissions/' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- Move a submission through the pipeline with role checks and history.
create or replace function public.transition_submission(
  p_submission_id uuid, p_to public.submission_stage, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  r public.requirements;
  v_allowed boolean := false;
begin
  select * into s from public.submissions where id = p_submission_id for update;
  if s.id is null then
    raise exception 'Submission not found';
  end if;
  select * into r from public.requirements where id = s.requirement_id;

  if not private.is_allowed_transition(s.stage, p_to) then
    raise exception 'Invalid transition from % to %', s.stage, p_to;
  end if;
  if p_to in ('rejected', 'withdrawn', 'offer_declined') and char_length(coalesce(btrim(p_reason), '')) < 3 then
    raise exception 'A reason is required for %', p_to;
  end if;

  if private.is_internal() then
    v_allowed := true;
  elsif private.is_submission_client(s.id) then
    v_allowed := (s.stage::text || '>' || p_to::text) = any (array[
      'client_review>interviewing', 'client_review>rejected', 'interviewing>offered', 'interviewing>rejected']);
  elsif p_to = 'withdrawn' and (
          (private.is_vendor_user() and s.vendor_org_id = private.my_org())
          or s.candidate_id = private.my_candidate_id()) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'FORBIDDEN: you cannot move this submission to %', p_to using errcode = '42501';
  end if;

  update public.submissions
     set stage = p_to,
         stage_changed_at = now(),
         shared_with_client_at = case when p_to = 'client_review' then coalesce(shared_with_client_at, now())
                                      else shared_with_client_at end
   where id = s.id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (s.id, s.stage, p_to, auth.uid(), private.my_role(), p_reason);

  perform private.emit_event('SUBMISSION_STAGE_TRANSITIONED', 'submission', s.id,
                             jsonb_build_object('from', s.stage, 'to', p_to));

  if p_to = 'client_review' then
    perform private.notify_org(r.client_org_id, 'submission', 'New candidate for review', r.title,
                               '/client/submissions/' || s.id);
  end if;
  if s.vendor_org_id is not null then
    perform private.notify_org(s.vendor_org_id, 'submission', 'Submission status updated',
                               r.title || ': ' || p_to::text, '/vendor/submissions/' || s.id);
  end if;
end;
$$;

create or replace function public.mark_submission_invalid(p_submission_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if char_length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'A reason is required';
  end if;
  update public.submissions set is_valid = false, invalid_reason = p_reason where id = p_submission_id;
  perform private.emit_event('SUBMISSION_MARKED_INVALID', 'submission', p_submission_id,
                             jsonb_build_object('reason', p_reason));
end;
$$;

-- Schedule an interview round (HQ or the client after the submission is shared).
create or replace function public.schedule_interview(
  p_submission_id uuid,
  p_round_type public.interview_round,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 60,
  p_mode text default 'video',
  p_meeting_link text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  v_round integer;
  v_id uuid;
begin
  select * into s from public.submissions where id = p_submission_id for update;
  if s.id is null then
    raise exception 'Submission not found';
  end if;
  if not (private.is_internal() or private.is_submission_client(s.id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if s.stage not in ('recruiter_review', 'client_review', 'interviewing') then
    raise exception 'Interviews cannot be scheduled at stage %', s.stage;
  end if;
  if s.stage = 'recruiter_review' and not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(max(round_number), 0) + 1 into v_round from public.interviews where submission_id = s.id;

  insert into public.interviews (submission_id, round_type, round_number, scheduled_at, duration_minutes,
                                 mode, meeting_link, created_by)
  values (s.id, p_round_type, v_round, p_scheduled_at, coalesce(p_duration_minutes, 60),
          coalesce(p_mode, 'video'), p_meeting_link, auth.uid())
  returning id into v_id;

  if s.stage = 'client_review' then
    update public.submissions set stage = 'interviewing', stage_changed_at = now() where id = s.id;
    insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
    values (s.id, 'client_review', 'interviewing', auth.uid(), private.my_role(), 'Interview scheduled');
  end if;

  perform private.emit_event('INTERVIEW_SCHEDULED', 'interview', v_id,
                             jsonb_build_object('submission_id', s.id, 'round', v_round, 'type', p_round_type));
  if s.vendor_org_id is not null then
    perform private.notify_org(s.vendor_org_id, 'interview', 'Interview scheduled',
                               p_round_type::text || ' on ' || to_char(p_scheduled_at, 'DD Mon YYYY HH24:MI'),
                               '/vendor/submissions/' || s.id);
  end if;
  return v_id;
end;
$$;

create or replace function public.update_interview_status(p_interview_id uuid, p_status public.interview_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.interviews;
  r public.requirements;
begin
  select * into i from public.interviews where id = p_interview_id for update;
  if i.id is null then
    raise exception 'Interview not found';
  end if;
  if not (private.is_internal() or private.is_submission_client(i.submission_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if i.status in ('completed', 'cancelled') then
    raise exception 'Interview is already %', i.status;
  end if;

  update public.interviews
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = i.id;

  perform private.emit_event('INTERVIEW_' || upper(p_status::text), 'interview', i.id);

  if p_status = 'completed' then
    select r2.* into r from public.requirements r2
      join public.submissions s on s.requirement_id = r2.id
     where s.id = i.submission_id;
    perform private.notify_org(r.client_org_id, 'feedback', 'Interview feedback pending',
                               r.title || ' - round ' || i.round_number, '/client/interviews/' || i.id);
  end if;
end;
$$;

-- Completed interviews in my scope that I have not rated yet.
create or replace function public.my_pending_feedback()
returns table (interview_id uuid, submission_id uuid, requirement_title text, candidate_name text,
               round_type public.interview_round, round_number integer, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.submission_id, r.title, c.full_name, i.round_type, i.round_number, i.completed_at
  from public.interviews i
  join public.submissions s on s.id = i.submission_id
  join public.requirements r on r.id = s.requirement_id
  join public.candidates c on c.id = s.candidate_id
  where i.status = 'completed'
    and private.can_rate_interview(i.id)
    and not exists (select 1 from public.interview_feedback f where f.interview_id = i.id and f.rated_by = auth.uid())
  order by i.completed_at desc
  limit 100;
$$;

-- Admin approves sharing a piece of feedback with the vendor.
create or replace function public.set_feedback_vendor_visibility(p_kind text, p_feedback_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind = 'interview' then
    update public.interview_feedback
       set visible_to_vendor = p_visible, visibility_approved_by = case when p_visible then auth.uid() end
     where id = p_feedback_id;
  elsif p_kind = 'quality' then
    update public.candidate_quality_feedback
       set visible_to_vendor = p_visible, visibility_approved_by = case when p_visible then auth.uid() end
     where id = p_feedback_id;
  else
    raise exception 'Unknown feedback kind %', p_kind;
  end if;
  if not found then
    raise exception 'Feedback not found';
  end if;
  perform private.emit_event('FEEDBACK_VISIBILITY_UPDATED', p_kind || '_feedback', p_feedback_id,
                             jsonb_build_object('visible_to_vendor', p_visible));
end;
$$;

-- Vendor admin disputes feedback that was shared with them.
create or replace function public.raise_rating_dispute(p_kind text, p_feedback_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid;
  v_id uuid;
begin
  if private.my_role() <> 'vendor_admin' then
    raise exception 'FORBIDDEN: vendor admin only' using errcode = '42501';
  end if;
  if p_kind = 'interview' then
    select s.vendor_org_id into v_vendor
      from public.interview_feedback f
      join public.interviews i on i.id = f.interview_id
      join public.submissions s on s.id = i.submission_id
     where f.id = p_feedback_id and f.visible_to_vendor;
  elsif p_kind = 'quality' then
    select s.vendor_org_id into v_vendor
      from public.candidate_quality_feedback q
      join public.submissions s on s.id = q.submission_id
     where q.id = p_feedback_id and q.visible_to_vendor;
  end if;
  if v_vendor is null or v_vendor <> private.my_org() then
    raise exception 'FORBIDDEN: feedback not visible to your agency' using errcode = '42501';
  end if;

  insert into public.rating_disputes (feedback_kind, feedback_id, vendor_org_id, raised_by, reason)
  values (p_kind, p_feedback_id, v_vendor, auth.uid(), p_reason)
  returning id into v_id;

  perform private.notify_org(private.internal_org(), 'dispute', 'New rating dispute', left(p_reason, 140),
                             '/admin/disputes/' || v_id);
  perform private.emit_event('RATING_DISPUTE_RAISED', 'rating_dispute', v_id);
  return v_id;
end;
$$;

create or replace function public.resolve_rating_dispute(p_dispute_id uuid, p_upheld boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.rating_disputes;
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into d from public.rating_disputes where id = p_dispute_id and status = 'open' for update;
  if d.id is null then
    raise exception 'Open dispute not found';
  end if;

  update public.rating_disputes
     set status = case when p_upheld then 'upheld'::public.dispute_status else 'rejected'::public.dispute_status end,
         resolved_by = auth.uid(), resolution_note = p_note, resolved_at = now()
   where id = d.id;

  if p_upheld then
    if d.feedback_kind = 'interview' then
      update public.interview_feedback set excluded_from_score = true where id = d.feedback_id;
    else
      update public.candidate_quality_feedback set excluded_from_score = true where id = d.feedback_id;
    end if;
  end if;

  perform private.notify_org(d.vendor_org_id, 'dispute', 'Rating dispute resolved',
                             case when p_upheld then 'Upheld' else 'Rejected' end || ': ' || coalesce(p_note, ''),
                             '/vendor/ratings');
  perform private.emit_event('RATING_DISPUTE_RESOLVED', 'rating_dispute', d.id, jsonb_build_object('upheld', p_upheld));
end;
$$;

-- Recruiter override of a match score (override wins; reason required). Pass NULL to clear.
create or replace function public.override_match(
  p_requirement_id uuid, p_candidate_id uuid, p_score numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.candidate_matches
     set override_score = p_score,
         override_reason = case when p_score is null then null else p_reason end,
         overridden_by = case when p_score is null then null else auth.uid() end,
         overridden_at = case when p_score is null then null else now() end
   where requirement_id = p_requirement_id and candidate_id = p_candidate_id;
  if not found then
    raise exception 'Match not found';
  end if;
  perform private.emit_event('MATCH_OVERRIDDEN', 'candidate_match', null,
                             jsonb_build_object('requirement_id', p_requirement_id, 'candidate_id', p_candidate_id,
                                                'score', p_score, 'reason', p_reason));
end;
$$;

-- HQ: force recompute of matches for one requirement.
create or replace function public.recompute_matches(p_requirement_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform private.recompute_for_requirement(p_requirement_id);
end;
$$;

-- HQ: resolve a duplicate / ownership flag (optionally reassign vendor ownership).
create or replace function public.resolve_duplicate_flag(
  p_flag_id uuid, p_note text, p_new_owner_vendor_org_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.duplicate_flags;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into f from public.duplicate_flags where id = p_flag_id and status = 'open' for update;
  if f.id is null then
    raise exception 'Open flag not found';
  end if;
  if p_new_owner_vendor_org_id is not null then
    if not private.is_admin() then
      raise exception 'FORBIDDEN: only admins can reassign ownership' using errcode = '42501';
    end if;
    update public.candidates set owner_vendor_org_id = p_new_owner_vendor_org_id where id = f.existing_candidate_id;
  end if;
  update public.duplicate_flags
     set status = 'resolved', resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = f.id;
end;
$$;

-- Admin: link an existing (e.g. vendor-sourced) candidate record to a candidate login.
create or replace function public.admin_link_candidate_account(p_candidate_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'candidate') then
    raise exception 'User must have the candidate role';
  end if;
  update public.candidates set user_id = p_user_id where id = p_candidate_id and user_id is null;
  if not found then
    raise exception 'Candidate not found or already linked';
  end if;
end;
$$;

-- Vendor performance for one vendor (HQ, that vendor, or clients if enabled).
create or replace function public.get_vendor_performance(p_vendor_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_metrics jsonb;
begin
  if private.is_internal()
     or (private.is_vendor_user() and private.my_org() = p_vendor_org_id) then
    return private.vendor_metrics(p_vendor_org_id);
  end if;

  if private.is_client_user()
     and (select share_vendor_summary_with_clients from public.platform_settings where id = 1)
     and private.can_view_org(p_vendor_org_id) then
    v_metrics := private.vendor_metrics(p_vendor_org_id);
    return jsonb_build_object('vendor_org_id', p_vendor_org_id, 'overall', v_metrics -> 'overall');
  end if;

  raise exception 'FORBIDDEN' using errcode = '42501';
end;
$$;

-- HQ: performance table for all approved vendors (paginated).
create or replace function public.admin_vendor_performance(p_limit integer default 50, p_offset integer default 0)
returns table (vendor_org_id uuid, vendor_name text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, private.vendor_metrics(o.id)
    from public.organizations o
    where o.type = 'vendor' and o.status = 'approved'
    order by o.name
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

-- HQ dashboard counters.
create or replace function public.admin_dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'clients', (select count(*) from public.organizations where type = 'client' and status = 'approved'),
    'vendors', (select count(*) from public.organizations where type = 'vendor' and status = 'approved'),
    'pending_users', (select count(*) from public.profiles where status = 'pending_approval'),
    'candidates_by_source', (select coalesce(jsonb_object_agg(original_source, n), '{}'::jsonb)
                               from (select original_source, count(*) n from public.candidates group by 1) x),
    'requirements_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                                 from (select status, count(*) n from public.requirements group by 1) x),
    'submissions_by_stage', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
                               from (select stage, count(*) n from public.submissions group by 1) x),
    'open_duplicate_flags', (select count(*) from public.duplicate_flags where status = 'open'),
    'open_disputes', (select count(*) from public.rating_disputes where status = 'open'),
    'interviews_pending_feedback', (select count(*) from public.interviews i
                                      where i.status = 'completed'
                                        and not exists (select 1 from public.interview_feedback f where f.interview_id = i.id))
  );
end;
$$;

-- Lock down function execution: only signed-in users, and each function checks roles itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------
-- 10. STORAGE: private resume bucket (path = <candidate_id>/<file name>)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy resumes_read on storage.objects for select to authenticated
  using (bucket_id = 'resumes'
         and private.can_manage_candidate(private.try_uuid((storage.foldername(name))[1])));
create policy resumes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes'
              and private.can_manage_candidate(private.try_uuid((storage.foldername(name))[1])));
create policy resumes_update on storage.objects for update to authenticated
  using (bucket_id = 'resumes'
         and private.can_manage_candidate(private.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'resumes'
              and private.can_manage_candidate(private.try_uuid((storage.foldername(name))[1])));
create policy resumes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and private.is_internal());

-- ---------------------------------------------------------------------
-- 11. SEED
-- ---------------------------------------------------------------------
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
insert into public.organizations (name, type, status) values ('HireNest Workforce', 'internal', 'approved');

commit;

notify pgrst, 'reload schema';
