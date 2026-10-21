-- =====================================================================
-- HireNestOS: make the first admin
-- ---------------------------------------------------------------------
-- 1. Run 01_schema.sql first.
-- 2. Sign up ONCE in the app (or Supabase Dashboard -> Authentication ->
--    Add user) with the email below.
-- 3. Replace the email, then run this in the SQL Editor.
-- After this, create every other user's role from the Admin workspace.
-- =====================================================================

update public.profiles
   set role   = 'admin',
       status = 'active',
       org_id = (select id from public.organizations where type = 'internal')
 where email = 'REPLACE_WITH_YOUR_EMAIL@example.com';

-- Should return exactly one row with role = admin.
select id, email, role, status from public.profiles where role = 'admin';
