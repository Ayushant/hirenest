-- 37_candidate_evidence_lifecycle.sql
-- Immutable evidence versions and repeatable clarification cycles.
-- Run after migrations 01-36 in Supabase SQL Editor.

begin;

-- Resume objects are append-only from the application. New revisions receive new paths.
drop policy if exists resumes_update on storage.objects;

alter table public.submission_clarifications
  add column if not exists requirement_id uuid references public.requirements(id) on delete set null,
  add column if not exists requester_org_id uuid references public.organizations(id) on delete set null,
  add column if not exists requester_role text,
  add column if not exists cycle_number integer not null default 1,
  add column if not exists skill_classification jsonb not null default '{}'::jsonb,
  add column if not exists response_deadline timestamptz,
  add column if not exists viewed_at timestamptz;

update public.submission_clarifications sc
set requirement_id = s.requirement_id
from public.submissions s
where s.id = sc.submission_id and sc.requirement_id is null;

create index if not exists submission_clarifications_cycles
  on public.submission_clarifications(submission_id, created_at desc);

create or replace function public.request_clarification(
  p_submission_id uuid,
  p_missing_skills text[],
  p_questions text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  v_candidate uuid;
  v_id uuid;
  v_cycle integer;
  v_candidate_user uuid;
  v_route_vendor uuid;
begin
  select * into s from public.submissions where id=p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  v_candidate:=s.candidate_id;
  if not coalesce(private.can_access_candidate_employment(v_candidate,'edit'),false) then
    raise exception 'Clarification request denied' using errcode='42501';
  end if;
  if private.is_vendor_user() and (s.vendor_org_id is null or s.vendor_org_id<>private.my_org()) then
    raise exception 'Vendor tenant scope denied' using errcode='42501';
  end if;
  v_route_vendor:=case when private.is_vendor_user() then null else s.vendor_org_id end;
  if private.my_role() in ('candidate','client','client_user') then
    raise exception 'This role cannot request clarification' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  if exists (
    select 1 from public.submission_clarifications c
    where c.submission_id=p_submission_id and c.status='open'
      and array(select lower(trim(x)) from unnest(coalesce(c.missing_skills,'{}')) x order by lower(trim(x)))
          = array(select lower(trim(x)) from unnest(coalesce(p_missing_skills,'{}')) x order by lower(trim(x)))
      and lower(trim(c.questions))=lower(trim(coalesce(p_questions,'')))
  ) then
    raise exception 'An identical clarification request is already open' using errcode='23505';
  end if;
  select coalesce(max(cycle_number),0)+1 into v_cycle
    from public.submission_clarifications where submission_id=p_submission_id;
  insert into public.submission_clarifications(
    submission_id,requested_by,routed_to_vendor_org_id,routed_to_candidate_id,
    missing_skills,questions,requirement_id,requester_org_id,requester_role,cycle_number
  ) values (
    p_submission_id,auth.uid(),v_route_vendor,v_candidate,coalesce(p_missing_skills,'{}'),
    coalesce(nullif(trim(p_questions),''),'Please provide clarification.'),s.requirement_id,
    private.my_org(),private.my_role(),v_cycle
  ) returning id into v_id;
  update public.submissions set validation_state='pending_clarification'
   where id=p_submission_id and validation_state<>'approved';
  if v_route_vendor is not null then
    perform private.notify_org(v_route_vendor,'clarification','Clarification requested',
      'A clarification request is available for an assigned candidate.',
      '/vendor/submissions?subId='||p_submission_id);
  else
    select c.user_id into v_candidate_user from public.candidates c where c.id=v_candidate;
    if v_candidate_user is not null then
      perform private.notify_user(v_candidate_user,'clarification','Clarification requested',
        'A recruiter requested an update to your candidate evidence.','/candidate/profile');
    elsif private.is_vendor_user() then
      perform private.notify_org(private.internal_org(),'clarification','Vendor clarification requested',
        'A vendor recruiter requested candidate evidence follow-up.','/admin/submissions?subId='||p_submission_id);
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.submit_clarification_response(
  p_clarification_id uuid,
  p_response text
) returns void language plpgsql security definer set search_path = '' as $$
declare c public.submission_clarifications;
begin
  select * into c from public.submission_clarifications where id=p_clarification_id for update;
  if not found or c.status not in ('open','responded') then
    raise exception 'Open clarification request not found';
  end if;
  if char_length(trim(coalesce(p_response,''))) < 10 then
    raise exception 'Please provide at least 10 characters of clarification';
  end if;
  if not (
    (private.my_role()='candidate' and exists (
      select 1 from public.candidates ca where ca.id=c.routed_to_candidate_id and ca.user_id=auth.uid()
    ))
    or (private.is_vendor_user() and exists (
      select 1 from public.submissions s where s.id=c.submission_id and s.vendor_org_id=private.my_org()
    ))
    or (private.is_internal() and coalesce(private.can_access_candidate_employment(c.routed_to_candidate_id,'edit'),false))
  ) then raise exception 'Clarification response denied' using errcode='42501'; end if;
  update public.submission_clarifications
     set response=trim(p_response),status='responded',updated_at=now()
   where id=p_clarification_id;
end $$;

create table if not exists public.candidate_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  submission_id uuid references public.submissions(id) on delete set null,
  clarification_id uuid references public.submission_clarifications(id) on delete set null,
  document_kind text not null check (document_kind in ('resume','supporting')),
  version_number integer not null check (version_number > 0),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-fA-F0-9]{64}$'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploader_role text not null,
  uploader_org_id uuid references public.organizations(id) on delete set null,
  source_channel text not null check (source_channel in ('candidate_portal','vendor_portal','recruiter_portal','admin_portal')),
  candidate_authorized boolean not null,
  review_status text not null default 'pending' check (review_status in ('pending','accepted','rejected')),
  verification_status text not null default 'not_provided' check (verification_status in
    ('not_provided','candidate_reported','evidence_uploaded','under_review','verified','partially_verified','not_verified','rejected')),
  parsed_claims jsonb not null default '{}'::jsonb,
  review_reason text,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  is_latest_candidate_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  unique(candidate_id, document_kind, version_number)
);

