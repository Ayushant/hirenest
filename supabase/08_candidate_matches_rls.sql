-- Allow internal users (admin, recruiter) to insert and update candidate_matches
-- The matching engine on the client side needs to write enriched scores back.

create policy match_insert on public.candidate_matches for insert to authenticated
  with check (private.is_internal());

create policy match_update on public.candidate_matches for update to authenticated
  using (private.is_internal())
  with check (private.is_internal());
