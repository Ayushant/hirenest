-- Stable key for rows synced in from an external Google Sheet, so repeated
-- syncs upsert the same requirement instead of creating duplicates.
alter table public.requirements
  add column if not exists external_ref text unique;
