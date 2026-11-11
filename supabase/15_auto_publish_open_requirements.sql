-- Auto-publish: whenever a requirement becomes 'open' (created open by HQ/sheet sync,
-- or approved by admin), it is pushed to the public Jobs board automatically.
-- Only fires on the transition into 'open', so HQ can still "Make private" afterwards.

create or replace function private.requirement_auto_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.is_public := true;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_requirement_auto_publish on public.requirements;
create trigger zz_requirement_auto_publish
  before insert or update of status on public.requirements
  for each row execute function private.requirement_auto_publish();

-- Backfill: publish every currently-open requirement.
update public.requirements set is_public = true where status = 'open' and is_public = false;
