# HireNestOS — Enterprise Workforce & Staffing Operating System

## What I changed for this request

**Objective:** collect onboarding details once and keep Admin review, user profiles, organisations and teams synchronised.

- Added candidate/client/vendor onboarding fields, including contact/company details and conditional FTE/C2C/C2H salary or commercial-rate information.
- Added detailed Admin signup review and approval that populates linked user, organisation and primary-contact records.
- Added profile/team synchronisation, older-account completion and existing-candidate linking without duplicate user or organisation entities.
- Fixed Bench Profile/BGV on the first save; added employment fields to single/bulk uploads, candidate management and submissions.
- Added immediate-only vendor/internal submission filtering and automatic rejection with reasons. Missing availability requires review.
- Added controlled trial extensions, reviewer-selected days, reminders, negotiated pricing, scoped permissions, auditing and TypeScript fixes.

## Verification and merge requirements

**Checked:** 85 isolated database tests, 18 regression tests, application type check and production build. Local browser checks covered Admin login/CEO landing and single/bulk employment forms; production workflows are not fully verified.

**Main:** compatible with upstream `3f5ff7e`, with no merge conflict against that revision. Future main changes require another check.

**After merging:** confirm Vercel deployment, apply missing database migrations, configure server/email credentials, and test live workflows. Merging alone does not finish these steps. Real email delivery and team invitations remain unverified.

See [setup instructions](docs/ONBOARDING_AND_TRIAL_SETUP.md) for migrations **31–35**. The earlier test database already contains these structures under older filenames; do not blindly rerun table-creation scripts or `01_schema.sql` on an existing database.

---

## Project reference

HireNestOS is a multi-tenant staffing and recruitment operating system built for **HireNest Workforce**. It connects four core portals under a unified, row-level-secured Supabase database and deterministic RPC contract:

1. **HireNest HQ (`admin`, `recruiter`)** — Full pipeline control, organization & user approval governance, requirement assignments, deterministic matching overrides, vendor SLA & tier scorecards, feedback moderation, dispute resolution, and platform configuration.
2. **Hiring Clients (`client_manager`, `client_member`)** — Requirement authoring, HQ-forwarded candidate review, interview scheduling & rubrics, structured vendor feedback, and white-labeled vendor summary.
3. **Staffing Vendors (`vendor_admin`, `vendor_recruiter`)** — Assigned job requirements, candidate pool management with SHA-256 resume deduplication, match-aware candidate submission, transparent 5-axis performance scorecards, and dispute filing.
4. **Direct Candidates (`candidate`)** — Matched job opportunities ("Jobs For Me"), open job browser ("Browse All Open Jobs"), self-service profile & resume upload, and real-time application status tracking.

---

## 1. Environment Variables & Setup

Create a `.env` file in the root directory based on `.env.example`:

```env
# Public Supabase Client Configuration (Safe for Browser — RLS Enforced)
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"

# Server-Only Gemini AI Key (NEVER expose as a VITE_ variable)
GEMINI_API_KEY="your-gemini-api-key"
```

### Important Security Rules
- Browser requests use the publishable key and user JWT under RLS. Existing privileged server operations require `SUPABASE_SERVICE_ROLE_KEY` in server-only environment configuration. Never expose it through `VITE_` variables or commit it.
- **Never** prefix `GEMINI_API_KEY` with `VITE_`. It is accessed exclusively inside `server.ts`.
- If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing, HireNestOS automatically renders the **Environment Setup Guide** screen with step-by-step instructions and zero AI features exposed before login.

---

## 2. How Roles Work & Creating the First Admin

Every user who signs up via Supabase Auth gets a `public.profiles` row created automatically by the database trigger with:
- Candidates: `role = 'candidate'`, `status = 'active'`.
- Vendor/client registrations: `role = 'pending'`, `status = 'pending_approval'`.

Users with `role = 'pending'` or `status = 'pending_approval'` are held at `/pending` (**Pending Approval Gate**) and cannot read or write any business tables until an Admin approves them via the audited registration review workflow.

### Bootstrapping the First Admin
Because registration approval requires an existing `admin`, promote your first account in the Supabase SQL Editor after signing up:

