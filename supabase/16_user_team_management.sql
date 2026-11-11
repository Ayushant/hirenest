-- User & Team Management Centre (internal employees only).
-- Overlay on public.profiles: existing app_role / RLS are untouched.
-- Accessed only through the server with the service-role key (RLS on, no policies).

create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_members (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  employee_id          text unique,
  department_id        uuid references public.departments (id) on delete set null,
  designation          text,
  system_role          text not null default 'recruiter'
    check (system_role in ('platform_admin','super_admin','senior_bom','bdm','hr','admin_recruiter','recruiter')),
  reporting_manager_id uuid references auth.users (id) on delete set null,
  team                 text,
  joining_date         date,
  permission_template  text,
  permission_overrides jsonb not null default '{}'::jsonb,
  extra_restricted_fields text[] not null default '{}',
  invited_at           timestamptz,
  activated_at         timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists staff_members_manager on public.staff_members (reporting_manager_id);
create index if not exists staff_members_dept on public.staff_members (department_id);

-- Admin-configurable default permission matrix per role (falls back to code defaults when absent).
create table if not exists public.staff_permission_templates (
  system_role text primary key,
  permissions jsonb not null,
  restricted_fields text[] not null default '{}',
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

create table if not exists public.access_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid,
  actor_role    text,
  target_user_id uuid,
  action        text not null,   -- user_created, role_changed, department_changed, manager_changed, permissions_changed, suspended, reactivated, template_changed, denied
  before        jsonb,
  after         jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists access_audit_target on public.access_audit_log (target_user_id, created_at desc);
create index if not exists access_audit_created on public.access_audit_log (created_at desc);

alter table public.departments enable row level security;
alter table public.staff_members enable row level security;
alter table public.staff_permission_templates enable row level security;
alter table public.access_audit_log enable row level security;

insert into public.departments (name) values
  ('Business Development'), ('Human Resources'), ('Recruitment'), ('Operations'), ('Management')
on conflict (name) do nothing;

-- Existing HQ admins become Platform Admins; existing internal recruiters become Recruiters.
insert into public.staff_members (user_id, system_role)
select p.id, case when p.role = 'admin' then 'platform_admin' else 'recruiter' end
from public.profiles p
where p.role in ('admin', 'recruiter')
on conflict (user_id) do nothing;
