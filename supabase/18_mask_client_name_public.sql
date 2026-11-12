-- Public job board shows a Client ID (CL-XXXXXX) instead of the client's company name.
create or replace function public.get_public_requirement(p_slug text)
returns table (
  id uuid, slug text, title text, description text, skills text[],
  min_experience numeric(4,1), max_experience numeric(4,1),
  location text, work_mode text, employment_type text, openings integer,
  currency text, client_org_name text, posted_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.title, r.description, r.skills,
         r.min_experience, r.max_experience, r.location, r.work_mode,
         r.employment_type, r.openings, r.currency,
         'CL-' || upper(left(replace(r.client_org_id::text, '-', ''), 6)) as client_org_name,
         coalesce(r.opened_at, r.created_at) as posted_at
    from public.requirements r
   where r.slug = p_slug and r.status = 'open' and r.is_public = true;
$$;

create or replace function public.list_public_requirements(
  p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, slug text, title text, location text,
  work_mode text, employment_type text,
  min_experience numeric(4,1), max_experience numeric(4,1),
  client_org_name text, posted_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.title, r.location, r.work_mode, r.employment_type,
         r.min_experience, r.max_experience,
         'CL-' || upper(left(replace(r.client_org_id::text, '-', ''), 6)) as client_org_name,
         coalesce(r.opened_at, r.created_at) as posted_at
    from public.requirements r
   where r.status = 'open' and r.is_public = true
   order by coalesce(r.opened_at, r.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
   offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_public_requirement(text) to anon, authenticated;
grant execute on function public.list_public_requirements(int, int) to anon, authenticated;