create unique index if not exists candidate_evidence_latest_resume
  on public.candidate_evidence_documents(candidate_id)
  where document_kind='resume' and is_latest_candidate_submitted;

create table if not exists public.candidate_match_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  computed_score numeric(5,2),
  skill_score numeric(5,2),
  experience_score numeric(5,2),
  matched_skills text[] not null default '{}',
  unproven_skills text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  engine_version text not null,
  calculated_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index if not exists candidate_match_history_lookup
  on public.candidate_match_history(candidate_id,requirement_id,recorded_at desc);
create unique index if not exists candidate_match_history_snapshot_unique
  on public.candidate_match_history(candidate_id,requirement_id,engine_version,calculated_at);

insert into public.candidate_match_history(
  candidate_id,requirement_id,computed_score,skill_score,experience_score,
  matched_skills,unproven_skills,evidence,engine_version,calculated_at
)
select m.candidate_id,m.requirement_id,m.computed_score,m.skill_score,m.experience_score,
       coalesce(m.matched_skills,'{}'),coalesce(m.unproven_skills,'{}'),coalesce(m.evidence,'{}'),
       coalesce(m.engine_version,'unknown'),coalesce(m.calculated_at,now())
from public.candidate_matches m
on conflict (candidate_id,requirement_id,engine_version,calculated_at) do nothing;

alter table public.candidate_evidence_documents enable row level security;
drop policy if exists candidate_evidence_read on public.candidate_evidence_documents;
create policy candidate_evidence_read on public.candidate_evidence_documents
  for select to authenticated
  using (private.can_access_candidate_employment(candidate_id,'view'));
grant select on public.candidate_evidence_documents to authenticated;
revoke insert, update, delete on public.candidate_evidence_documents from anon, authenticated;
drop policy if exists resumes_delete on storage.objects;
create policy resumes_delete on storage.objects for delete to authenticated
  using (bucket_id='resumes' and private.is_internal() and not exists (
    select 1 from public.candidate_evidence_documents d where d.storage_path=storage.objects.name
  ));
