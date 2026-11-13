-- =====================================================================
-- SLA auto-close: reset opened_at on re-open so the SLA clock restarts
-- =====================================================================

-- When a requirement is moved to 'open', always reset opened_at so the
-- SLA clock starts fresh. Previously, opened_at was only set once (on
-- first open), meaning a re-opened requirement would expire immediately
-- because the old opened_at + sla_hours was already in the past.

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
         opened_at = case when p_status = 'open' then now() else opened_at end,
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
