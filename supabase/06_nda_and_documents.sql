-- =====================================================================
-- 06_nda_and_documents.sql
-- Onboarding governance per the AIKIND brief (§5, §5.1, §5.2):
--   * Organization document upload inventory + Admin review workflow.
--   * NDA status tracking with append-only audit trail.
--   * Server-side gate: protected collaboration (vendor shares) is
--     refused until the required NDA is verified.
--
-- Depends on: 01_schema.sql (organizations, profiles, private.* helpers,
-- requirement_vendor_shares).
--
-- Safe to re-run: all DDL uses IF NOT EXISTS / CREATE OR REPLACE.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.document_kind as enum (
    'company_registration',
    'tax_identifier',
    'gst_certificate',
    'authorized_representative',
    'business_address',
    'nda_executed',
    'other_compliance'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_review_status as enum (
    'pending_review',
    'approved',
    'rejected',
    'more_info_requested',
    'not_applicable',
    'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.nda_status as enum (
    'none',
    'pending_verification',
    'verified',
    'rejected',
    'revoked',
    'expired'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- Per-org document inventory. One row per uploaded file. Files live in
-- the private Supabase Storage bucket "org-documents" at the path
-- "<org_id>/<document_id>.<ext>"; the server never stores raw bytes here.
create table if not exists public.organization_documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  kind            public.document_kind not null,
  status          public.document_review_status not null default 'pending_review',
  storage_path    text,                       -- key inside the "org-documents" bucket
  original_name   text,
  mime_type       text,
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by     uuid references auth.users (id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  review_notes    text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists org_documents_org_status
  on public.organization_documents (org_id, status);
create index if not exists org_documents_pending
  on public.organization_documents (status, uploaded_at)
  where status = 'pending_review';

-- One NDA state per org. Null row = brand-new org (treated as 'none').
create table if not exists public.organization_nda_status (
  org_id             uuid primary key references public.organizations (id) on delete cascade,
  status             public.nda_status not null default 'none',
  nda_version        text,
  executed_at        timestamptz,
  verified_at        timestamptz,
  verified_by        uuid references auth.users (id) on delete set null,
  evidence_doc_id    uuid references public.organization_documents (id) on delete set null,
  revoked_at         timestamptz,
  notes              text,
  updated_at         timestamptz not null default now()
);

-- Append-only audit of every NDA / document decision.
create table if not exists public.onboarding_audit_events (
  id            bigserial primary key,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  subject_kind  text not null check (subject_kind in ('document', 'nda')),
  subject_id    text,                         -- document id or 'nda:<org_id>'
  action        text not null,                -- approved / rejected / more_info / verified / revoked / uploaded / status_change
  previous      jsonb,
  next          jsonb,
  actor_id      uuid references auth.users (id) on delete set null,
  actor_role    public.app_role,
  notes         text,
  occurred_at   timestamptz not null default now()
);
create index if not exists onboarding_audit_org on public.onboarding_audit_events (org_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- 3. updated_at triggers
-- ---------------------------------------------------------------------
drop trigger if exists trg_org_documents_updated on public.organization_documents;
create trigger trg_org_documents_updated
  before update on public.organization_documents
  for each row execute function private.set_updated_at();

drop trigger if exists trg_org_nda_updated on public.organization_nda_status;
create trigger trg_org_nda_updated
  before update on public.organization_nda_status
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.organization_documents    enable row level security;
alter table public.organization_nda_status   enable row level security;
alter table public.onboarding_audit_events   enable row level security;

-- Documents: admins see everything; members of the owning org see their
-- own org's docs; nobody writes directly (RPCs only).
drop policy if exists org_docs_select on public.organization_documents;
create policy org_docs_select on public.organization_documents for select to authenticated
  using (private.is_admin() or org_id = private.my_org());

drop policy if exists org_docs_no_direct_write on public.organization_documents;
create policy org_docs_no_direct_write on public.organization_documents
  for all to authenticated using (false) with check (false);

-- NDA status: same rule.
drop policy if exists org_nda_select on public.organization_nda_status;
create policy org_nda_select on public.organization_nda_status for select to authenticated
  using (private.is_admin() or org_id = private.my_org());

drop policy if exists org_nda_no_direct_write on public.organization_nda_status;
create policy org_nda_no_direct_write on public.organization_nda_status
  for all to authenticated using (false) with check (false);

-- Audit: admins read all; org members read their own.
drop policy if exists onboarding_audit_select on public.onboarding_audit_events;
create policy onboarding_audit_select on public.onboarding_audit_events for select to authenticated
  using (private.is_admin() or org_id = private.my_org());

drop policy if exists onboarding_audit_no_direct_write on public.onboarding_audit_events;
create policy onboarding_audit_no_direct_write on public.onboarding_audit_events
  for all to authenticated using (false) with check (false);

-- ---------------------------------------------------------------------
-- 5. Private helpers
-- ---------------------------------------------------------------------

-- Returns true when the org has a currently-valid, verified NDA.
create or replace function private.require_nda_verified(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_nda_status n
    where n.org_id = p_org
      and n.status = 'verified'
      and n.revoked_at is null
  );
$$;

-- Append one audit row. Internal use only.
create or replace function private.log_onboarding_event(
  p_org          uuid,
  p_subject_kind text,
  p_subject_id   text,
  p_action       text,
  p_previous     jsonb,
  p_next         jsonb,
  p_notes        text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.onboarding_audit_events (
    org_id, subject_kind, subject_id, action, previous, next, actor_id, actor_role, notes
  )
  values (p_org, p_subject_kind, p_subject_id, p_action, p_previous, p_next,
          auth.uid(), private.my_role(), p_notes);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Public RPCs
-- ---------------------------------------------------------------------

-- Called by the uploading user (org member or admin acting on behalf of
-- the org) AFTER the file has been written to the storage bucket. Records
-- the metadata row and emits an audit event. Does NOT move bytes.
create or replace function public.record_organization_document(
  p_org_id        uuid,
  p_kind          public.document_kind,
  p_storage_path  text,
  p_original_name text,
  p_mime_type     text,
  p_size_bytes    bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_doc_id uuid;
begin
  if not (private.is_admin() or p_org_id = private.my_org()) then
    raise exception 'Not authorized to upload documents for this organization';
  end if;
  if p_storage_path is null or length(p_storage_path) = 0 then
    raise exception 'storage_path is required';
  end if;

  insert into public.organization_documents
    (org_id, kind, storage_path, original_name, mime_type, size_bytes, uploaded_by)
  values
    (p_org_id, p_kind, p_storage_path, p_original_name, p_mime_type, p_size_bytes, auth.uid())
  returning id into v_doc_id;

  perform private.log_onboarding_event(
    p_org_id, 'document', v_doc_id::text, 'uploaded',
    null,
    jsonb_build_object('kind', p_kind, 'storage_path', p_storage_path, 'size_bytes', p_size_bytes),
    null
  );
  return v_doc_id;
end;
$$;

-- Admin-only review decision for one document.
create or replace function public.admin_review_document(
  p_document_id uuid,
  p_decision    public.document_review_status,
  p_notes       text
) returns public.organization_documents language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.organization_documents;
  v_next public.organization_documents;
begin
  if not private.is_admin() then
    raise exception 'Only admins can review organization documents';
  end if;
  if p_decision = 'pending_review' then
    raise exception 'Cannot "review" a document into pending_review';
  end if;

  select * into v_prev from public.organization_documents where id = p_document_id for update;
  if v_prev.id is null then
    raise exception 'Document % not found', p_document_id;
  end if;

  update public.organization_documents
     set status = p_decision,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_notes = p_notes
   where id = p_document_id
  returning * into v_next;

  perform private.log_onboarding_event(
    v_prev.org_id, 'document', p_document_id::text, p_decision::text,
    jsonb_build_object('status', v_prev.status, 'review_notes', v_prev.review_notes),
    jsonb_build_object('status', v_next.status, 'review_notes', v_next.review_notes),
    p_notes
  );
  return v_next;
end;
$$;

-- Admin-only NDA state transitions. version/notes are stored verbatim.
create or replace function public.admin_update_nda_status(
  p_org_id            uuid,
  p_status            public.nda_status,
  p_nda_version       text,
  p_executed_at       timestamptz,
  p_evidence_doc_id   uuid,
  p_notes             text
) returns public.organization_nda_status language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.organization_nda_status;
  v_next public.organization_nda_status;
begin
  if not private.is_admin() then
    raise exception 'Only admins can update NDA status';
  end if;

  select * into v_prev from public.organization_nda_status where org_id = p_org_id for update;

  insert into public.organization_nda_status
    (org_id, status, nda_version, executed_at, verified_at, verified_by,
     evidence_doc_id, revoked_at, notes)
  values
    (p_org_id, p_status, p_nda_version, p_executed_at,
     case when p_status = 'verified' then now() else null end,
     case when p_status = 'verified' then auth.uid() else null end,
     p_evidence_doc_id,
     case when p_status in ('revoked', 'expired') then now() else null end,
     p_notes)
  on conflict (org_id) do update
     set status          = excluded.status,
         nda_version     = excluded.nda_version,
         executed_at     = excluded.executed_at,
         verified_at     = case when excluded.status = 'verified' then now() else null end,
         verified_by     = case when excluded.status = 'verified' then auth.uid() else null end,
         evidence_doc_id = excluded.evidence_doc_id,
         revoked_at      = case when excluded.status in ('revoked', 'expired') then now() else null end,
         notes           = excluded.notes
  returning * into v_next;

  perform private.log_onboarding_event(
    p_org_id, 'nda', 'nda:' || p_org_id::text,
    v_next.status::text,
    case when v_prev.org_id is null then null
         else jsonb_build_object('status', v_prev.status, 'nda_version', v_prev.nda_version) end,
    jsonb_build_object('status', v_next.status, 'nda_version', v_next.nda_version),
    p_notes
  );
  return v_next;
end;
$$;

-- Convenience read for admins: review queue (pending docs across all orgs).
create or replace function public.admin_list_pending_documents()
returns setof public.organization_documents
language sql stable security definer set search_path = '' as $$
  select d.*
    from public.organization_documents d
   where private.is_admin()
     and d.status = 'pending_review'
   order by d.uploaded_at asc;
$$;

-- Convenience read: full onboarding snapshot for one org.
create or replace function public.get_organization_onboarding(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'organization', (select to_jsonb(o) from public.organizations o where o.id = p_org_id),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.uploaded_at desc)
        from public.organization_documents d where d.org_id = p_org_id
    ), '[]'::jsonb),
    'nda', (select to_jsonb(n) from public.organization_nda_status n where n.org_id = p_org_id),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.occurred_at desc)
        from public.onboarding_audit_events e where e.org_id = p_org_id
    ), '[]'::jsonb)
  )
  where private.is_admin() or p_org_id = private.my_org();
