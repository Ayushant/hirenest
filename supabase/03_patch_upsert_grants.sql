-- =====================================================================
-- Patch 03: allow .upsert() on budget and margin tables
-- Run this ONLY if you already ran an older 01_schema.sql.
-- (New installs already include it.)
-- Why: supabase-js .upsert() updates every column it sends, including
-- requirement_id, so the column needs UPDATE permission. RLS still
-- restricts which requirement a user can write to.
-- =====================================================================
grant update (requirement_id) on public.requirement_financials to authenticated;
grant update (requirement_id) on public.requirement_margins to authenticated;
notify pgrst, 'reload schema';
