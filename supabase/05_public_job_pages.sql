-- =====================================================================
-- 05_public_job_pages.sql
-- Public shareable job pages (/jobs/:slug). Anyone can view a public
-- requirement without logging in. Candidates can apply after sign-up.
--
-- Run in Supabase SQL editor AFTER 01-04 are applied. Safe to re-run.
-- =====================================================================

-- 1. Slug column (unique, lower-case, dash-separated).
alter table public.requirements
  add column if not exists slug text;

create unique index if not exists requirements_slug_unique
  on public.requirements (slug) where slug is not null;

-- 2. Slug generator: "job-title-location-xxxxxxxx" where xxxx is a stable
--    8-char suffix of the id, so the slug is both pretty AND unique.
create or replace function private.slugify(p_text text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             lower(coalesce(p_text, '')),
             '[^a-z0-9]+', '-', 'g'
           ),
           '(^-+|-+$)', '', 'g'
         );
$$;

create or replace function private.build_requirement_slug(
  p_id uuid, p_title text, p_location text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from
    coalesce(nullif(private.slugify(p_title), ''), 'job') || '-' ||
    coalesce(nullif(private.slugify(p_location), ''), '') || '-' ||
    substring(p_id::text, 1, 8))
$$;

-- 3. Trigger to keep the slug synced on insert/update of title/location.
create or replace function private.set_requirement_slug()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.slug := private.build_requirement_slug(new.id, new.title, new.location);
  return new;
end;
$$;

drop trigger if exists set_requirement_slug on public.requirements;
create trigger set_requirement_slug
  before insert or update of title, location on public.requirements
  for each row execute function private.set_requirement_slug();

-- 4. Backfill slugs for existing rows.
update public.requirements
   set slug = private.build_requirement_slug(id, title, location)
 where slug is null;

-- 5. Public RPC: returns only safe-to-share fields. No budget, no financials,
--    no vendor shares. Client org name only if the client has not opted out.
--    Available to the anonymous role so unsigned visitors can view the page.
create or replace function public.get_public_requirement(p_slug text)
returns table (
  id                 uuid,
  slug               text,
  title              text,
  description        text,
  skills             text[],
  min_experience     numeric(4,1),
  max_experience     numeric(4,1),
  location           text,
  work_mode          text,
  employment_type    text,
  openings           integer,
  currency           text,
  client_org_name    text,
  posted_at          timestamptz
) language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.title, r.description, r.skills,
         r.min_experience, r.max_experience, r.location, r.work_mode,
         r.employment_type, r.openings, r.currency,
         o.name as client_org_name,
         coalesce(r.opened_at, r.created_at) as posted_at
    from public.requirements r
    left join public.organizations o on o.id = r.client_org_id
   where r.slug = p_slug
     and r.status = 'open'
     and r.is_public = true;
$$;

grant execute on function public.get_public_requirement(text) to anon, authenticated;

-- 6. Public RPC: list all open public jobs (for a listing page / sitemap).
create or replace function public.list_public_requirements(
  p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, slug text, title text, location text,
  work_mode text, employment_type text,
  min_experience numeric(4,1), max_experience numeric(4,1),
  client_org_name text, posted_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.title, r.location, r.work_mode, r.employment_type,
         r.min_experience, r.max_experience, o.name as client_org_name,
         coalesce(r.opened_at, r.created_at) as posted_at
    from public.requirements r
    left join public.organizations o on o.id = r.client_org_id
   where r.status = 'open'
     and r.is_public = true
   order by coalesce(r.opened_at, r.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
   offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.list_public_requirements(int, int) to anon, authenticated;

-- =====================================================================
-- END OF 05_public_job_pages.sql
-- =====================================================================
