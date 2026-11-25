-- Supabase projects can have broader default table grants than isolated PostgreSQL.
-- Make the onboarding privilege contract explicit regardless of those defaults.
begin;
revoke all on public.registration_details,public.candidate_employment,public.trial_extension_policy,
 public.trial_extension_requests,public.organization_pricing_offers from anon,authenticated;
grant select on public.registration_details to authenticated;
grant select,insert,update on public.candidate_employment to authenticated;
grant select,update on public.trial_extension_policy to authenticated;
grant select,insert,update on public.organization_pricing_offers to authenticated;

-- Internal contact directories follow existing user-management permissions, not merely
-- the broad legacy recruiter app role. Signup verification remains Admin-only.
create function private.can_view_staff_profile(p_user uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sm public.staff_members;target public.staff_members;access jsonb;template jsonb;
begin
 if not private.is_internal() then return false;end if;
 if not exists(select 1 from public.profiles where id=p_user and org_id=private.my_org() and status='active' and role in ('admin','recruiter')) then return false;end if;
 select * into sm from public.staff_members where user_id=auth.uid();
 if sm.user_id is null then return false;end if;
 select permissions->'user_management' into template from public.staff_permission_templates where system_role=sm.system_role;
 access:=coalesce(sm.permission_overrides->'user_management',template);
 if access is null or not coalesce((access->'actions')?'view',false) then return false;end if;
 if access->>'scope' in ('platform','organisation') then return true;end if;
 select * into target from public.staff_members where user_id=p_user;
 if access->>'scope'='department' then return sm.department_id is not null and sm.department_id=target.department_id;end if;
 if access->>'scope'='assigned' then
  return exists(select 1 from public.staff_record_assignments where module='user_management' and record_id=p_user::text and user_id=auth.uid());
 end if;
 return false;
end $$;
revoke all on function private.can_view_staff_profile(uuid) from public,anon;
grant execute on function private.can_view_staff_profile(uuid) to authenticated;
drop policy profile_select on public.profiles;
create policy profile_select on public.profiles for select to authenticated using(
 id=auth.uid() or private.is_admin() or private.can_view_staff_profile(id)
 or (private.my_role() in ('vendor_admin','client_manager') and org_id=private.my_org()));
notify pgrst,'reload schema';
commit;
