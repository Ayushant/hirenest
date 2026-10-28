-- =====================================================================
-- 04_admin_review_gate.sql
-- Mandatory Admin-Recruiter validation gate before a submission can be
-- shared with a client. Depends on 01_schema.sql.
--
-- Run this in the Supabase SQL editor AFTER 01, 02, 03 have been applied.
-- Safe to re-run: all DDL uses IF NOT EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.submission_validation_state as enum (
    'pending_assessment',
    'pending_interview',
    'pending_clarification',
    'approved',
    'rejected_by_recruiter'
  );
exception when duplicate_object then null; end $$;

-- Add 'validation' to interview_round enum (idempotent).
alter type public.interview_round add value if not exists 'validation';

-- ---------------------------------------------------------------------
-- 2. SUBMISSIONS: new columns for the gate
-- ---------------------------------------------------------------------
alter table public.submissions
  add column if not exists validation_state public.submission_validation_state
    not null default 'pending_assessment',
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references auth.users (id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

-- Backfill: anything already past recruiter_review is implicitly approved.
update public.submissions
   set validation_state = 'approved',
       approved_at      = coalesce(approved_at, shared_with_client_at, stage_changed_at)
 where validation_state = 'pending_assessment'
   and stage not in ('applied', 'recruiter_review');

create index if not exists submissions_validation_state
  on public.submissions (validation_state);

-- ---------------------------------------------------------------------
-- 3. ASSESSMENT (JD <-> resume) with recruiter override + audit log
-- ---------------------------------------------------------------------
create table if not exists public.submission_assessments (
  id                        uuid primary key default gen_random_uuid(),
  submission_id             uuid not null unique references public.submissions (id) on delete cascade,
  ai_match_pct              numeric(5,2) check (ai_match_pct between 0 and 100),
  ai_matched_skills         text[] not null default '{}',
  ai_missing_skills         text[] not null default '{}',
  ai_unverified_skills      text[] not null default '{}',
  ai_experience_gap_months  integer,
  ai_location_gap           text,
  ai_work_mode_gap          text,
  ai_evidence               jsonb not null default '{}'::jsonb,
  recruiter_match_pct       numeric(5,2) check (recruiter_match_pct between 0 and 100),
  recruiter_matched_skills  text[],
  recruiter_missing_skills  text[],
  recruiter_notes           text,
  reviewed_by               uuid references auth.users (id) on delete set null,
  reviewed_at               timestamptz,
  model_name                text,
  prompt_version            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists submission_assessments_reviewed
  on public.submission_assessments (reviewed_at);

create table if not exists public.submission_assessment_edits (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public.submission_assessments (id) on delete cascade,
  edited_by       uuid not null references auth.users (id) on delete restrict,
  field           text not null,
  old_value       jsonb,
  new_value       jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists assessment_edits_assessment
  on public.submission_assessment_edits (assessment_id, created_at);

-- ---------------------------------------------------------------------
-- 4. VALIDATION INTERVIEWS (10-15 min admin recruiter call)
-- ---------------------------------------------------------------------
create table if not exists public.validation_interviews (
  id                   uuid primary key default gen_random_uuid(),
  submission_id        uuid not null unique references public.submissions (id) on delete cascade,
  interview_id         uuid not null references public.interviews (id) on delete restrict,
  attendance           text not null check (attendance in ('attended','no_show','rescheduled')),
  communication_score  smallint check (communication_score between 1 and 5),
  technical_score      smallint check (technical_score between 1 and 5),
  verified_skills      text[] not null default '{}',
  missing_skills       text[] not null default '{}',
  notes                text,
  recommendation       text not null check (recommendation in ('approve','reject','needs_clarification')),
  conducted_by         uuid not null references auth.users (id) on delete restrict,
  conducted_at         timestamptz not null default now()
);
create index if not exists validation_interviews_conducted
  on public.validation_interviews (conducted_at desc);

-- ---------------------------------------------------------------------
-- 5. MISSING-SKILLS CLARIFICATIONS (routed to vendor OR candidate)
-- ---------------------------------------------------------------------
create table if not exists public.submission_clarifications (
  id                        uuid primary key default gen_random_uuid(),
  submission_id             uuid not null references public.submissions (id) on delete cascade,
  requested_by              uuid not null references auth.users (id) on delete restrict,
  routed_to_vendor_org_id   uuid references public.organizations (id) on delete cascade,
  routed_to_candidate_id    uuid references public.candidates (id) on delete cascade,
  missing_skills            text[] not null,
  questions                 text not null check (char_length(questions) >= 5),
  status                    text not null default 'open'
                            check (status in ('open','responded','resolved','abandoned')),
  response                  text,
  updated_resume_url        text,
  resolved_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check ((routed_to_vendor_org_id is not null) <> (routed_to_candidate_id is not null))
);
create index if not exists clarifications_submission
  on public.submission_clarifications (submission_id, created_at desc);
create index if not exists clarifications_open_vendor
  on public.submission_clarifications (routed_to_vendor_org_id, status);
create index if not exists clarifications_open_candidate
  on public.submission_clarifications (routed_to_candidate_id, status);

-- ---------------------------------------------------------------------
-- 6. TIMESTAMP TRIGGERS on the new tables
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['submission_assessments','submission_clarifications']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.submission_assessments        enable row level security;
alter table public.submission_assessment_edits   enable row level security;
alter table public.validation_interviews         enable row level security;
alter table public.submission_clarifications     enable row level security;

-- assessments: internal always; clients only after sharing; vendor/candidate own records
drop policy if exists sa_select on public.submission_assessments;
create policy sa_select on public.submission_assessments for select to authenticated
  using (
    private.is_internal()
    or exists (select 1 from public.submissions s
                 where s.id = submission_id
                   and (
                     (private.is_vendor_user() and s.vendor_org_id = private.my_org())
                     or s.candidate_id = private.my_candidate_id()
                     or (private.is_client_user() and s.shared_with_client_at is not null
                         and exists (select 1 from public.requirements r
                                       where r.id = s.requirement_id
                                         and r.client_org_id = private.my_org()))
                   )));

drop policy if exists sa_write on public.submission_assessments;
create policy sa_write on public.submission_assessments for all to authenticated
  using (private.is_internal()) with check (private.is_internal());

drop policy if exists sae_select on public.submission_assessment_edits;
create policy sae_select on public.submission_assessment_edits for select to authenticated
  using (private.is_internal());
drop policy if exists sae_insert on public.submission_assessment_edits;
create policy sae_insert on public.submission_assessment_edits for insert to authenticated
  with check (private.is_internal());

drop policy if exists vi_select on public.validation_interviews;
create policy vi_select on public.validation_interviews for select to authenticated
  using (
    private.is_internal()
    or exists (select 1 from public.submissions s
                 where s.id = submission_id and s.shared_with_client_at is not null
                   and ((private.is_vendor_user() and s.vendor_org_id = private.my_org())
                        or s.candidate_id = private.my_candidate_id()
                        or (private.is_client_user() and exists (
                             select 1 from public.requirements r
                              where r.id = s.requirement_id and r.client_org_id = private.my_org()))))
  );
drop policy if exists vi_write on public.validation_interviews;
create policy vi_write on public.validation_interviews for all to authenticated
  using (private.is_internal()) with check (private.is_internal());

drop policy if exists cl_select on public.submission_clarifications;
create policy cl_select on public.submission_clarifications for select to authenticated
  using (
    private.is_internal()
    or (routed_to_vendor_org_id is not null and routed_to_vendor_org_id = private.my_org())
    or (routed_to_candidate_id is not null and routed_to_candidate_id = private.my_candidate_id())
  );
drop policy if exists cl_insert on public.submission_clarifications;
create policy cl_insert on public.submission_clarifications for insert to authenticated
  with check (private.is_internal());
drop policy if exists cl_update on public.submission_clarifications;
create policy cl_update on public.submission_clarifications for update to authenticated
  using (
    private.is_internal()
    or (routed_to_vendor_org_id is not null and routed_to_vendor_org_id = private.my_org())
    or (routed_to_candidate_id is not null and routed_to_candidate_id = private.my_candidate_id())
  );

-- Allow candidate/vendor to update only response + resume + status via column grants
revoke all on public.submission_clarifications from authenticated;
grant select on public.submission_clarifications to authenticated;
grant update (response, updated_resume_url, status) on public.submission_clarifications to authenticated;

-- ---------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------

-- 8a. apply_to_requirement: route direct applies through recruiter_review.
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

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, validation_state)
  values (p_requirement_id, v_cand, 'direct', null, auth.uid(), 'recruiter_review', 'pending_assessment')
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'recruiter_review', auth.uid(), 'candidate', 'Direct application - routed to Admin review');

  insert into public.submission_assessments (submission_id) values (v_id);

  perform private.emit_event('DIRECT_APPLICATION_CREATED', 'submission', v_id, '{}'::jsonb,
                             'DIRECT_APPLICATION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New direct application',
                             r.title, '/admin/submissions/' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- 8b. submit_candidate: also seed an assessment row.
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

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, notes, validation_state)
  values (p_requirement_id, p_candidate_id, v_source, v_vendor, auth.uid(), 'recruiter_review', p_notes, 'pending_assessment')
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'recruiter_review', auth.uid(), private.my_role(), 'Submitted');

  insert into public.submission_assessments (submission_id) values (v_id);

  perform private.emit_event('SUBMISSION_CREATED', 'submission', v_id,
                             jsonb_build_object('source', v_source, 'vendor_org_id', v_vendor),
                             'SUBMISSION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New candidate submission',
                             r.title, '/admin/submissions/' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- 8c. review_submission_assessment: admin recruiter corrects AI findings with audit log.
create or replace function public.review_submission_assessment(
  p_submission_id uuid,
  p_patch        jsonb,
  p_reason       text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.submission_assessments;
  k text;
  v jsonb;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into a from public.submission_assessments where submission_id = p_submission_id for update;
  if a.id is null then
    insert into public.submission_assessments (submission_id) values (p_submission_id)
    returning * into a;
  end if;

  for k, v in select * from jsonb_each(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('recruiter_match_pct','recruiter_matched_skills',
                 'recruiter_missing_skills','recruiter_notes',
                 'ai_matched_skills','ai_missing_skills','ai_unverified_skills',
                 'ai_experience_gap_months','ai_location_gap','ai_work_mode_gap') then
      raise exception 'Field % is not editable', k;
    end if;
    insert into public.submission_assessment_edits (assessment_id, edited_by, field, old_value, new_value, reason)
    values (a.id, auth.uid(), k, to_jsonb(a)->k, v, p_reason);
  end loop;

  update public.submission_assessments
     set recruiter_match_pct      = coalesce((p_patch->>'recruiter_match_pct')::numeric, recruiter_match_pct),
         recruiter_matched_skills = coalesce(array(select jsonb_array_elements_text(p_patch->'recruiter_matched_skills')),
                                             recruiter_matched_skills),
         recruiter_missing_skills = coalesce(array(select jsonb_array_elements_text(p_patch->'recruiter_missing_skills')),
                                             recruiter_missing_skills),
         recruiter_notes          = coalesce(p_patch->>'recruiter_notes', recruiter_notes),
         reviewed_by              = auth.uid(),
         reviewed_at              = now()
   where id = a.id;

  update public.submissions
     set validation_state = case when validation_state = 'pending_assessment'
                                 then 'pending_interview'::public.submission_validation_state
                                 else validation_state end
   where id = p_submission_id;
end;
$$;

-- 8d. record_validation_interview: logs the 10-15 min call and sets the next state.
create or replace function public.record_validation_interview(
  p_submission_id       uuid,
  p_scheduled_at        timestamptz,
  p_duration_minutes    integer,
  p_mode                text,
  p_attendance          text,
  p_communication_score smallint,
  p_technical_score     smallint,
  p_verified_skills     text[],
  p_missing_skills      text[],
  p_notes               text,
  p_recommendation      text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_int_id uuid;
  v_round int;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 30 then
    raise exception 'Validation interview must be 5-30 minutes';
  end if;

  select coalesce(max(round_number), 0) + 1 into v_round
    from public.interviews where submission_id = p_submission_id;

  insert into public.interviews (submission_id, round_type, round_number, scheduled_at,
                                 duration_minutes, mode, status, created_by, completed_at)
  values (p_submission_id, 'validation', v_round, p_scheduled_at,
          p_duration_minutes, coalesce(p_mode,'video'),
          case when p_attendance = 'rescheduled' then 'rescheduled'
               when p_attendance = 'no_show'     then 'no_show'
               else 'completed' end,
          auth.uid(),
          case when p_attendance = 'attended' then now() end)
  returning id into v_int_id;

  insert into public.validation_interviews (submission_id, interview_id, attendance,
                                            communication_score, technical_score,
                                            verified_skills, missing_skills, notes,
                                            recommendation, conducted_by)
  values (p_submission_id, v_int_id, p_attendance,
          p_communication_score, p_technical_score,
          coalesce(p_verified_skills, '{}'), coalesce(p_missing_skills, '{}'),
          p_notes, p_recommendation, auth.uid())
  on conflict (submission_id) do update
     set interview_id = excluded.interview_id,
         attendance   = excluded.attendance,
         communication_score = excluded.communication_score,
         technical_score     = excluded.technical_score,
         verified_skills     = excluded.verified_skills,
         missing_skills      = excluded.missing_skills,
         notes               = excluded.notes,
         recommendation      = excluded.recommendation,
         conducted_by        = excluded.conducted_by,
         conducted_at        = now();

  update public.submissions
     set validation_state = case p_recommendation
                              when 'approve'              then 'pending_assessment' -- stays pending until approve_submission()
                              when 'reject'               then 'rejected_by_recruiter'
                              when 'needs_clarification'  then 'pending_clarification'
                            end::public.submission_validation_state,
         rejected_by     = case when p_recommendation = 'reject' then auth.uid() end,
         rejected_at     = case when p_recommendation = 'reject' then now()      end,
         rejection_reason= case when p_recommendation = 'reject' then p_notes    end
   where id = p_submission_id
     and validation_state <> 'approved';

  return v_int_id;
end;
$$;

-- 8e. approve_submission: explicit admin-recruiter approval gate.
create or replace function public.approve_submission(p_submission_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  a public.submission_assessments;
  vi public.validation_interviews;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into s from public.submissions where id = p_submission_id for update;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.validation_state = 'approved' then return; end if;
  if s.validation_state = 'rejected_by_recruiter' then
    raise exception 'Submission was rejected; cannot approve';
  end if;

  select * into a from public.submission_assessments where submission_id = p_submission_id;
  if a.id is null or a.reviewed_at is null then
    raise exception 'Assessment review must be completed before approval';
  end if;

  select * into vi from public.validation_interviews where submission_id = p_submission_id;
  if vi.id is null then
    raise exception 'Validation interview must be recorded before approval';
  end if;
  if vi.recommendation <> 'approve' then
    raise exception 'Validation interview recommendation is %, cannot approve', vi.recommendation;
  end if;

  if exists (select 1 from public.submission_clarifications
              where submission_id = p_submission_id and status in ('open','responded')) then
    raise exception 'Open clarification requests must be resolved before approval';
  end if;

  update public.submissions
     set validation_state = 'approved',
         approved_by      = auth.uid(),
         approved_at      = now()
   where id = p_submission_id;
end;
$$;

-- 8f. request_clarification: route missing-skill questions.
create or replace function public.request_clarification(
  p_submission_id  uuid,
  p_missing_skills text[],
  p_questions      text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  v_vendor uuid;
  v_cand   uuid;
  v_id     uuid;
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into s from public.submissions where id = p_submission_id;
  if s.id is null then raise exception 'Submission not found'; end if;

  if s.source = 'vendor' then
    v_vendor := s.vendor_org_id;
  else
    v_cand := s.candidate_id;
  end if;

  insert into public.submission_clarifications
    (submission_id, requested_by, routed_to_vendor_org_id, routed_to_candidate_id,
     missing_skills, questions)
  values (p_submission_id, auth.uid(), v_vendor, v_cand,
          coalesce(p_missing_skills, '{}'), p_questions)
  returning id into v_id;

  update public.submissions
     set validation_state = 'pending_clarification'
   where id = p_submission_id
     and validation_state <> 'approved';

  if v_vendor is not null then
    perform private.notify_org(v_vendor, 'clarification', 'Clarification requested',
                               'Missing skills follow-up', '/vendor/submissions/' || p_submission_id);
  end if;
  return v_id;
end;
$$;

-- 8g. resolve_clarification: candidate/vendor responds; admin can mark resolved.
create or replace function public.resolve_clarification(
  p_clarification_id uuid,
  p_mark_resolved    boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.submission_clarifications;
begin
  select * into c from public.submission_clarifications where id = p_clarification_id;
  if c.id is null then raise exception 'Clarification not found'; end if;

  if p_mark_resolved then
    if not private.is_internal() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    update public.submission_clarifications
       set status = 'resolved', resolved_at = now()
     where id = p_clarification_id;

    if not exists (select 1 from public.submission_clarifications
                    where submission_id = c.submission_id and status in ('open','responded')) then
      update public.submissions
         set validation_state = 'pending_assessment'
       where id = c.submission_id
         and validation_state = 'pending_clarification';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. HARDEN transition_submission: block client_review until approved.
-- ---------------------------------------------------------------------
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

  -- *** HARD GATE: no submission reaches a client without admin approval ***
  if p_to = 'client_review' then
    if s.validation_state <> 'approved' or s.approved_by is null then
      raise exception 'Admin Recruiter approval required before sharing with client'
        using errcode = '42501';
    end if;
    if not private.is_internal() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
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

-- ---------------------------------------------------------------------
-- 10. GRANTS
-- ---------------------------------------------------------------------
grant execute on function public.review_submission_assessment(uuid, jsonb, text) to authenticated;
grant execute on function public.record_validation_interview(
  uuid, timestamptz, integer, text, text, smallint, smallint,
  text[], text[], text, text) to authenticated;
grant execute on function public.approve_submission(uuid)         to authenticated;
grant execute on function public.request_clarification(uuid, text[], text) to authenticated;
grant execute on function public.resolve_clarification(uuid, boolean)      to authenticated;

-- =====================================================================
-- END OF 04_admin_review_gate.sql
-- =====================================================================
