-- Deal Room tables: replaces JSON file-based deal room storage
-- Run this in Supabase SQL Editor

-- 1. Deal Rooms
create table if not exists public.deal_rooms (
  id              text primary key,
  submission_id   text,
  requirement_id  text,
  candidate_id    text,
  candidate_name  text,
  requirement_title text,
  client_org_id   text,
  client_org_name text,
  vendor_org_id   text,
  vendor_org_name text,
  assigned_admin_id text,
  assigned_recruiter_id text,
  status          text not null default 'active' check (status in ('active', 'closed')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  closure_reason  text,
  created_by      text not null,
  created_by_name text,
  current_stage   text,
  created_at      timestamptz not null default now()
);

-- 2. Deal Room Messages
create table if not exists public.deal_room_messages (
  id                    text primary key,
  deal_room_id          text not null references public.deal_rooms(id) on delete cascade,
  sender_user_id        text not null,
  sender_display_label  text,
  sender_participant_type text,
  content               text not null,
  attachment_url        text,
  attachment_name       text,
  moderation_status     text default 'clean',
  moderation_note       text,
  created_at            timestamptz not null default now(),
  edited_at             timestamptz
);

-- 3. Deal Room Participants
create table if not exists public.deal_room_participants (
  id                text primary key,
  deal_room_id      text not null references public.deal_rooms(id) on delete cascade,
  user_id           text not null,
  org_id            text,
  participant_type  text not null,
  display_label     text,
  status            text not null default 'active',
  invited_at        timestamptz not null default now(),
  joined_at         timestamptz,
  revoked_at        timestamptz
);

-- 4. Deal Room Contact Requests
create table if not exists public.deal_room_contact_requests (
  id                text primary key,
  deal_room_id      text not null references public.deal_rooms(id) on delete cascade,
  requested_by      text not null,
  requested_by_name text,
  requested_by_type text,
  contact_type      text,
  reason            text,
  status            text not null default 'pending',
  approved_by       text,
  approved_by_name  text,
  disclosure_channel text,
  responded_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- 5. Deal Room Audit Events
create table if not exists public.deal_room_audit_events (
  id            text primary key,
  deal_room_id  text not null references public.deal_rooms(id) on delete cascade,
  actor_id      text not null,
  actor_name    text,
  actor_role    text,
  event_type    text not null,
  metadata      jsonb default '{}',
  timestamp     timestamptz not null default now()
);

-- RLS
alter table public.deal_rooms enable row level security;
alter table public.deal_room_messages enable row level security;
alter table public.deal_room_participants enable row level security;
alter table public.deal_room_contact_requests enable row level security;
alter table public.deal_room_audit_events enable row level security;

-- Allow all reads/writes via service role (server-side only)
create policy "deal_rooms_all" on public.deal_rooms for all using (true) with check (true);
create policy "deal_room_messages_all" on public.deal_room_messages for all using (true) with check (true);
create policy "deal_room_participants_all" on public.deal_room_participants for all using (true) with check (true);
create policy "deal_room_contact_requests_all" on public.deal_room_contact_requests for all using (true) with check (true);
create policy "deal_room_audit_events_all" on public.deal_room_audit_events for all using (true) with check (true);

-- Indexes
create index if not exists idx_deal_room_messages_room on public.deal_room_messages(deal_room_id, created_at);
create index if not exists idx_deal_room_participants_room on public.deal_room_participants(deal_room_id);
create index if not exists idx_deal_room_contact_requests_room on public.deal_room_contact_requests(deal_room_id);
create index if not exists idx_deal_room_audit_events_room on public.deal_room_audit_events(deal_room_id);
create index if not exists idx_deal_rooms_status on public.deal_rooms(status);
create index if not exists idx_deal_rooms_submission on public.deal_rooms(submission_id);
