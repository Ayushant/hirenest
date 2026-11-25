-- Additive onboarding migration. Existing auth users and organisation IDs are preserved.
begin;
alter table public.profiles
 add column if not exists designation text,
 add column if not exists department text,
 add column if not exists business_role text,
 add column if not exists reporting_manager_id uuid references public.profiles(id);
alter table public.organizations
 add column if not exists website text,
 add column if not exists location text,
 add column if not exists business_classification text,
 add column if not exists staffing_capabilities text[] not null default '{}',
 add column if not exists engagement_models text[] not null default '{}',
 add column if not exists primary_contact_user_id uuid references public.profiles(id);

-- Review state/draft only, not another user or organisation entity. Approved company
-- details move to organizations; historical submissions remain in the audit trail.
create table public.registration_details (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 details jsonb not null default '{}',
 verification_status text not null default 'pending' check(verification_status in ('pending','approved','rejected','not_required')),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_reason text,
 created_at timestamptz not null default now()
);
alter table public.registration_details enable row level security;
create policy registration_read on public.registration_details for select to authenticated
 using(user_id=auth.uid() or private.is_admin());
grant select on public.registration_details to authenticated;
revoke insert,update,delete on public.registration_details from anon,authenticated;

create function private.can_access_candidate_employment(p_candidate uuid,p_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sm public.staff_members; grant_data jsonb;tpl jsonb;scope text;
begin
 if p_action not in ('view','edit') or not private.can_manage_candidate(p_candidate) then return false;end if;
 if private.my_role()='candidate' or private.is_vendor_user() or private.is_admin() then return true;end if;
 select * into sm from public.staff_members where user_id=auth.uid();
 if sm.user_id is null then return private.is_internal();end if;
 if coalesce(sm.extra_restricted_fields,'{}')&&array['salary','billing_rate'] then return false;end if;
 select permissions->'candidates' into tpl from public.staff_permission_templates where system_role=sm.system_role;
 if exists(select 1 from public.staff_permission_templates where system_role=sm.system_role and restricted_fields&&array['salary','billing_rate']) then return false;end if;
 grant_data:=coalesce(sm.permission_overrides->'candidates',tpl);
 if grant_data is not null then
  if not coalesce((grant_data->'actions')?p_action,false) then return false;end if;
  scope:=grant_data->>'scope';
 else
  if sm.system_role not in ('platform_admin','super_admin','senior_bom','admin_recruiter','recruiter') then return false;end if;
  scope:=case when sm.system_role='recruiter' then 'assigned' else 'organisation' end;
 end if;
 if scope='organisation' then return true;end if;
 return exists(select 1 from public.staff_record_assignments where module='candidates' and record_id=p_candidate::text and user_id=auth.uid())
 or exists(select 1 from public.candidates where id=p_candidate and created_by=auth.uid());
end $$;
revoke all on function private.can_access_candidate_employment(uuid,text) from public,anon;
grant execute on function private.can_access_candidate_employment(uuid,text) to authenticated;

-- Commercial information must not be stored in the client-readable candidates row.
create table public.candidate_employment (
 candidate_id uuid primary key references public.candidates(id) on delete cascade,
 current_company text,
 employment_type text not null check(employment_type in ('FTE','C2C','C2H')),
 current_ctc numeric(14,2) check(current_ctc>=0),
 expected_ctc numeric(14,2) check(expected_ctc>=0),
 notice_period text check(notice_period in ('immediate','15_30','30_plus','serving')),
 last_working_day date,
 expected_joining_date date,
 joining_availability text,
 current_rate numeric(14,2) check(current_rate>=0),
 expected_rate numeric(14,2) check(expected_rate>=0),
 currency text not null default 'INR' check(currency ~ '^[A-Z]{3}$'),
 rate_period text check(rate_period in ('hour','day','month','year')),
 updated_at timestamptz not null default now(),
 check(employment_type='FTE' or (current_ctc is null and expected_ctc is null and notice_period is null)),
 check(employment_type in ('C2C','C2H') or (current_rate is null and expected_rate is null and rate_period is null)),
 check(notice_period='serving' or last_working_day is null)
);
alter table public.candidate_employment enable row level security;
create policy employment_read on public.candidate_employment for select to authenticated
 using(private.can_access_candidate_employment(candidate_id,'view'));
create policy employment_insert on public.candidate_employment for insert to authenticated
 with check(private.can_access_candidate_employment(candidate_id,'edit'));
create policy employment_update on public.candidate_employment for update to authenticated
 using(private.can_access_candidate_employment(candidate_id,'edit')) with check(private.can_access_candidate_employment(candidate_id,'edit'));
grant select,insert,update on public.candidate_employment to authenticated;
create trigger employment_timestamp before update on public.candidate_employment
 for each row execute function private.set_updated_at();
create trigger employment_audit after insert or update or delete on public.candidate_employment
 for each row execute function private.audit_row();
create trigger registration_audit after insert or update or delete on public.registration_details
 for each row execute function private.audit_row();

create function private.save_candidate_employment(p_candidate uuid,p_details jsonb)
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
 on conflict(candidate_id) do nothing;
end $$;
-- Never expose this definer helper as a write bypass.
revoke all on function private.save_candidate_employment(uuid,jsonb) from public,anon,authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 m jsonb:=new.raw_user_meta_data;
 intent text:=coalesce(m->>'signup_intent','candidate');
 d jsonb:=coalesce(m->'onboarding','{}'::jsonb);
 c uuid;
begin
 if intent not in ('candidate','client','vendor') then intent:='candidate'; end if;
 if m->>'onboarding_version'='1' then
  if pg_column_size(d)>8192 then raise exception 'Onboarding details are too large';end if;
  if char_length(btrim(coalesce(m->>'full_name','')))<2 or char_length(regexp_replace(coalesce(d->>'phone',''),'\D','','g'))<7 then
   raise exception 'Name and valid mobile number are required';
  end if;
  if intent='candidate' then
   if coalesce(d->>'location','')='' or coalesce(d->>'employment_type','') not in ('FTE','C2C','C2H') then
    raise exception 'Location and employment type are required';
   end if;
  elsif coalesce(m->>'company_name','')='' or coalesce(d->>'designation','')='' or coalesce(d->>'department','')=''
    or coalesce(d->>'company_location','')='' or coalesce(d->>'industry','')='' then
   raise exception 'Company, designation, department, location and industry are required';
  end if;
 end if;
 insert into public.profiles(id,email,full_name,phone,designation,department,business_role,role,status,requested_role,requested_company)
 values(new.id,new.email,coalesce(m->>'full_name',''),nullif(d->>'phone',''),nullif(d->>'designation',''),
 nullif(d->>'department',''),nullif(d->>'business_role',''),
 case when intent='candidate' then 'candidate'::public.app_role else 'pending'::public.app_role end,
 case when intent='candidate' then 'active'::public.user_status else 'pending_approval'::public.user_status end,
 intent,left(m->>'company_name',200));
 insert into public.registration_details(user_id,details,verification_status)
 values(new.id,d,case when intent='candidate' then 'not_required' else 'pending' end);
 -- Invitations and legacy registrations retain their existing completion flow.
 if intent='candidate' and m->>'onboarding_version'='1' then
  if not exists(select 1 from public.candidate_contacts where email_normalized=lower(btrim(new.email))
    or (char_length(regexp_replace(coalesce(d->>'phone',''),'\D','','g'))>=10
      and phone_normalized=right(regexp_replace(d->>'phone','\D','','g'),10))) then
   insert into public.candidates(user_id,full_name,current_title,location,original_source,created_by)
   values(new.id,m->>'full_name',nullif(d->>'designation',''),d->>'location','direct',new.id) returning id into c;
   insert into public.candidate_contacts(candidate_id,email,phone) values(c,new.email,d->>'phone');
   perform private.save_candidate_employment(c,d);
   update public.registration_details set details='{}' where user_id=new.id;
  end if;
  -- An existing candidate is never claimed merely by submitting matching contact data.
 end if;
 update auth.users set raw_user_meta_data=raw_user_meta_data-'onboarding' where id=new.id and raw_user_meta_data?'onboarding';
 return new;
end $$;

-- Backfill review state without guessing missing personal or company information.
insert into public.registration_details(user_id,verification_status)
select id,case when status='pending_approval' then 'pending' when role='candidate' then 'not_required' else 'approved' end
from public.profiles on conflict(user_id) do nothing;

create function public.admin_review_registration(p_user_id uuid,p_decision text,p_reason text,
 p_role public.app_role default null,p_org_id uuid default null,p_org_name text default null,p_org_type public.org_type default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.profiles; r public.registration_details; target uuid; d jsonb;
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_decision not in ('approved','rejected') or char_length(btrim(coalesce(p_reason,'')))<3 then
  raise exception 'A decision and review reason are required';
 end if;
 select * into p from public.profiles where id=p_user_id for update;
 if p.id is null or p.id=auth.uid() then raise exception 'Invalid review target'; end if;
 select * into r from public.registration_details where user_id=p_user_id for update;
 if r.user_id is null then raise exception 'Registration details not found';end if;
 if r.verification_status=p_decision then return p.org_id; end if;
 if r.verification_status<>'pending' then raise exception 'Registration is already reviewed'; end if;
 d:=r.details;
 if p_decision='rejected' then
  update public.profiles set role='pending',status='suspended',org_id=null where id=p_user_id;
 else
  target:=p_org_id;
  if p_role in ('vendor_admin','vendor_recruiter','client_manager','client_member') then
   if target is null then
    if char_length(btrim(coalesce(p_org_name,'')))<2 or p_org_type not in ('vendor','client') then
     raise exception 'Choose an organisation or provide its name and type';
    end if;
    insert into public.organizations(name,type,status,website,location,industry,business_classification,staffing_capabilities,engagement_models,primary_contact_user_id)
    values(btrim(p_org_name),p_org_type,'approved',nullif(d->>'company_website',''),nullif(d->>'company_location',''),
    nullif(d->>'industry',''),nullif(d->>'business_classification',''),
    array(select jsonb_array_elements_text(coalesce(d->'staffing_capabilities','[]'))),
    array(select jsonb_array_elements_text(coalesce(d->'engagement_models','[]'))),p_user_id) returning id into target;
   end if;
  elsif p_role in ('admin','recruiter') then
   target:=private.internal_org();
  elsif p_role='candidate' then target:=null;
  else raise exception 'Select a valid system role'; end if;
  if target is not null and p_role in ('vendor_admin','client_manager') then
   update public.organizations set primary_contact_user_id=coalesce(primary_contact_user_id,p_user_id),
    website=coalesce(nullif(website,''),nullif(d->>'company_website','')),
    location=coalesce(nullif(location,''),nullif(d->>'company_location','')),
    industry=coalesce(nullif(industry,''),nullif(d->>'industry','')),
    business_classification=coalesce(nullif(business_classification,''),nullif(d->>'business_classification','')),
    staffing_capabilities=case when cardinality(staffing_capabilities)=0 then array(select jsonb_array_elements_text(coalesce(d->'staffing_capabilities','[]'))) else staffing_capabilities end,
    engagement_models=case when cardinality(engagement_models)=0 then array(select jsonb_array_elements_text(coalesce(d->'engagement_models','[]'))) else engagement_models end
   where id=target;
  end if;
  perform public.admin_assign_user(p_user_id,p_role,target,'active');
 end if;
 update public.registration_details set verification_status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
 review_reason=btrim(p_reason),details=case when p_decision='approved' then '{}'::jsonb else details end where user_id=p_user_id;
 perform private.emit_event('REGISTRATION_REVIEWED','profile',p_user_id,jsonb_build_object('decision',p_decision,'reason',p_reason,'org_id',target));
 return target;
end $$;
revoke all on function public.admin_review_registration(uuid,text,text,public.app_role,uuid,text,public.org_type) from public,anon;
grant execute on function public.admin_review_registration(uuid,text,text,public.app_role,uuid,text,public.org_type) to authenticated;

-- Organisation contact fields are resolved from the linked profile by API queries.
-- Only self, HQ and own-organisation admins may inspect member profiles.
drop policy profile_select on public.profiles;
create policy profile_select on public.profiles for select to authenticated using(
 id=auth.uid() or private.is_admin()
 or (private.is_internal() and status='active' and role<>'pending')
 or (private.my_role() in ('vendor_admin','client_manager') and org_id=private.my_org()));
create or replace function private.can_view_org(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.is_internal() or p_org=private.my_org();
$$;
grant update(designation,department,business_role) on public.profiles to authenticated;

-- Preserve compatibility with existing candidate/profile editors while keeping linked
-- identity/contact values consistent. Verified login email can only change through Auth.
create function private.sync_linked_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='profiles' then
  update public.candidates set full_name=new.full_name,current_title=coalesce(new.designation,current_title)
   where user_id=new.id and (full_name is distinct from new.full_name or (new.designation is not null and current_title is distinct from new.designation));
  update public.candidate_contacts cc set phone=new.phone from public.candidates c
   where c.id=cc.candidate_id and c.user_id=new.id and cc.phone is distinct from new.phone;
 elsif tg_table_name='candidates' then
  if new.user_id is not null then
  update public.profiles set full_name=new.full_name,designation=new.current_title
   where id=new.user_id and (full_name is distinct from new.full_name or designation is distinct from new.current_title);
  end if;
 elsif tg_table_name='candidate_contacts' then
  update public.profiles p set phone=new.phone from public.candidates c
   where c.id=new.candidate_id and p.id=c.user_id and p.phone is distinct from new.phone;
 end if;
 return new;
end $$;
create trigger profile_identity_sync after update of full_name,phone,designation on public.profiles
 for each row execute function private.sync_linked_identity();
create trigger candidate_identity_sync after update of full_name,current_title,user_id on public.candidates
 for each row execute function private.sync_linked_identity();
create trigger candidate_contact_sync after update of phone on public.candidate_contacts
 for each row execute function private.sync_linked_identity();
revoke all on function private.sync_linked_identity() from public,anon,authenticated;
create function public.organization_team(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (private.is_admin() or (private.my_role() in ('vendor_admin','client_manager') and private.my_org()=p_org_id)) is not true then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'phone',p.phone,'email',p.email,
 'designation',case when o.type='internal' then sm.designation else p.designation end,
 'department',case when o.type='internal' then d.name else p.department end,
 'business_role',p.business_role,'role',p.role,'system_role',coalesce(sm.system_role,p.role::text),'status',p.status,
 'reporting_manager_id',coalesce(sm.reporting_manager_id,p.reporting_manager_id),
 'reporting_manager',manager.full_name)) from public.profiles p
 join public.organizations o on o.id=p.org_id
 left join public.staff_members sm on sm.user_id=p.id and o.type='internal'
 left join public.departments d on d.id=sm.department_id
 left join public.profiles manager on manager.id=coalesce(sm.reporting_manager_id,p.reporting_manager_id)
 where p.org_id=p_org_id),'[]'::jsonb);
