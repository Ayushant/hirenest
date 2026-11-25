-- Keep uploads and employment in one transaction; reuse canonical candidate records.
create or replace function public.create_candidate_with_employment(p_candidate jsonb,p_employment jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result := public.create_candidate(
 p_full_name=>p_candidate->>'p_full_name',p_email=>p_candidate->>'p_email',
 p_phone=>p_candidate->>'p_phone',p_linkedin_url=>p_candidate->>'p_linkedin_url',
 p_current_title=>p_candidate->>'p_current_title',p_location=>p_candidate->>'p_location',
 p_total_experience_years=>nullif(p_candidate->>'p_total_experience_years','')::numeric,
 p_skills=>array(select jsonb_array_elements_text(coalesce(p_candidate->'p_skills','[]'))),
 p_summary=>p_candidate->>'p_summary',p_resume_hash=>p_candidate->>'p_resume_hash');
 if result->>'status'='created' then
   if not private.can_access_candidate_employment((result->>'candidate_id')::uuid,'edit') then
     raise exception 'Employment edit access denied' using errcode='42501';
   end if;
   perform private.save_candidate_employment((result->>'candidate_id')::uuid,p_employment);
 end if;
 return result;
end $$;
revoke all on function public.create_candidate_with_employment(jsonb,jsonb) from public,anon;
grant execute on function public.create_candidate_with_employment(jsonb,jsonb) to authenticated;

-- Decode the existing requirement metadata instead of introducing another policy record.
create or replace function private.decode_requirement_text(value text) returns text
language plpgsql immutable set search_path='' as $$
declare part text; bytes bytea := ''::bytea;
begin
 for part in select (regexp_matches(value,'%[0-9a-fA-F]{2}|.','g'))[1] loop
   bytes := bytes || case when part ~ '^%[0-9a-fA-F]{2}$' then decode(substr(part,2),'hex') else convert_to(part,'UTF8') end;
 end loop;
 return convert_from(bytes,'UTF8');
exception when others then return value;
end $$;
revoke all on function private.decode_requirement_text(text) from public,anon,authenticated;

create or replace function private.candidate_availability(p_requirement uuid,p_candidate uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.requirements; e public.candidate_employment; policy text; reason text;
begin
 select * into r from public.requirements where id=p_requirement;
 policy := lower(coalesce(r.description,'') || E'\n' || private.decode_requirement_text(coalesce(substring(r.currency from '\|join=([^|]*)'),'')));
 -- Require explicit mandatory wording. "Immediate preferred" does not qualify.
 if policy !~ '\m(immediate(ly)?([[:space:]-]+joiners?)?[[:space:]]+only|only[[:space:]]+immediate(ly)?([[:space:]-]+joiners?)?)\M'
    or policy ~ '\m(not|no)[[:space:]]+(immediate(ly)?([[:space:]-]+joiners?)?[[:space:]]+only|only[[:space:]]+immediate)' then
   return jsonb_build_object('status','not_applicable','reason','No explicit immediate-only joining restriction.');
 end if;
 select * into e from public.candidate_employment where candidate_id=p_candidate;
 if e.notice_period in ('15_30','30_plus') then reason := 'Notice period is ' || case e.notice_period when '15_30' then '15–30 days' else '30 days+' end || '.';
 elsif e.expected_joining_date > (now() at time zone 'UTC')::date then reason := 'Expected joining date is ' || e.expected_joining_date || '.';
 elsif e.notice_period='serving' and e.last_working_day > (now() at time zone 'UTC')::date then reason := 'Last working day is ' || e.last_working_day || '.';
 end if;
 if reason is not null then
   return jsonb_build_object('status','ineligible','reason','Availability mismatch: this requirement accepts immediate joiners only. ' || reason);
 elsif e.notice_period='immediate' or (e.notice_period='serving' and e.last_working_day <= (now() at time zone 'UTC')::date)
    or (e.notice_period is null and e.expected_joining_date <= (now() at time zone 'UTC')::date) then
   return jsonb_build_object('status','eligible','reason','Immediate availability confirmed.');
 end if;
 return jsonb_build_object('status','needs_review','reason','Immediate-only requirement: availability is missing or needs verification.');
end $$;
revoke all on function private.candidate_availability(uuid,uuid) from public,anon,authenticated;

create or replace function public.submit_candidate(
  p_requirement_id uuid, p_candidate_id uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_source public.candidate_source;
  v_vendor uuid;
  v_existing uuid;
  v_previous_stage public.submission_stage;
  v_id uuid;
  availability jsonb;
  auto_rejected boolean;
begin
  select * into r from public.requirements where id = p_requirement_id for update;
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
    select owner_vendor_org_id into v_vendor from public.candidates where id=p_candidate_id;
    v_source := case when v_vendor is not null then 'vendor'::public.candidate_source else 'internal'::public.candidate_source end;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- One canonical submission per requirement/candidate, including rejected attempts.
  if not coalesce(private.can_access_candidate_employment(p_candidate_id,'view'),false) then raise exception 'Candidate access denied' using errcode='42501'; end if;
  select id,stage into v_existing,v_previous_stage from public.submissions
   where requirement_id = p_requirement_id
     and candidate_id = p_candidate_id
     ;

  if v_existing is not null and exists(select 1 from public.submissions where id=v_existing and stage not in ('rejected','withdrawn')) then
    insert into public.duplicate_flags (kind, match_type, existing_candidate_id, requirement_id, attempted_by, attempted_org_id)
    values ('submission', 'same_requirement', p_candidate_id, p_requirement_id, auth.uid(), private.my_org());
    perform private.notify_org(private.internal_org(), 'duplicate', 'Duplicate submission attempt',
                               r.title, '/admin/duplicates');
    return jsonb_build_object('status', 'duplicate', 'reason', 'Candidate is already in the pipeline for this requirement');
  end if;

  availability := private.candidate_availability(p_requirement_id,p_candidate_id);
  auto_rejected := availability->>'status'='ineligible';
  if v_existing is not null then
    update public.submissions set stage=case when auto_rejected then 'rejected'::public.submission_stage else 'recruiter_review'::public.submission_stage end,
      validation_state=case when auto_rejected then 'rejected_by_recruiter'::public.submission_validation_state else 'pending_assessment'::public.submission_validation_state end,
      notes=p_notes, approved_by=null,approved_at=null,rejected_by=null,
      rejected_at=case when auto_rejected then now() end,
      rejection_reason=case when auto_rejected then availability->>'reason' end,
      shared_with_client_at=null,stage_changed_at=now(),updated_at=now()
    where id=v_existing returning id into v_id;
  else
  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, notes, validation_state, rejection_reason, rejected_at)
  values (p_requirement_id, p_candidate_id, v_source, v_vendor, auth.uid(), case when auto_rejected then 'rejected'::public.submission_stage else 'recruiter_review'::public.submission_stage end, p_notes, case when auto_rejected then 'rejected_by_recruiter'::public.submission_validation_state else 'pending_assessment'::public.submission_validation_state end, case when auto_rejected then availability->>'reason' end, case when auto_rejected then now() end)
  returning id into v_id;

  end if;
  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, v_previous_stage, case when auto_rejected then 'rejected'::public.submission_stage else 'recruiter_review'::public.submission_stage end, auth.uid(), private.my_role(), case when auto_rejected then availability->>'reason' else 'Submitted' end);

  if auto_rejected then
    perform private.emit_event('SUBMISSION_AUTO_REJECTED','submission',v_id,availability,'SUBMISSION_AUTO_REJECTED:' || v_id);
  end if;
  if not auto_rejected then
  insert into public.submission_assessments (submission_id) values (v_id) on conflict(submission_id) do nothing;

  perform private.emit_event('SUBMISSION_CREATED', 'submission', v_id,
                             jsonb_build_object('source', v_source, 'vendor_org_id', v_vendor),
                             'SUBMISSION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New candidate submission',
                             r.title, '/admin/submissions?subId=' || v_id);
  end if;
  return jsonb_build_object('status', 'created', 'submission_id', v_id,'auto_rejected',auto_rejected,'rejection_reason',case when auto_rejected then availability->>'reason' end);
end;
$$;


-- Batch preflight reveals only availability, never salary/contact data.
create or replace function public.candidate_availability_for_requirement(p_requirement uuid,p_candidates uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare candidate uuid; result jsonb := '{}'::jsonb;
begin
 if auth.uid() is null or not coalesce(private.can_view_requirement(p_requirement),false) then raise exception 'Requirement access denied'; end if;
 if cardinality(p_candidates)>200 then raise exception 'Maximum 200 candidates per request'; end if;
 foreach candidate in array p_candidates loop
   if not coalesce(private.can_access_candidate_employment(candidate,'view'),false) then raise exception 'Candidate access denied'; end if;
   result := result || jsonb_build_object(candidate,private.candidate_availability(p_requirement,candidate));
 end loop;
 return result;
end $$;
revoke all on function public.candidate_availability_for_requirement(uuid,uuid[]) from public,anon;
grant execute on function public.candidate_availability_for_requirement(uuid,uuid[]) to authenticated;