$$;

grant execute on function public.record_organization_document(uuid, public.document_kind, text, text, text, bigint) to authenticated;
grant execute on function public.admin_review_document(uuid, public.document_review_status, text) to authenticated;
grant execute on function public.admin_update_nda_status(uuid, public.nda_status, text, timestamptz, uuid, text) to authenticated;
grant execute on function public.admin_list_pending_documents() to authenticated;
grant execute on function public.get_organization_onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Server-side NDA gate on vendor shares (brief §5: UI hiding is not
--     enough; backend MUST refuse protected collaboration until the NDA
--     is verified).
-- ---------------------------------------------------------------------
create or replace function private.enforce_nda_for_vendor_share()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Re-sharing after a revocation (UPDATE with revoked_at <- null) must
  -- re-check the NDA too; INSERTs always check.
  if (tg_op = 'INSERT')
     or (tg_op = 'UPDATE' and new.revoked_at is null
         and (old.revoked_at is not null or old.vendor_org_id is distinct from new.vendor_org_id))
  then
    if not private.require_nda_verified(new.vendor_org_id) then
      raise exception
        'NDA_NOT_VERIFIED: vendor organization % cannot receive protected requirement shares until a HireNest NDA is verified by an admin.',
        new.vendor_org_id
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_nda_for_vendor_share on public.requirement_vendor_shares;
create trigger trg_enforce_nda_for_vendor_share
  before insert or update on public.requirement_vendor_shares
  for each row execute function private.enforce_nda_for_vendor_share();

commit;
