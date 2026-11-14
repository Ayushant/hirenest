-- =====================================================================
-- Fix 1: Increase statement_timeout on create_candidate to avoid
--         "canceling statement due to statement timeout" during bulk import
-- Fix 2: When admin/recruiter submits a candidate owned by a vendor,
--         preserve vendor_org_id so the vendor can see the submission
-- =====================================================================

-- Fix 1: Recreate create_candidate with a 30-second statement timeout
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
returns jsonb language plpgsql security definer
  set search_path = ''
  set statement_timeout = '30s'
as $$
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

-- Fix 2: When admin submits a vendor-owned candidate, set vendor_org_id on the submission
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
    -- If the candidate belongs to a vendor, mark as vendor-sourced so the vendor can see it
    select owner_vendor_org_id into v_vendor
      from public.candidates where id = p_candidate_id;
    v_source := case when v_vendor is not null then 'vendor' else 'internal' end;
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
