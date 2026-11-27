-- Vendor feedback and controlled trial reactivation.
begin;

create table if not exists public.vendor_reactivation_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  invited_email text not null,
  token_hash text not null unique,
  status text not null default 'sent' check (status in ('sent','send_failed','feedback_received','call_requested','call_scheduled','call_completed','reactivated')),
  sent_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  delivery_error text,
  onboarding_call_scheduled_at timestamptz,
  onboarding_call_completed_at timestamptz,
  reactivation_days integer check (reactivation_days in (14,30)),
  reactivated_at timestamptz,
  expires_at timestamptz not null default now() + interval '45 days'
);
create index if not exists vendor_reactivation_invites_org on public.vendor_reactivation_invites(org_id, created_at desc);
create index if not exists vendor_reactivation_invites_status on public.vendor_reactivation_invites(status, created_at desc);

create table if not exists public.vendor_reactivation_feedback (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.vendor_reactivation_invites(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  trial_exploration text not null check (trial_exploration in ('yes','partially','could_not_use','no_suitable_requirements')),
  biggest_challenge text not null check (biggest_challenge in ('requirements','matching_submission','usability_onboarding','notifications_followups','time','other')),
  feature_suggestion_one text not null check (char_length(btrim(feature_suggestion_one)) between 2 and 1000),
  feature_suggestion_two text not null check (char_length(btrim(feature_suggestion_two)) between 2 and 1000),
  wants_onboarding_call boolean not null default false,
  contact_number text,
  preferred_call_time text,
  additional_feedback text,
  submitted_at timestamptz not null default now(),
  check (not wants_onboarding_call or nullif(btrim(contact_number), '') is not null)
);
create index if not exists vendor_reactivation_feedback_org on public.vendor_reactivation_feedback(org_id, submitted_at desc);

alter table public.vendor_reactivation_invites enable row level security;
alter table public.vendor_reactivation_feedback enable row level security;
revoke all on public.vendor_reactivation_invites, public.vendor_reactivation_feedback from public, anon, authenticated;
grant all on public.vendor_reactivation_invites, public.vendor_reactivation_feedback to service_role;

create or replace function public.reactivate_vendor_trial_from_feedback(p_invite_id uuid, p_days integer, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_inv public.vendor_reactivation_invites; v_sub public.account_subscriptions; v_ends timestamptz; v_is_platform_admin boolean;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_days not in (14,30) or char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Choose 14 or 30 days and provide a reason'; end if;
  select * into v_inv from public.vendor_reactivation_invites where id=p_invite_id for update;
  if v_inv.id is null then raise exception 'Vendor feedback must be received before reactivation'; end if;
  if not exists(select 1 from public.vendor_reactivation_feedback where invite_id=v_inv.id) then raise exception 'Feedback is required'; end if;
  if v_inv.onboarding_call_completed_at is null then raise exception 'Complete the onboarding call before reactivation'; end if;
  select * into v_sub from public.account_subscriptions where account_id=v_inv.org_id::text for update;
  if v_sub.account_id is null or v_sub.plan_id <> 'free_trial' then raise exception 'Only free-trial vendor accounts can be reactivated'; end if;
  if p_days=14 and (v_inv.status not in ('feedback_received','call_requested','call_scheduled','call_completed') or v_sub.subscription_status='active') then raise exception 'A 14-day reactivation can only be granted to an inactive trial'; end if;
  if p_days=30 and (v_inv.status<>'reactivated' or v_inv.reactivation_days<>14) then raise exception 'The additional 30 days are available only after a 14-day reactivation'; end if;
  select exists(select 1 from public.staff_members where user_id=auth.uid() and system_role in ('platform_admin','super_admin')) into v_is_platform_admin;
  if p_days=30 and not v_is_platform_admin then raise exception 'Platform Admin or Super Admin approval is required for 30 days'; end if;
  v_ends := greatest(coalesce(v_sub.trial_ends_at, now()), now()) + make_interval(days=>p_days);
  update public.account_subscriptions set trial_started_at=case when p_days=14 then now() else trial_started_at end, trial_ends_at=v_ends,
    trial_duration_days=ceil(extract(epoch from (v_ends-case when p_days=14 then now() else trial_started_at end))/86400),
    subscription_status='trialing', updated_at=now() where account_id=v_inv.org_id::text;
  insert into public.trial_extension_requests(org_id,requested_by,requested_days,request_reason,status,reviewed_by,reviewed_at,review_reason,exception_approved,previous_expiry,new_expiry,approved_days)
  values(v_inv.org_id,auth.uid(),p_days,'Vendor reactivation: '||btrim(p_reason),'approved',auth.uid(),now(),btrim(p_reason),p_days=30,v_sub.trial_ends_at,v_ends,p_days);
  update public.vendor_reactivation_invites set status='reactivated',reactivation_days=p_days,reactivated_at=now() where id=v_inv.id;
  perform private.notify_org(v_inv.org_id,'account','HireNestOS trial reactivated','Your complimentary access is active until '||v_ends::text,'/subscription');
  perform private.emit_event('VENDOR_TRIAL_REACTIVATED','organization',v_inv.org_id,jsonb_build_object('days',p_days,'trial_ends_at',v_ends,'invite_id',v_inv.id));
  return jsonb_build_object('org_id',v_inv.org_id,'trial_ends_at',v_ends,'days',p_days);
end $$;
revoke all on function public.reactivate_vendor_trial_from_feedback(uuid,integer,text) from public,anon;
grant execute on function public.reactivate_vendor_trial_from_feedback(uuid,integer,text) to authenticated;
commit;
