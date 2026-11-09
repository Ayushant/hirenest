-- Stable key for rows synced in from an external Google Sheet, so repeated
-- syncs upsert the same requirement instead of creating duplicates.
alter table public.requirements
  add column if not exists external_ref text unique;

-- The `private` schema's helper functions (e.g. private.requirement_guard,
-- fired by a trigger on every requirements insert/update) were only granted
-- to `authenticated`. The sheet-sync endpoint writes via the service-role
-- key, which needs the same access to fire those triggers.
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
