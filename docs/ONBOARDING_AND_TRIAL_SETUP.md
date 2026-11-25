# Onboarding and controlled trials

Apply `supabase/31_complete_onboarding.sql`, then `supabase/32_controlled_trial_extensions.sql` after upstream migrations 01–30. These are additive, one-time migrations. Do not rerun the fresh-install schema on an existing database.

## Records and workflow

- Supabase Auth remains the login identity. `profiles` remains the user record.
- New registration captures contact details, designation and the appropriate candidate or company fields.
- Candidate registrations create a linked candidate and protected `candidate_employment` record upfront. If contact details match an existing candidate, automatic claiming is blocked; HQ must link the existing record after verification.
- `registration_details` holds review state and pending submitted details, not another user or organisation. After approval, company details move into the existing or newly approved organisation; the draft is cleared. Historical changes remain in the audit log.
- Admin opens **Approvals → User Sign-ups → Review**, inspects details, supplies a reason and approves or rejects. Organisation creation/linking, user assignment and the review decision are atomic and retry-safe.
- `organizations.primary_contact_user_id` links to the user. Organisation contact displays resolve that profile instead of copying its name, phone and email.
- Organisation team displays reuse memberships in `profiles`. Internal department/designation/hierarchy still come from `staff_members` and `departments`.
- Users update authorised contact details through **Edit my contact profile** in the header. Linked candidate name/mobile changes stay consistent. Login email changes must use verified Auth updates.
- Candidate employment details are available in candidate, HQ and vendor candidate profiles. Clients and public pages cannot read these private records. Internal staff permissions and assignments restrict commercial access.

## Trial policy

- Eligible organisations receive a 14-day trial on approval.
- `account_subscriptions.trial_ends_at` is the authoritative expiry. No organisation expiry copy is needed.
- Organisation Admins request 14, 21 or 30 additional days from **Subscription**. HQ can create requests from **Subscription management**.
- HQ reviews requests with a reason, internal notes and optional follow-up date. Extensions add days to the existing expiry, even if it is in the past.
- The default normal extension limit is one, configurable by Admin. Further extensions require explicit exception approval. Thirty-day and exception approvals require Platform Admin or Super Admin privileges; legacy Admins without a staff overlay retain Platform Admin authority.
- Repeat approvals do not add days twice. Paid organisations cannot receive trial extensions. The old unrestricted trial activation and date-setting paths are disabled.
- Reminders use 10, 8, 5, 2 and 1 days remaining. Queue keys include the current expiry. Expiry changes and paid conversion cancel obsolete queued emails. The email worker rechecks expiry before delivery.
- Early-adopter pricing is approved separately for an existing plan and billing cycle. An approved amount changes pricing, not plan entitlements or trial expiry.

## Environment and operations

Browser configuration:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
```

Migration 33 explicitly revokes broad project defaults and applies staff-directory permissions.

Existing server-side invitation/team-management operations and the trial email worker require `SUPABASE_SERVICE_ROLE_KEY`. Keep it server-only, outside Git, and never prefix it with `VITE_`. Database passwords are not API keys.

Email additionally requires the existing SMTP or Resend provider configuration. Missing email configuration leaves delivery pending; it must not be reported as sent. No real email deliveries are part of the isolated tests.

The existing running Node server polls the trial worker every minute. Serverless deployments use the existing authenticated `/api/alerts/run?job=all` Vercel cron; it now includes trial reminders. The existing `CRON_SECRET`, server Supabase key and email provider must be configured. In-app trial notifications persist in the database. There is a short delivery race if a subscription changes after the final pre-send check, and SMTP cannot guarantee exactly-once delivery after a process crash.

## Verification

```
npm run test:onboarding
npm run build
npm run lint
```

`test:onboarding` uses an isolated PostgreSQL engine with Auth/Storage stubs; it does not contact Supabase or modify the live project. It covers signup capture, protected fields, atomic approvals, idempotency, linked contact edits, tenant isolation, extension arithmetic/limits, pricing separation and reminder cancellation.

The repository already contains unrelated TypeScript errors. Compare `npm run lint` with the baseline rather than assuming every diagnostic was introduced here. A successful build is not a full UI or hosted integration test.

## Candidate uploads and joining eligibility

After migrations 31–33, apply `supabase/34_candidate_employment_submissions.sql` once. Do not rerun `01_schema.sql` on an existing database. The upload RPC calls the existing candidate creation function and saves employment in the same transaction; invalid employment rolls back creation.

Single upload and every bulk row use the shared FTE/C2C/C2H form. Candidate pool rows offer employment editing and filters. Submissions load the linked employment row under its existing RLS policy instead of storing another salary or notice record.

For vendor/internal submissions, explicit immediate-only wording in the description or encoded joining timeline rejects confirmed incompatible notice periods and future joining/LWD dates. Missing availability requires review; “immediate preferred” does not reject. Rejections persist per requirement with their reason and stage history. Corrected availability can be submitted again using the existing submission record. Existing submissions are not retrospectively rejected, and direct candidate application rules are unchanged.

Run `npm run test:onboarding` and `node --test tests/*.test.mjs`. The SQL suite uses isolated PGlite with auth/storage fixtures; it does not replace hosted database or browser testing. Deploy the frontend changes and migration together.

## Completing existing accounts and reviewing adjusted trial days

Apply `supabase/35_finish_onboarding_and_trial_review.sql` after migration 34. It is safe to reapply. Admin linking now transfers a verified candidate signup draft into the existing candidate/employment record, synchronises contact identity and clears the draft. Linking cannot take over another account, and repeat linking does not create records.

Active users with incomplete records see **Complete your profile details** in the workspace. Candidate information writes to their linked candidate record. Organisation members can update only their own contact/job details; only organisation Admins or their primary contact can complete company information. Internal users cannot change their own staff role, designation or hierarchy through completion. Existing candidate records must be linked or created through the existing candidate workflow. No duplicate user, candidate or organisation is created by completion.

Trial review supports selecting 14, 21 or 30 approved days while preserving the originally requested days. The approved duration controls expiry arithmetic and approval authority. Thirty-day/exception approvals still require Platform/Super Admin authority. Existing six-argument API callers continue to use the same review implementation.

Run `npm run check:onboarding-services` after setting server credentials in the ignored `.env` file. It checks Supabase administrative access and email-provider connectivity without sending messages or printing secrets. Invitation emails require Resend and a verified sender; operational notifications support SMTP with Resend fallback. Missing configuration leaves notifications pending. Valid provider credentials are required to verify actual delivery; a database password and website Admin password do not replace them.

The app's `npm run lint` checks application code, server files and scripts. The independently packaged `hirenest-promo` Remotion project retains its own package dependencies and type-check configuration.

## Port to the updated repository

This checkout starts at upstream commit `3f5ff7e` (dashboard/activity-navigation fixes). Upstream owns migration `30_dashboard_activity_links.sql`; the five onboarding/trial migrations are therefore numbered 31–35 here.

For a fresh database, apply upstream migrations through 30, followed by 31–35. For the existing test project used with the previous checkout, those onboarding/trial structures are already installed under the earlier filenames: **do not rerun migrations 31–34 against that database**. Filenames changing does not make the table-creation SQL safe to repeat. Migration 35 is idempotent; upstream migration 30 is a repeat-safe notification-link backfill.