alter table public.candidate_match_history enable row level security;
drop policy if exists candidate_match_history_read on public.candidate_match_history;
create policy candidate_match_history_read on public.candidate_match_history
  for select to authenticated
  using (private.can_access_candidate_employment(candidate_id,'view'));
grant select on public.candidate_match_history to authenticated;
revoke insert, update, delete on public.candidate_match_history from anon, authenticated;

create or replace function private.record_candidate_match_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.candidate_match_history(
    candidate_id,requirement_id,computed_score,skill_score,experience_score,
    matched_skills,unproven_skills,evidence,engine_version,calculated_at
  ) values (
    new.candidate_id,new.requirement_id,new.computed_score,new.skill_score,new.experience_score,
    coalesce(new.matched_skills,'{}'),coalesce(new.unproven_skills,'{}'),coalesce(new.evidence,'{}'),
    coalesce(new.engine_version,'unknown'),coalesce(new.calculated_at,now())
  ) on conflict (candidate_id,requirement_id,engine_version,calculated_at) do nothing;
  return new;
end $$;
drop trigger if exists candidate_match_history_snapshot on public.candidate_matches;
create trigger candidate_match_history_snapshot after insert or update on public.candidate_matches
  for each row execute function private.record_candidate_match_history();
revoke all on function private.record_candidate_match_history() from public,anon,authenticated;