```sql
do $$
declare
  v_internal_org uuid;
begin
  select id into v_internal_org from public.organizations where type = 'internal' limit 1;
  if v_internal_org is null then
    insert into public.organizations (name, type, status, sla_tier)
    values ('HireNest Internal', 'internal', 'approved', 'enterprise')
    returning id into v_internal_org;
  end if;

  update public.profiles
  set
    role = 'admin',
    status = 'active',
    org_id = v_internal_org
  where email = 'your-admin-email@company.com';
end $$;
```

Once signed in as `admin`, you can:
1. Create client and vendor organizations in **Admin → Organizations** (`/admin/organizations`).
2. Approve and assign new signups to any role and organization in **Admin → Approvals** (`/admin/approvals`).

---

## 3. Complete Screen Map

### Public & Auth Gates
- `/signin` — Email + password sign-in (`SignInPage`)
- `/signup` — Full name, email, password, phone, and requested account type (`SignUpPage`)
- `/forgot-password` — Password reset link request (`ForgotPasswordPage`)
- `/reset-password` — Set new password (`UpdatePasswordPage`)
- `/pending` — Pending account approval holding screen (`PendingApprovalPage`)
- `/suspended` — Suspended user/organization holding screen (`SuspendedAccessPage`)

### Admin & HQ Recruiter (`/admin/*` and `/recruiter/*`)
- `/admin` & `/recruiter` — HQ Executive Dashboard (KPIs, pipeline funnel, open requirements SLA table, pending approvals queue, active vendor disputes)
- `/admin/approvals` — Pending User Approvals queue (`approve_user`, reject/suspend) *(Admin only)*
- `/admin/organizations` & `/admin/organizations/:id` — Client & Vendor Organizations directory and detail view *(Admin only)*
- `/admin/users` — All Users directory, role reassignment, and status controls *(Admin only)*
- `/admin/requirements` & `/recruiter/requirements` — Requirements list with filters and Create Requirement modal
- `/admin/requirements/:id` & `/recruiter/requirements/:id` — 5-Tab Requirement Workspace:
  1. **Overview** (JD, skills, compensation, status lifecycle, Close Requirement dialog)
  2. **Assigned Vendors** (`assign_requirement_to_vendor`, revoke assignment)
  3. **Matched Candidates** (`compute_match`, `recompute_matches`, `override_match`, `create_submission`, Match Evidence popover)
  4. **Submissions Pipeline** (Kanban & Table views, `transition_submission_stage` modal, Submission Detail Drawer)
  5. **Interviews** (`schedule_interview`, `submit_interview_feedback`)
- `/admin/candidates` & `/recruiter/candidates` — Global Candidate Pool (`check_candidate_duplicate`, SHA-256 resume upload)
- `/admin/candidates/:id` & `/recruiter/candidates/:id` — Candidate Detail, signed resume preview, submission history, duplicate flags
- `/admin/submissions` & `/recruiter/submissions` — Global Submissions Pipeline (Kanban + Table)
- `/admin/interviews` & `/recruiter/interviews` — Global Interviews & Rubric Feedback
- `/admin/duplicates` & `/recruiter/duplicates` — Candidate Duplicates Queue (`resolve_duplicate`: confirm, dismiss, merge)
- `/admin/vendors` & `/recruiter/vendors` — Vendor Performance Scorecards (`compute_vendor_score`, `compute_all_vendor_scores`)
- `/admin/feedback` — Client Feedback Moderation (`moderate_vendor_feedback`) *(Admin only)*
- `/admin/disputes` — Vendor Disputes Resolution (`resolve_vendor_dispute`) *(Admin only)*
- `/admin/settings` — Platform Configuration (`platform_config` weights, thresholds, SLA hours) *(Admin only)*
- `/admin/audit-logs` — System Audit Trail (`audit_logs`) *(Admin only)*

### Client Workspace (`/client/*`)
- `/client` — Client Dashboard (Active requirements, candidates awaiting review, upcoming interviews)
- `/client/requirements` — Client Requirements list & Create Requirement modal
- `/client/requirements/:id` — Client Requirement Detail:
  1. **Overview**
  2. **Forwarded Candidates** (Side-by-side comparison up to 3 candidates, Shortlist, Reject with mandatory reason, Schedule Interview, Request Offer)
  3. **Interviews** (`schedule_interview`, `submit_interview_feedback`)
  4. **Feedback** (`submit_vendor_feedback`)
