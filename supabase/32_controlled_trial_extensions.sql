-- Fixed-duration extensions; account_subscriptions is the authoritative expiry.
begin;
alter table public.event_outbox add column attempts integer not null default 0, add column last_error text;
create table public.trial_extension_policy(
 id boolean primary key default true check(id), max_standard_extensions integer not null default 1 check(max_standard_extensions between 0 and 20)
);
insert into public.trial_extension_policy default values;
alter table public.trial_extension_policy enable row level security;
create policy trial_policy_admin on public.trial_extension_policy for all to authenticated using(private.is_admin()) with check(private.is_admin());
grant select,update on public.trial_extension_policy to authenticated;
create trigger trial_policy_audit after update on public.trial_extension_policy for each row execute function private.audit_row();

create table public.trial_extension_requests(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id),
 requested_by uuid not null references public.profiles(id),requested_days integer not null check(requested_days in (14,21,30)),
 request_reason text not null check(char_length(btrim(request_reason))>=3),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_at timestamptz not null default now(),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,
 review_reason text,internal_notes text,follow_up_date date,exception_approved boolean not null default false,
 previous_expiry timestamptz,new_expiry timestamptz
);
create unique index one_pending_trial_request on public.trial_extension_requests(org_id) where status='pending';
alter table public.trial_extension_requests enable row level security;
revoke all on public.trial_extension_requests from anon,authenticated;
create trigger trial_request_audit after insert or update on public.trial_extension_requests for each row execute function private.audit_row();

create function private.ensure_org_subscription() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and new.type in ('client','vendor') then
  insert into public.account_subscriptions(account_id,account_name) values(new.id::text,new.name) on conflict(account_id) do update set account_name=excluded.account_name;
 end if;return new;
end $$;
create trigger ensure_org_subscription after insert or update of status,name on public.organizations for each row execute function private.ensure_org_subscription();
revoke all on function private.ensure_org_subscription() from public,anon,authenticated;
insert into public.account_subscriptions(account_id,account_name,trial_started_at,trial_ends_at)
select id::text,name,created_at,created_at+interval '14 days' from public.organizations where status='approved' and type in ('client','vendor') on conflict(account_id) do nothing;

create function public.get_org_subscription(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (private.is_admin() or (private.my_org()=p_org_id and private.my_role() is not null)) is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select to_jsonb(s)||jsonb_build_object('server_now',now()) into result from public.account_subscriptions s where account_id=p_org_id::text;
 return result;
end $$;
create function public.admin_subscription_organizations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'type',o.type,'status',o.status,'created_at',o.created_at,
 'trial_ends_at',s.trial_ends_at,'subscription_status',s.subscription_status,'plan_id',s.plan_id))
 from public.organizations o left join public.account_subscriptions s on s.account_id=o.id::text where o.type in ('client','vendor')),'[]');
end $$;
create function public.list_trial_extension_requests(p_org_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (private.is_admin() or (private.my_role() in ('vendor_admin','client_manager') and private.my_org()=p_org_id)) is not true then
  raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg((case when private.is_admin() then to_jsonb(r) else to_jsonb(r)-'internal_notes'-'review_reason' end)
 ||jsonb_build_object('org_name',o.name) order by r.requested_at desc)
 from public.trial_extension_requests r join public.organizations o on o.id=r.org_id
 where p_org_id is null or r.org_id=p_org_id),'[]');
end $$;
create function public.request_trial_extension(p_org_id uuid,p_days integer,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;s public.account_subscriptions;
begin
 if (private.is_admin() or (private.my_role() in ('vendor_admin','client_manager') and private.my_org()=p_org_id)) is not true then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.organizations where id=p_org_id and type in ('client','vendor') and status='approved') then raise exception 'Organisation is not eligible';end if;
 select * into s from public.account_subscriptions where account_id=p_org_id::text for update;
 if s.account_id is null or s.plan_id<>'free_trial' or s.subscription_status='active' then raise exception 'Only trial organisations are eligible';end if;
 insert into public.trial_extension_requests(org_id,requested_by,requested_days,request_reason)
 values(p_org_id,auth.uid(),p_days,p_reason) returning id into result;return result;
