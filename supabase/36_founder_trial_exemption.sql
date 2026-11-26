-- 36_founder_trial_exemption.sql
-- Exempt only the founder's login from trial expiry. This does not change the
-- organization subscription row, so other users in the same organization keep
-- their existing subscription state.

begin;

create table if not exists public.account_trial_exemptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.account_trial_exemptions enable row level security;
revoke all on public.account_trial_exemptions from anon, authenticated;
grant select on public.account_trial_exemptions to service_role;

create or replace function public.my_account_trial_exempt()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.account_trial_exemptions e
     where e.user_id = auth.uid()
       and e.enabled
  );
$$;
revoke all on function public.my_account_trial_exempt() from public, anon;
grant execute on function public.my_account_trial_exempt() to authenticated;

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
    from auth.users
   where lower(email) = lower('praveen@hirenestworkforce.com');

  if v_user_id is null then
    raise exception 'No Auth user found for praveen@hirenestworkforce.com';
  end if;

  insert into public.account_trial_exemptions(user_id, reason, enabled)
  values (v_user_id, 'Founder account — exempt from trial restrictions', true)
  on conflict (user_id) do update
    set reason = excluded.reason,
        enabled = true;
end $$;

commit;