- `/client/candidates` — Candidates To Review across all client requirements
- `/client/interviews` — Client Interviews & Feedback Rubrics
- `/client/vendors` — White-labeled Vendor Summary & Rating submission

### Vendor Workspace (`/vendor/*`)
- `/vendor` — Vendor Dashboard (5-Axis Vendor Score Card, assigned open requirements with SLA countdowns, recent submissions)
- `/vendor/requirements` — Assigned Requirements list
- `/vendor/requirements/:id` — Assigned Requirement Detail, Matched Vendor Candidates, and **"Submit Candidate to HQ"** modal (`check_candidate_duplicate` → `compute_match` → `create_submission`)
- `/vendor/candidates` & `/vendor/candidates/:id` — Vendor Candidate Pool (`vendor_id = profile.org_id`), SHA-256 resume upload
- `/vendor/submissions` — My Submissions Pipeline & Withdrawal (`withdraw_submission`)
- `/vendor/ratings` — My Rating & Disputes (5-axis breakdown, `VendorScoreCard`, approved client feedback, `raise_vendor_dispute`, `respond_to_vendor_feedback`)

### Candidate Workspace (`/candidate/*`)
- `/candidate` — Jobs For Me (Matched open requirements where `candidate_requirement_matches.candidate_id` matches the candidate)
- `/candidate/browse` — Browse All Open Jobs (All open public requirements with one-click `apply_to_requirement`)
- `/candidate/applications` — My Applications (Plain-English status timeline, interview details, withdraw application)
- `/candidate/profile` — My Profile & Resume (Contact details, skills tags, experience, notice period, availability, SHA-256 resume upload)

---

## 4. Gemini AI Guardrails & Architecture

Gemini AI is strictly an optional, server-guarded assistant (`/api/gemini/suggest` in `server.ts`) governed by 8 mandatory rules:

1. **Free-Tier Resilient & Non-Blocking**: If `GEMINI_API_KEY` is not set, quota is exhausted, or the service is unreachable, the UI displays *"AI assistant unavailable right now"* and every staffing workflow continues normally.
2. **Restricted to 5 Non-Decision Suggestion Tasks**:
   - Requirement form: **Suggest skills** from JD text (`suggest_skills`)
   - Requirement form: **Improve JD wording** (`improve_jd`)
   - Interview scheduling: **Suggest interview questions** from JD + candidate skills (`suggest_interview_questions`)
   - Interview feedback form: **Tidy my notes** — rewrites only text the user typed (`tidy_feedback_notes`)
   - Top-bar AI Drawer: **General staffing help chat** (`general_chat` — no candidate records sent)
   - *Never used for match scores, vendor scores, ratings, stage decisions, disputes, or candidate-facing screens.*
3. **Server-Side Supabase Token & Profile Verification**: Every `/api/gemini/suggest` request verifies the caller's Bearer JWT via `supabase.auth.getUser(token)` using a user-scoped anon client, then queries `public.profiles` and rejects (`403`) if `status !== 'active'`, `role === 'pending'`, or `role === 'candidate'`.
4. **Strict PII Scrubber & Payload Allowlist**: Candidate names, emails, phones, LinkedIn URLs, addresses, dates of birth, raw resume text, candidate summaries, `parsed_data`, and existing feedback records are never sent to Gemini.
5. **Explicit Review Labeling**: Every AI output is badged `"AI suggestion: review before use"` and requires the human user to review, edit, and explicitly click **Apply** or **Save**.

---

## 5. Known MVP Limitations

- **In-Memory Gemini Rate Limiter (20 req/hr)**: The per-user rate limit of 20 requests/hour on `/api/gemini/suggest` is stored in memory inside `server.ts`. It resets on server restart and is scoped per Node process instance.
- **Client-Side Notification Polling**: The notification bell polls `public.notifications` every 30 seconds via React Query rather than opening persistent WebSocket channels.
- **External delivery requires configuration**: trial reminder/extension emails use the existing outbox worker, and team invitations use the existing invitation services. Server-side Supabase administration and email-provider credentials are required; actual email delivery has not been verified. SMS/calendar integrations are outside this change.


See [Onboarding and controlled trial setup](docs/ONBOARDING_AND_TRIAL_SETUP.md) for migrations 31–35, field ownership, review controls and verification.
