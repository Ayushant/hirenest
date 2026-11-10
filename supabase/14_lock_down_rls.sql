-- Lock down migrated tables: remove allow-everyone policies.
-- RLS stays enabled with no policies, so the public anon key gets nothing.
-- The server uses the service-role key, which bypasses RLS, so the app keeps working.

drop policy if exists "Users can read own org subscription" on public.account_subscriptions;
drop policy if exists "Only service role can insert" on public.account_subscriptions;
drop policy if exists "Only service role can update" on public.account_subscriptions;

drop policy if exists "deal_rooms_all" on public.deal_rooms;
drop policy if exists "deal_room_messages_all" on public.deal_room_messages;
drop policy if exists "deal_room_participants_all" on public.deal_room_participants;
drop policy if exists "deal_room_contact_requests_all" on public.deal_room_contact_requests;
drop policy if exists "deal_room_audit_events_all" on public.deal_room_audit_events;

drop policy if exists "privacy_notices_all" on public.privacy_notices;
drop policy if exists "privacy_acknowledgements_all" on public.privacy_acknowledgements;
drop policy if exists "data_processing_records_all" on public.data_processing_records;
drop policy if exists "privacy_requests_all" on public.privacy_requests;
drop policy if exists "retention_policies_all" on public.retention_policies;
drop policy if exists "deletion_jobs_all" on public.deletion_jobs;
drop policy if exists "privacy_incidents_all" on public.privacy_incidents;
drop policy if exists "privacy_audit_events_all" on public.privacy_audit_events;