end $$;
revoke all on function public.organization_team(uuid) from public,anon;
grant execute on function public.organization_team(uuid) to authenticated;

create function public.update_organization_member(p_user_id uuid,p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; manager uuid;
begin
 select * into p from public.profiles where id=p_user_id for update;
 if p.id is null or (private.is_admin() or (private.my_role() in ('vendor_admin','client_manager') and p.org_id=private.my_org())) is not true then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if exists(select 1 from public.organizations where id=p.org_id and type='internal') then
  raise exception 'Manage internal roles and hierarchy through User & Team Management';
 end if;
 if exists(select 1 from jsonb_object_keys(p_details) k where k not in ('full_name','phone','designation','department','business_role','reporting_manager_id')) then
  raise exception 'Unsupported field';
 end if;
 manager:=nullif(p_details->>'reporting_manager_id','')::uuid;
 if manager is not null and (manager=p_user_id or not exists(select 1 from public.profiles where id=manager and org_id=p.org_id and status='active')) then
  raise exception 'Reporting manager must be another active member of this organisation';
 end if;
 if manager is not null and exists(with recursive chain as (
   select id,reporting_manager_id from public.profiles where id=manager
   union select p2.id,p2.reporting_manager_id from public.profiles p2 join chain c on p2.id=c.reporting_manager_id
  ) select 1 from chain where id=p_user_id) then raise exception 'Reporting hierarchy cannot contain cycles'; end if;
 update public.profiles set full_name=coalesce(nullif(btrim(p_details->>'full_name'),''),full_name),
 phone=nullif(p_details->>'phone',''),designation=nullif(p_details->>'designation',''),department=nullif(p_details->>'department',''),
 business_role=nullif(p_details->>'business_role',''),reporting_manager_id=manager where id=p_user_id;
end $$;
revoke all on function public.update_organization_member(uuid,jsonb) from public,anon;
grant execute on function public.update_organization_member(uuid,jsonb) to authenticated;

create function private.sync_verified_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and new.email is distinct from old.email then
  update public.profiles set email=new.email where id=new.id;
  update public.candidate_contacts cc set email=new.email from public.candidates c where c.id=cc.candidate_id and c.user_id=new.id;
 end if;
 return new;
end $$;
create trigger sync_verified_email after update of email on auth.users for each row execute function private.sync_verified_email();
revoke all on function private.sync_verified_email() from public,anon,authenticated;

create function private.guard_linked_candidate_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.candidates c join public.profiles p on p.id=c.user_id where c.id=new.candidate_id and new.email is distinct from p.email) then
  raise exception 'Change the linked login email through verified account settings';end if;return new;
end $$;
create trigger guard_linked_candidate_email before update of email on public.candidate_contacts for each row execute function private.guard_linked_candidate_email();
revoke all on function private.guard_linked_candidate_email() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
