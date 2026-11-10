-- Enterprise records: requirements, mappings, fingerprints, audit trail, orders, receipts, reminders, etc.
-- One row per record (arrays are stored as a single row with record_key '__array__').
-- Run this in Supabase SQL Editor. No seed needed: the server copies existing data in on first start.

create table if not exists public.enterprise_records (
  collection  text not null,
  record_key  text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (collection, record_key)
);

-- RLS on with NO policies: only the server's service-role key can read/write.
alter table public.enterprise_records enable row level security;

create index if not exists idx_enterprise_records_collection
  on public.enterprise_records (collection);