create or replace function public.register_candidate_evidence_document(
  p_candidate_id uuid,
  p_submission_id uuid,
  p_clarification_id uuid,
  p_document_kind text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_sha256 text,
  p_source_channel text,
  p_candidate_authorized boolean,
  p_parsed_claims jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_version integer;
  v_org uuid;
  v_role text;
begin
  if auth.uid() is null or not coalesce(private.can_access_candidate_employment(p_candidate_id,'edit'),false) then
    raise exception 'Candidate evidence upload denied' using errcode='42501';
  end if;
  if p_document_kind not in ('resume','supporting') or p_source_channel not in
      ('candidate_portal','vendor_portal','recruiter_portal','admin_portal') then
    raise exception 'Invalid document metadata';
  end if;
  if split_part(p_storage_path,'/',1)<>p_candidate_id::text then
    raise exception 'Storage path must be scoped to this candidate';
  end if;
  if not p_candidate_authorized then
    raise exception 'Candidate authorization is required' using errcode='42501';
  end if;
  if p_file_size_bytes <= 0 or p_file_size_bytes > 10485760 then
    raise exception 'File must be between 1 byte and 10 MB';
  end if;
  if lower(p_file_name) !~ '[.](pdf|doc|docx)$' or p_mime_type not in
    ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream') then
    raise exception 'Unsupported document type';
  end if;
  if p_sha256 !~* '^[a-f0-9]{64}$' then raise exception 'Invalid SHA-256 digest'; end if;
  if p_submission_id is not null and not exists (
    select 1 from public.submissions s where s.id=p_submission_id and s.candidate_id=p_candidate_id
  ) then raise exception 'Submission does not belong to candidate'; end if;
  if p_clarification_id is not null and not exists (
    select 1 from public.submission_clarifications c
    where c.id=p_clarification_id and c.routed_to_candidate_id=p_candidate_id
  ) then raise exception 'Clarification does not belong to candidate'; end if;

  v_org := private.my_org();
  v_role := private.my_role();
  if p_document_kind='resume' then
    update public.candidate_evidence_documents
       set is_latest_candidate_submitted=false
     where candidate_id=p_candidate_id and document_kind='resume' and is_latest_candidate_submitted;
  end if;
  select coalesce(max(version_number),0)+1 into v_version
    from public.candidate_evidence_documents
   where candidate_id=p_candidate_id and document_kind=p_document_kind;
  insert into public.candidate_evidence_documents(
    candidate_id,submission_id,clarification_id,document_kind,version_number,storage_path,file_name,mime_type,
    file_size_bytes,sha256,uploaded_by,uploader_role,uploader_org_id,source_channel,candidate_authorized,
    parsed_claims,is_latest_candidate_submitted
  ) values (
    p_candidate_id,p_submission_id,p_clarification_id,p_document_kind,v_version,p_storage_path,p_file_name,
    p_mime_type,p_file_size_bytes,lower(p_sha256),auth.uid(),v_role,v_org,p_source_channel,
    p_candidate_authorized,coalesce(p_parsed_claims,'{}'::jsonb),p_document_kind='resume'
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_candidate_evidence_document(
  p_document_id uuid,
  p_review_status text,
  p_verification_status text,
  p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare d public.candidate_evidence_documents;
begin
  select * into d from public.candidate_evidence_documents where id=p_document_id for update;
  if not found or not coalesce(private.can_access_candidate_employment(d.candidate_id,'edit'),false) then
    raise exception 'Candidate evidence review denied' using errcode='42501';
  end if;
  if not private.is_internal() then
    raise exception 'Only an authorised recruiter can review candidate evidence' using errcode='42501';
  end if;
  if p_review_status not in ('accepted','rejected') or p_verification_status not in
    ('candidate_reported','evidence_uploaded','under_review','verified','partially_verified','not_verified','rejected') then
    raise exception 'Invalid evidence review state';
  end if;
  update public.candidate_evidence_documents
  set review_status=p_review_status, verification_status=p_verification_status,
      review_reason=nullif(trim(p_reason),''), reviewed_by=auth.uid(), reviewed_at=now()
  where id=p_document_id;
  if p_review_status='accepted' and d.document_kind='resume' then
    update public.candidates
       set resume_path=d.storage_path, resume_hash=d.sha256, updated_at=now()
     where id=d.candidate_id;
    perform private.recompute_for_candidate(d.candidate_id);
  end if;
end $$;

drop trigger if exists candidate_evidence_audit on public.candidate_evidence_documents;
create or replace function private.audit_candidate_evidence_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_meta jsonb; new_meta jsonb; row_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') then
    old_meta:=jsonb_build_object('candidate_id',old.candidate_id,'document_kind',old.document_kind,
      'version_number',old.version_number,'sha256',old.sha256,'uploader_role',old.uploader_role,
      'uploader_org_id',old.uploader_org_id,'source_channel',old.source_channel,
      'review_status',old.review_status,'verification_status',old.verification_status);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    new_meta:=jsonb_build_object('candidate_id',new.candidate_id,'document_kind',new.document_kind,
      'version_number',new.version_number,'sha256',new.sha256,'uploader_role',new.uploader_role,
      'uploader_org_id',new.uploader_org_id,'source_channel',new.source_channel,
      'review_status',new.review_status,'verification_status',new.verification_status,
      'reviewed_by',new.reviewed_by,'review_reason',new.review_reason);
    row_id:=new.id;
  else
    row_id:=old.id;
  end if;
  insert into public.audit_logs(table_name,record_id,action,actor_id,actor_role,old_data,new_data)
  values('candidate_evidence_documents',row_id,tg_op,auth.uid(),private.my_role(),old_meta,new_meta);
  return coalesce(new,old);
end $$;
revoke all on function private.audit_candidate_evidence_document() from public,anon,authenticated;
drop trigger if exists candidate_evidence_audit on public.candidate_evidence_documents;
create trigger candidate_evidence_audit after insert or update or delete on public.candidate_evidence_documents
  for each row execute function private.audit_candidate_evidence_document();

revoke all on function public.register_candidate_evidence_document(uuid,uuid,uuid,text,text,text,text,bigint,text,text,boolean,jsonb) from public,anon;
grant execute on function public.register_candidate_evidence_document(uuid,uuid,uuid,text,text,text,text,bigint,text,text,boolean,jsonb) to authenticated;
revoke all on function public.review_candidate_evidence_document(uuid,text,text,text) from public,anon;
grant execute on function public.review_candidate_evidence_document(uuid,text,text,text) to authenticated;
revoke all on function public.request_clarification(uuid,text[],text) from public,anon;
grant execute on function public.request_clarification(uuid,text[],text) to authenticated;
revoke all on function public.submit_clarification_response(uuid,text) from public,anon;
grant execute on function public.submit_clarification_response(uuid,text) to authenticated;

commit;
