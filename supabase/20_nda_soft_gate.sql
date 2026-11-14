-- =====================================================================
-- 20_nda_soft_gate.sql
-- Change NDA gate from HARD (blocks requirement shares) to SOFT:
--   • Requirement shares are allowed for all vendors regardless of NDA.
--   • Candidate submissions are allowed freely.
--   • After the 3rd submission, the system flags the vendor so the
--     frontend can show an NDA nudge banner/modal.
-- =====================================================================

begin;

-- 1. Drop the hard NDA trigger on requirement_vendor_shares
--    so vendors can receive requirement shares without a verified NDA.
drop trigger if exists trg_enforce_nda_for_vendor_share on public.requirement_vendor_shares;

-- Keep the enforce function in place (for future optional use / audits)
-- but it is no longer wired to a trigger.

-- 2. Helper: how many total submissions has this vendor org made?
--    Returns the count. Called from the frontend after each submission.
create or replace function public.get_vendor_submission_count(p_vendor_org_id uuid)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer
  from public.submissions
  where vendor_org_id = p_vendor_org_id;
$$;

grant execute on function public.get_vendor_submission_count(uuid) to authenticated;

-- 3. Helper: check whether this vendor org has a verified NDA.
--    Returns true only when status = 'verified'.
create or replace function public.vendor_nda_is_verified(p_vendor_org_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_nda_status
    where org_id = p_vendor_org_id
      and status = 'verified'
  );
$$;

grant execute on function public.vendor_nda_is_verified(uuid) to authenticated;

commit;
