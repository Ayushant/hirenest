-- Complete existing identities without creating duplicate user or organisation records.
create or replace function private.save_candidate_employment(p_candidate uuid,p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.candidate_employment(candidate_id,current_company,employment_type,current_ctc,expected_ctc,
 notice_period,last_working_day,expected_joining_date,joining_availability,current_rate,expected_rate,currency,rate_period)
 values(p_candidate,nullif(p_details->>'current_company',''),nullif(p_details->>'employment_type',''),
 nullif(p_details->>'current_ctc','')::numeric,nullif(p_details->>'expected_ctc','')::numeric,
 nullif(p_details->>'notice_period',''),nullif(p_details->>'last_working_day','')::date,
 nullif(p_details->>'expected_joining_date','')::date,nullif(p_details->>'joining_availability',''),
 nullif(p_details->>'current_rate','')::numeric,nullif(p_details->>'expected_rate','')::numeric,
 coalesce(nullif(p_details->>'currency',''),'INR'),nullif(p_details->>'rate_period',''))
 on conflict(candidate_id) do update set current_company=excluded.current_company,employment_type=excluded.employment_type,current_ctc=excluded.current_ctc,expected_ctc=excluded.expected_ctc,notice_period=excluded.notice_period,last_working_day=excluded.last_working_day,expected_joining_date=excluded.expected_joining_date,joining_availability=excluded.joining_availability,current_rate=excluded.current_rate,expected_rate=excluded.expected_rate,currency=excluded.currency,rate_period=excluded.rate_period;
end $$;

revoke all on function private.save_candidate_employment(uuid,jsonb) from public,anon,authenticated;

create or replace function public.admin_link_candidate_account(p_candidate_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; c public.candidates; d jsonb; existing jsonb;
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into p from public.profiles where id=p_user_id for update;
 if p.id is null or p.role<>'candidate' then raise exception 'User must have the candidate role';end if;
 select details into d from public.registration_details where user_id=p_user_id for update;
 select * into c from public.candidates where id=p_candidate_id for update;
 if c.id is null or (c.user_id is not null and c.user_id<>p_user_id) then raise exception 'Candidate not found or already linked';end if;
 if exists(select 1 from public.candidates where user_id=p_user_id and id<>p_candidate_id) then raise exception 'User already has another candidate profile';end if;
 -- Capture verified profile values before identity-sync triggers run.
 update public.candidates set user_id=p_user_id,full_name=p.full_name,
 current_title=coalesce(nullif(d->>'designation',''),p.designation,current_title),
 location=coalesce(nullif(d->>'location',''),location) where id=c.id;
 insert into public.candidate_contacts(candidate_id,email,phone) values(c.id,p.email,p.phone)
 on conflict(candidate_id) do update set email=excluded.email,phone=excluded.phone;
 if nullif(d->>'employment_type','') is not null then
  select to_jsonb(e) into existing from public.candidate_employment e where candidate_id=c.id;
  d:=coalesce(existing,'{}') || jsonb_strip_nulls(d);
  if d->>'employment_type'='FTE' then d:=d || jsonb_build_object('current_rate',null,'expected_rate',null,'rate_period',null);
  else d:=d || jsonb_build_object('current_ctc',null,'expected_ctc',null,'notice_period',null,'last_working_day',null);end if;
  if d->>'notice_period' is distinct from 'serving' then d:=d || jsonb_build_object('last_working_day',null);end if;
  perform private.save_candidate_employment(c.id,d);
 end if;
 update public.registration_details set details='{}' where user_id=p_user_id;
 perform private.emit_event('CANDIDATE_ACCOUNT_LINKED','candidate',c.id,jsonb_build_object('user_id',p_user_id));
end $$;
revoke all on function public.admin_link_candidate_account(uuid,uuid) from public,anon;
grant execute on function public.admin_link_candidate_account(uuid,uuid) to authenticated;

create or replace function public.my_onboarding_details()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; o public.organizations; c public.candidates; d jsonb; kind text; company_edit boolean; missing boolean;
begin
 select * into p from public.profiles where id=auth.uid();
 if p.id is null or p.status<>'active' then raise exception 'Active account required';end if;
 select * into o from public.organizations where id=p.org_id;
 select * into c from public.candidates where user_id=p.id;
 kind:=case when p.role='candidate' then 'candidate' when o.type in ('vendor','client') then o.type::text else 'member' end;
 company_edit:=p.org_id is not null and o.type in ('vendor','client') and (o.primary_contact_user_id=p.id or p.role in ('vendor_admin','client_manager'));
 d:=jsonb_build_object('full_name',p.full_name,'phone',p.phone,'designation',p.designation,'department',p.department,'business_role',p.business_role);
 if kind='candidate' then
  d:=d || jsonb_build_object('location',c.location,'designation',coalesce(c.current_title,p.designation)) ||
   coalesce((select to_jsonb(e)-'candidate_id'-'updated_at' from public.candidate_employment e where candidate_id=c.id),'{}');
 elsif company_edit then
  d:=d || jsonb_build_object('company_website',o.website,'company_location',o.location,'industry',o.industry,
   'business_classification',o.business_classification,'staffing_capabilities',o.staffing_capabilities,'engagement_models',o.engagement_models);
 end if;
 missing:=coalesce(length(regexp_replace(p.phone,'\D','','g')),0)<7 or char_length(btrim(p.full_name))<2;
 if kind='candidate' then missing:=missing or c.id is null or nullif(c.location,'') is null or not exists(select 1 from public.candidate_employment where candidate_id=c.id);
 elsif kind in ('vendor','client') then
  missing:=missing or nullif(p.designation,'') is null or nullif(p.department,'') is null;
  if company_edit then missing:=missing or nullif(o.location,'') is null or nullif(o.industry,'') is null
   or (kind='vendor' and (coalesce(cardinality(o.staffing_capabilities),0)=0 or coalesce(cardinality(o.engagement_models),0)=0));end if;
 end if;
 return jsonb_build_object('kind',kind,'company_edit',company_edit,'needs_completion',missing,'details',d,'candidate_link_required',kind='candidate' and c.id is null);
end $$;
revoke all on function public.my_onboarding_details() from public,anon;
grant execute on function public.my_onboarding_details() to authenticated;

create or replace function public.complete_my_onboarding(p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; o public.organizations; c uuid; kind text; company_edit boolean; d jsonb:=p_details;
begin
 select * into p from public.profiles where id=auth.uid() for update;
 if p.id is null or p.status<>'active' then raise exception 'Active account required';end if;
 if char_length(btrim(coalesce(d->>'full_name','')))<2 or char_length(regexp_replace(coalesce(d->>'phone',''),'\D','','g'))<7 then raise exception 'Name and valid mobile number are required';end if;
 select * into o from public.organizations where id=p.org_id for update;
 kind:=case when p.role='candidate' then 'candidate' when o.type in ('vendor','client') then o.type::text else 'member' end;
 company_edit:=p.org_id is not null and o.type in ('vendor','client') and (o.primary_contact_user_id=p.id or p.role in ('vendor_admin','client_manager'));
 if kind in ('candidate','vendor','client') and nullif(btrim(d->>'designation'),'') is null then raise exception 'Designation is required';end if;
 if kind in ('vendor','client') and nullif(btrim(d->>'department'),'') is null then raise exception 'Department is required';end if;
 update public.profiles set full_name=btrim(d->>'full_name'),phone=btrim(d->>'phone'),
 designation=case when kind='member' then designation else nullif(btrim(d->>'designation'),'') end,
 department=case when kind='member' then department else nullif(btrim(d->>'department'),'') end,
 business_role=case when kind='member' then business_role else nullif(btrim(d->>'business_role'),'') end where id=p.id;
 if kind='candidate' then
  select id into c from public.candidates where user_id=p.id for update;
  if c is null then raise exception 'Ask Admin to link your existing candidate record before completing onboarding';end if;
  if not coalesce(private.can_access_candidate_employment(c,'edit'),false) then raise exception 'Candidate edit denied';end if;
  if nullif(btrim(d->>'location'),'') is null then raise exception 'Current location is required';end if;
  if d->>'employment_type'='FTE' then
   d:=d || jsonb_build_object('current_rate',null,'expected_rate',null,'rate_period',null);
   if d->>'notice_period'='serving' and nullif(d->>'last_working_day','') is null then raise exception 'Last working day is required when serving notice';end if;
   if d->>'notice_period' is distinct from 'serving' then d:=d || jsonb_build_object('last_working_day',null);end if;
  else d:=d || jsonb_build_object('current_ctc',null,'expected_ctc',null,'notice_period',null,'last_working_day',null);end if;
  update public.candidates set current_title=btrim(d->>'designation'),location=btrim(d->>'location') where id=c;
  perform private.save_candidate_employment(c,d);
 elsif company_edit then
  if nullif(btrim(d->>'company_location'),'') is null or nullif(btrim(d->>'industry'),'') is null then raise exception 'Company location and industry are required';end if;
  if nullif(d->>'company_website','') is not null and d->>'company_website' !~ '^https?://' then raise exception 'Company website must start with http:// or https://';end if;
  if kind='vendor' and (coalesce(jsonb_array_length(d->'staffing_capabilities'),0)=0 or coalesce(jsonb_array_length(d->'engagement_models'),0)=0) then raise exception 'Staffing capabilities and engagement models are required';end if;
  update public.organizations set primary_contact_user_id=coalesce(primary_contact_user_id,p.id),website=nullif(btrim(d->>'company_website'),''),location=btrim(d->>'company_location'),industry=btrim(d->>'industry'),
   business_classification=nullif(btrim(d->>'business_classification'),''),
   staffing_capabilities=array(select jsonb_array_elements_text(coalesce(d->'staffing_capabilities','[]'))),
   engagement_models=array(select jsonb_array_elements_text(coalesce(d->'engagement_models','[]'))) where id=o.id;
 end if;
end $$;
revoke all on function public.complete_my_onboarding(jsonb) from public,anon;
grant execute on function public.complete_my_onboarding(jsonb) to authenticated;

alter table public.trial_extension_requests add column if not exists approved_days integer check(approved_days in (14,21,30));
update public.trial_extension_requests set approved_days=requested_days where status='approved' and approved_days is null;
create or replace function public.review_trial_extension(p_request_id uuid,p_decision text,p_reason text,
 p_notes text,p_follow_up date,p_exception boolean,p_approved_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.trial_extension_requests;s public.account_subscriptions;v_days integer;limit_count integer;approved_count integer;is_higher boolean;ends timestamptz;
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_decision not in ('approved','rejected') or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Decision and reason are required';end if;
 select * into r from public.trial_extension_requests where id=p_request_id for update;
 if r.id is null then raise exception 'Request not found';end if;
 v_days:=coalesce(p_approved_days,r.requested_days);
 if v_days not in (14,21,30) then raise exception 'Choose 14, 21 or 30 days';end if;
 if r.status=p_decision then return to_jsonb(r);end if;
 if r.status<>'pending' then raise exception 'Request already reviewed';end if;
 if p_decision='approved' then
  select * into s from public.account_subscriptions where account_id=r.org_id::text for update;
  if s.account_id is null or s.plan_id<>'free_trial' or s.subscription_status='active' then raise exception 'Organisation is no longer on a trial';end if;
  select max_standard_extensions into limit_count from public.trial_extension_policy where id;
  select count(*) into approved_count from public.trial_extension_requests where org_id=r.org_id and status='approved';
  select not exists(select 1 from public.staff_members where user_id=auth.uid() and system_role not in ('platform_admin','super_admin')) into is_higher;
  if (v_days=30 or approved_count>=limit_count or p_exception) and not is_higher then raise exception 'Platform Admin or Super Admin approval required';end if;
  if approved_count>=limit_count and not p_exception then raise exception 'Standard extension limit reached: explicit exception approval required';end if;
  ends:=s.trial_ends_at+make_interval(days=>v_days);
  update public.account_subscriptions set trial_ends_at=ends,trial_duration_days=ceil(extract(epoch from (ends-trial_started_at))/86400),
   subscription_status=case when ends<=now() then 'expired' else 'trialing' end,updated_at=now() where account_id=r.org_id::text;
  perform private.notify_org(r.org_id,'account','Trial extension approved','Your new trial expiry is '||ends::text,'/subscription');
  perform private.emit_event('TRIAL_EXTENSION_APPROVED','organization',r.org_id,jsonb_build_object('org_id',r.org_id,'trial_ends_at',ends),'TRIAL_EXTENSION:'||r.id);
 end if;
 update public.trial_extension_requests set approved_days=case when p_decision='approved' then v_days end,status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=p_reason,
 internal_notes=p_notes,follow_up_date=p_follow_up,exception_approved=p_exception,previous_expiry=s.trial_ends_at,new_expiry=ends where id=r.id returning * into r;
 return to_jsonb(r);
end $$;

revoke all on function public.review_trial_extension(uuid,text,text,text,date,boolean,integer) from public,anon;
grant execute on function public.review_trial_extension(uuid,text,text,text,date,boolean,integer) to authenticated;
create or replace function public.review_trial_extension(p_request_id uuid,p_decision text,p_reason text,p_notes text default null,p_follow_up date default null,p_exception boolean default false)
returns jsonb language sql security definer set search_path='' as $$
 select public.review_trial_extension(p_request_id,p_decision,p_reason,p_notes,p_follow_up,p_exception,null::integer);
$$;
create or replace function public.list_trial_extension_requests(p_org_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (private.is_admin() or (private.my_role() in ('vendor_admin','client_manager') and private.my_org()=p_org_id)) is not true then
  raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg((case when private.is_admin() then to_jsonb(r) else to_jsonb(r)-'internal_notes'-'review_reason' end)
 ||jsonb_build_object('org_name',o.name) order by r.requested_at desc)
 from public.trial_extension_requests r join public.organizations o on o.id=r.org_id
 where p_org_id is null or r.org_id=p_org_id),'[]');
end $$;