end $$;
create function public.review_trial_extension(p_request_id uuid,p_decision text,p_reason text,
 p_notes text default null,p_follow_up date default null,p_exception boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.trial_extension_requests;s public.account_subscriptions;limit_count integer;approved_count integer;is_higher boolean;ends timestamptz;
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_decision not in ('approved','rejected') or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Decision and reason are required';end if;
 select * into r from public.trial_extension_requests where id=p_request_id for update;
 if r.id is null then raise exception 'Request not found';end if;
 if r.status=p_decision then return to_jsonb(r);end if;
 if r.status<>'pending' then raise exception 'Request already reviewed';end if;
 if p_decision='approved' then
  select * into s from public.account_subscriptions where account_id=r.org_id::text for update;
  if s.account_id is null or s.plan_id<>'free_trial' or s.subscription_status='active' then raise exception 'Organisation is no longer on a trial';end if;
  select max_standard_extensions into limit_count from public.trial_extension_policy where id;
  select count(*) into approved_count from public.trial_extension_requests where org_id=r.org_id and status='approved';
  select not exists(select 1 from public.staff_members where user_id=auth.uid() and system_role not in ('platform_admin','super_admin')) into is_higher;
  if (r.requested_days=30 or approved_count>=limit_count or p_exception) and not is_higher then raise exception 'Platform Admin or Super Admin approval required';end if;
  if approved_count>=limit_count and not p_exception then raise exception 'Standard extension limit reached: explicit exception approval required';end if;
  ends:=s.trial_ends_at+make_interval(days=>r.requested_days);
  update public.account_subscriptions set trial_ends_at=ends,trial_duration_days=ceil(extract(epoch from (ends-trial_started_at))/86400),
   subscription_status=case when ends<=now() then 'expired' else 'trialing' end,updated_at=now() where account_id=r.org_id::text;
  perform private.notify_org(r.org_id,'account','Trial extension approved','Your new trial expiry is '||ends::text,'/subscription');
  perform private.emit_event('TRIAL_EXTENSION_APPROVED','organization',r.org_id,jsonb_build_object('org_id',r.org_id,'trial_ends_at',ends),'TRIAL_EXTENSION:'||r.id);
 end if;
 update public.trial_extension_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=p_reason,
 internal_notes=p_notes,follow_up_date=p_follow_up,exception_approved=p_exception,previous_expiry=s.trial_ends_at,new_expiry=ends where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
-- Cancel queued emails when their authoritative expiry changes or converts to paid.
create function private.cancel_old_trial_messages() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.event_outbox set status='processed',processed_at=now(),last_error='Cancelled: expiry or subscription changed'
 where entity_id=private.try_uuid(new.account_id) and processed_at is null
 and event_type in ('TRIAL_REMINDER_REQUESTED','TRIAL_EXTENSION_APPROVED')
 and (new.subscription_status='active' or new.plan_id<>'free_trial' or (payload->>'trial_ends_at') is distinct from (to_jsonb(new.trial_ends_at)#>>'{}'));
 return new;
end $$;
create trigger cancel_old_trial_messages after update of trial_ends_at,subscription_status,plan_id on public.account_subscriptions
 for each row execute function private.cancel_old_trial_messages();
revoke all on function private.cancel_old_trial_messages() from public,anon,authenticated;
-- Atomic reminders: current expiry and paid status are checked before queueing.
create function public.enqueue_trial_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare s public.account_subscriptions;days integer;total integer:=0;k text;org uuid;
begin
 for s in select * from public.account_subscriptions where plan_id='free_trial' and subscription_status in ('trialing','expired') and trial_ends_at>now() for update loop
  days:=ceil(extract(epoch from (s.trial_ends_at-now()))/86400);
  if days=any(array[10,8,5,2,1]) then
   org:=private.try_uuid(s.account_id);if org is null then continue;end if;
   k:='TRIAL_REMINDER:'||s.account_id||':'||s.trial_ends_at::text||':'||days;
   if not exists(select 1 from public.event_outbox where idempotency_key=k) then
    perform private.emit_event('TRIAL_REMINDER_REQUESTED','organization',org,jsonb_build_object('org_id',org,'trial_ends_at',s.trial_ends_at,'days_remaining',days),k);
    perform private.notify_org(org,'account',days||' days left in your trial','Your trial expires on '||s.trial_ends_at::text,'/subscription');total:=total+1;
   end if;
  end if;
 end loop;
 return total;
end $$;
revoke all on function public.enqueue_trial_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_trial_reminders() to service_role;
revoke all on function public.get_org_subscription(uuid),public.admin_subscription_organizations(),public.list_trial_extension_requests(uuid),
 public.request_trial_extension(uuid,integer,text),public.review_trial_extension(uuid,text,text,text,date,boolean) from public,anon;
grant execute on function public.get_org_subscription(uuid),public.admin_subscription_organizations(),public.list_trial_extension_requests(uuid),
 public.request_trial_extension(uuid,integer,text),public.review_trial_extension(uuid,text,text,text,date,boolean) to authenticated;
alter table public.event_outbox add column trial_claimed_until timestamptz;
create function public.claim_trial_notifications(p_limit integer default 25)
returns setof public.event_outbox language sql security definer set search_path='' as $$
 update public.event_outbox e set trial_claimed_until=now()+interval '5 minutes',attempts=attempts+1
 where e.id in(select id from public.event_outbox where event_type in ('TRIAL_REMINDER_REQUESTED','TRIAL_EXTENSION_APPROVED')
 and processed_at is null and (trial_claimed_until is null or trial_claimed_until<now()) order by created_at limit least(greatest(p_limit,1),100) for update skip locked)
 returning e.*;
$$;
revoke all on function public.claim_trial_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_trial_notifications(integer) to service_role;
-- Negotiated prices use existing plan IDs and entitlements; they never extend trials.
create table public.organization_pricing_offers(
 org_id uuid not null references public.organizations(id),plan_id text not null check(plan_id in ('growth','scale','enterprise')),
 billing_cycle text not null check(billing_cycle in ('monthly','annual')),amount_inr numeric(14,2) not null check(amount_inr>0),
 reason text not null check(char_length(btrim(reason))>=3),expires_at timestamptz not null,
 approved_by uuid not null default auth.uid() references public.profiles(id),updated_at timestamptz not null default now(),
 primary key(org_id,plan_id,billing_cycle)
);
alter table public.organization_pricing_offers enable row level security;
create policy pricing_read on public.organization_pricing_offers for select to authenticated
 using(private.is_admin() or (org_id=private.my_org() and private.my_role() in ('vendor_admin','client_manager')));
create policy pricing_insert on public.organization_pricing_offers for insert to authenticated with check(private.is_admin() and approved_by=auth.uid());
create policy pricing_update on public.organization_pricing_offers for update to authenticated using(private.is_admin()) with check(private.is_admin() and approved_by=auth.uid());
grant select,insert,update on public.organization_pricing_offers to authenticated;
create trigger pricing_timestamp before update on public.organization_pricing_offers for each row execute function private.set_updated_at();
create trigger pricing_audit after insert or update on public.organization_pricing_offers for each row execute function private.audit_row();

create function public.admin_assign_subscription_plan(p_org_id uuid,p_plan_id text,p_billing_cycle text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_plan_id not in ('free_trial','growth','scale','enterprise') or p_billing_cycle not in ('monthly','annual') or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Plan, billing cycle and reason are required';end if;
 update public.account_subscriptions set plan_id=p_plan_id,billing_cycle=p_billing_cycle,
 subscription_status=case when p_plan_id<>'free_trial' then 'active' when trial_ends_at>now() then 'trialing' else 'expired' end,
 paid_activated_at=case when p_plan_id<>'free_trial' then now() else null end,
 current_period_ends_at=case when p_plan_id<>'free_trial' then now()+case when p_billing_cycle='annual' then interval '365 days' else interval '30 days' end else null end,updated_at=now()
 where account_id=p_org_id::text;
 if not found then raise exception 'Organisation subscription not found';end if;
 perform private.emit_event('SUBSCRIPTION_PLAN_ASSIGNED','organization',p_org_id,jsonb_build_object('plan_id',p_plan_id,'billing_cycle',p_billing_cycle,'reason',p_reason));
end $$;
revoke all on function public.admin_assign_subscription_plan(uuid,text,text,text) from public,anon;
grant execute on function public.admin_assign_subscription_plan(uuid,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
