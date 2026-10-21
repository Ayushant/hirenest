# HireNestOS — Enterprise Staffing Operating System

HireNestOS is a governed, multi-workspace enterprise staffing and workforce operating system connecting HireNest HQ (Admin & Recruiters), Hiring Clients, Staffing Vendors, and Direct Candidates across a unified recruitment, SLA, and two-way matching lifecycle. It pairs strict Supabase RLS and 25-RPC governance with an authenticated, PII-scrubbed, free-tier Gemini AI suggestion layer and a high-contrast light/dark enterprise slate interface.

## User Review & Critical Decisions

> [!IMPORTANT]
> This revised plan incorporates all nine mandatory Gemini guardrails and complete scope requirements before we begin building.

- **Confirmed Decision 1 — Strict Supabase Core (All 25 RPCs, Zero Mock Data)**: Supabase is the single source of truth for all data, scores, stages, and permissions. All 25 database RPCs are wired with exact parameter signatures. `override_match` and `recompute_matches` are strictly restricted to HQ (`admin` and `recruiter`).
- **Confirmed Decision 2 — Strict Unauthenticated Setup Gate**: When `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing, the app shows only the Supabase Environment Setup & Verification Guide. No AI features or mock workspaces are exposed on the setup screen or prior to login.
- **Confirmed Decision 3 — Governed, Free-Tier, PII-Free Gemini Suggestions**:
  1. **Free Tier & Non-Blocking Fallback**: Uses free-tier models (`gemini-3.8-flash` and `gemini-3.1-flash-lite`, with automatic server-side fallback to `gemini-flash-latest`). If Gemini is unavailable or quota is exhausted, the UI displays `"AI assistant unavailable right now"` and never blocks any recruitment workflow.
  2. **Authenticated Access Only**: Every `/api/gemini/*` call requires the user's Supabase Bearer access token, verified server-side via `supabase.auth.getUser(token)` using the anon key. Unauthenticated, `pending`, or `suspended` users are rejected (`401`/`403`).
  3. **Per-User Rate Limiting**: Enforces a strict server-side rate limit of **20 requests per hour per user ID**.
  4. **Zero PII Transmission**: Names, emails, phone numbers, LinkedIn URLs, street addresses, and dates of birth are stripped before any prompt leaves for Gemini. Only skills, experience years, job titles, JD text, and anonymised IDs are transmitted.
  5. **User-Scoped RLS Enforcement**: Whenever the server queries Supabase for AI context, it instantiates a per-request Supabase client bound to the caller's Bearer token (never a service-role key) so RLS guarantees the server only reads data the signed-in user can already see.
  6. **Advisory Only (Human-in-the-Loop)**: AI never writes to the database, never transitions stages, never alters scores or ratings, and never evaluates or decides disputes. Users review and edit AI drafts in standard form controls before clicking Save.
  7. **Explicit Labeling**: Every AI output is visibly badged with `"AI suggestion: review before use"`.
- **Confirmed Decision 4 — High-Contrast Light & Dark Enterprise Slate Theme**: Built with `Plus Jakarta Sans` + `Public Sans` + `JetBrains Mono` (`tabular-nums`), single-elevation 1px hairline surfaces, and clean typographic hierarchy.

---

## 1. Overview & Core Concept

- **What It Does**: Governs the full staffing lifecycle:
  `Source / registration → resume upload → profile → potential match → direct application OR vendor submission → recruiter review → client review → interviews (with ratings) → offer → accepted / declined → onboarded`
- **Two-Way Deterministic Discovery**:
  - *Requirement → Candidates*: Ranked eligible candidates from `candidate_matches` with matched/unproven skill evidence and HQ-only override/recompute controls.
  - *Candidate → Requirements*: Ranked relevant requirements from `candidate_matches` with skill gap evidence.
- **Target Workspaces**:
  - **HireNest HQ (`admin`, `recruiter` at `/admin`, `/recruiter`)**: Shared operational screens (Dashboard, Requirements, Candidate 360, Submissions, Interviews, Duplicates, Vendor Performance) plus Admin-only governance (Approvals, Organizations, Users, Requirement Margins, Feedback Moderation, Disputes, Platform Settings & Weights, Audit Log).
  - **Hiring Clients (`client_manager`, `client_member` at `/client`)**: Dashboard with red pending-feedback badge, Requirement authoring & internal budgets (`client_manager`), Candidates for review (no contact PII), Interviews & mandatory post-round feedback, 6-dimension Candidate Quality rating, and conditional Vendor Summary (`/client/vendors`).
  - **Vendor Agencies (`vendor_admin`, `vendor_recruiter` at `/vendor`)**: Dashboard with live SLA countdowns, Shared Requirements with `acknowledge_requirement`, Candidate Pool with SHA-256 duplicate detection, Evidence-first Candidate Submission, My Submissions, and 3-pillar Ratings & Performance with Dispute filing (`vendor_admin`).
  - **Direct Candidates (`candidate` at `/candidate`)**: Onboarding wizard, Jobs for Me (ranked potential matches with explicit `apply_to_requirement`), Browse All Open Jobs (`/candidate/browse`), My Applications timeline, and My Profile.
  - **Access Gates (`/pending`, `/suspended`)**: Dedicated holding screens for `pending_approval` and `suspended` accounts or unapproved organizations.

---

## 2. User Experience & Visual Design

### Complete Screen Map & Key User Flows
1. **Setup Gate & Auth Flows (`/signin`, `/signup`, `/forgot-password`, `/reset-password`, `/pending`, `/suspended`)**:
   - Missing env vars render the **Supabase Setup Screen** (no AI features shown).
   - Sign-up collects full name, email, password, `"I am a…"` (`candidate` | `vendor` | `client`), and company name (for vendor/client) passed via `options.data`.
   - Post-sign-in loads `public.profiles` and `public.organizations` to enforce role routing and session persistence with return-URL preservation.
2. **Global Workspace Shell (`AppShell`)**:
   - Collapsible left sidebar (drawer under $1024\text{px}$), top bar with role-scoped search, notifications bell (unread badge, mark read via `notifications.read_at`, deep in-app routing), org name indicator, theme toggle, and authenticated **AI Assistant** drawer trigger.
3. **HQ Workspace (`/admin/*`, `/recruiter/*`)**:
   - **Dashboard**: StatCards powered by `admin_dashboard_summary` linking directly to filtered views.
   - **Approvals (Admin)**: Review pending users (`requested_role`, `requested_company`), pick/create organization, and call `admin_assign_user` or suspend.
   - **Organizations (Admin)**: Clients / Vendors / Internal tabs; create/edit orgs, SLA tier (`standard` | `premium` | `enterprise`), status, plus detail view with users, requirements/candidates, and vendor performance.
   - **Users (Admin)**: Filter by role/org; update via `admin_assign_user`; link candidate accounts via `admin_link_candidate_account`.
   - **Requirements**: Server-paginated list with filters (client, status, public, shared vendor, `.ilike` title search) and 6-tab detail view:
     1. *Overview*: JD, skills, experience, vendor budget, client budget (`requirement_financials`), admin margin (`requirement_margins`).
     2. *Status Actions*: `set_requirement_status` and `set_requirement_public`.
     3. *Vendor Sharing*: `share_requirement_with_vendors`, `revoke_requirement_share`, SLA status badges (`On time`, `Late`, `Pending`, `Missed`).
     4. *Matches*: Ranked `candidate_matches`, HQ-only `override_match` and `recompute_matches`, and `submit_candidate`.
     5. *Pipeline*: Kanban board + Table view with `transition_submission`.
     6. *Activity*: `submission_stage_history` + `audit_logs`.
   - **Candidates (Candidate 360)**: Server-paginated list (contacts masked in list) and detail view showing `original_source`, `owner_vendor_org_id`, `created_by`, full contacts (HQ/owner/self only), 5-minute signed resume viewer (`createSignedUrl(path, 300)`), Matches tab, Applications & Submissions tab, Interviews & Ratings tab, and Admin Audit tab.
   - **Submissions**: Global pipeline table + detail drawer with stage timeline, allowed `transition_submission` actions, `mark_submission_invalid`, `schedule_interview`, feedback, and Phase 2 disabled card `"AI screening (coming soon, Ollama)"`.
   - **Interviews**: Scheduled/completed list, `update_interview_status`, and HQ `my_pending_feedback` queue.
   - **Duplicates & Ownership**: Open `duplicate_flags` with link to existing candidate; resolve via `resolve_duplicate_flag` (with optional admin ownership reassignment; never auto-merges).
   - **Vendor Performance**: `admin_vendor_performance` paginated table + 6-dimension quality bar breakdown drawer.
   - **Feedback Moderation (Admin)**: Review all `interview_feedback` and `candidate_quality_feedback`; toggle vendor visibility via `set_feedback_vendor_visibility` with explicit warning banner.
   - **Disputes (Admin)**: Side-by-side dispute and original feedback review; resolve via `resolve_rating_dispute` (`upheld` excludes from score, or `rejected` with note).
   - **Settings (Admin)**: Live-validated 100-sum weights (`timing_weight`, `quality_weight`, `compliance_weight`), `weights_approved` toggle with warning, `min_sample_size`, `default_submission_sla_hours`, `share_vendor_summary_with_clients`, and disabled `ai_screening_enabled` switch (`"Requires Ollama service, Phase 2"`).
   - **Audit Log (Admin)**: Paginated `audit_logs` table with table/action/actor/date filters and side-by-side JSON diff viewer.
4. **Client Workspace (`/client/*`)**:
   - **Dashboard**: Open requirements, `client_review` candidates, upcoming interviews, and persistent red badge/banner from `my_pending_feedback`.
   - **Requirements**: List + Create/Edit JD form (`client_manager`) with private internal budget (`requirement_financials`) and allowed status transitions (`draft→pending_approval`, `pending_approval→draft`, `open↔on_hold`, `draft/open/on_hold→closed`).
   - **Candidates for Review**: Shared submissions showing profile (`"Contact details are managed by HireNest"` and `"Resume available on request from HireNest"`), `SourceBadge`, `MatchEvidence`, stage actions (`client_review→interviewing/rejected`, `interviewing→offered/rejected`), and the 6-dimension **Rate Candidate Quality** form.
   - **Interviews**: Schedule round (`schedule_interview`), update status (`update_interview_status`), and submit mandatory **Client Interview Feedback** (5-segment `RatingInput` for skills, communication, overall + decision + feedback/evidence, with optional offer to transition submission to `rejected`).
   - **Vendor Summary (`/client/vendors`)**: Rendered when `platform_settings.share_vendor_summary_with_clients` is enabled, displaying overall vendor status from `get_vendor_performance`.
5. **Vendor Workspace (`/vendor/*`)**:
   - **Dashboard**: Unacknowledged shared requirements, live colour-coded SLA countdowns (`due_at − now`), submissions by stage, upcoming interviews, and vendor performance summary.
   - **Shared Requirements**: Detail with JD, `vendor_visible_budget`, SLA due time, `acknowledge_requirement` button, *My Matching Candidates* tab, and *My Submissions* tab.
   - **Candidate Pool**: Add/edit own candidates. Add flow computes SHA-256 in browser → `check_candidate_duplicate` → stops with ownership dialog if duplicate → `create_candidate` → uploads to `resumes/<candidate_id>/<ts>-<safe-name>` → updates `resume_path`.
   - **Submit Candidate & My Submissions**: Inspect match evidence before calling `submit_candidate`; view stage timeline, shared feedback, and `withdrawn` action.
   - **Ratings & Performance**: Three distinct score cards (*Timing*, *Quality*, *Compliance*) plus *Overall* from `get_vendor_performance`, rendering `null`/`not_enough_data` as `"Not enough data (n of min)"` and unapproved weights as `"Pending approval"`. Lists shared feedback with `raise_rating_dispute` button (`vendor_admin` only, min 20 chars).
6. **Direct Candidate Workspace (`/candidate/*`)**:
   - **Onboarding Wizard**: Runs when no candidate record exists (`check_candidate_duplicate` → `create_candidate` → resume upload, or friendly account-linking notice on duplicate).
   - **Jobs for Me (`/candidate/jobs`)**: Ranked open public jobs from `candidate_matches` with matched/unproven skill chips and `apply_to_requirement` confirmation.
   - **Browse All Open Jobs (`/candidate/browse`)**: Server-paginated open public jobs with search and filter controls.
   - **My Applications (`/candidate/applications`)**: Candidate-friendly stage timeline, scheduled interviews, and withdraw dialog.
   - **My Profile (`/candidate/profile`)**: Update allowed profile/contact fields and replace resume.

### Visual Identity & Theme
- **Aesthetic Direction**: Clean, human-engineered enterprise SaaS (Greenhouse / Linear standard) in Light and Dark mode.
- **Color System**:
  - Neutral slate surfaces (`slate-50`/`white` light, `slate-950`/`slate-900` dark) with `1px` hairline borders.
  - Primary brand accent: `indigo-600` (`#4F46E5`).
  - Semantic status pairings (always icon + text label, never colour alone): Emerald (`On time` / `Advance`), Amber (`Pending` / `Hold`), Red (`Late` / `Reject`).
- **Typography**: `Plus Jakarta Sans` headings, `Public Sans` 14px body, `JetBrains Mono` (`tabular-nums`) for all scores, SLA timers, counts, and budgets.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Strict Server-Side Guardrails for Gemini AI (`/api/gemini/*`)**
  - *Chosen Approach*: Every AI request passes the user's Supabase JWT to the Express backend, which verifies the session via `supabase.auth.getUser(token)`, enforces a 20 req/hr/user rate limit, strips all PII patterns (emails, phones, LinkedIn URLs, DOBs, candidate names), queries any needed context using a user-scoped anon Supabase client (respecting RLS), calls `gemini-3.8-flash` or `gemini-3.1-flash-lite` (with fallback to `gemini-flash-latest`), and returns text tagged `"AI suggestion: review before use"`.
  - *Why*: Guarantees zero PII leakage, zero privilege escalation, zero unauthenticated usage, and 100% workflow resilience when AI is offline or rate-limited.
- **Decision 2: All Pipeline & Governance Mutations via the 25 RPCs**
  - *Chosen Approach*: Direct `.insert()` / `.update()` calls are restricted strictly to the 11 allowed table rules in Section 5.3; every pipeline action, share, duplicate check, match override, feedback moderation, and dispute uses the 25 RPCs in Section 5.4.
  - *Why*: Ensures database triggers, audit logs, SLA timestamps, and role checks remain tamper-proof.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            HIRENESTOS CLIENT (React + Vite)                            │
│                                                                                        │
│  ┌──────────────────────┐   ┌───────────────────────────────────────────────────────┐  │
│  │  Setup & Auth Gate   │   │              AppShell Layout & Top Bar                │  │
│  │  • Env Var Check     │──▶│  • Role Sidebar (HQ / Client / Vendor / Candidate)    │  │
│  │  • AuthProvider      │   │  • Scoped Search • Notifications Bell (Mark Read)     │  │
│  │  • RequireRole       │   │  • Authenticated AI Suggestion Drawer (Post-Login)    │  │
│  └──────────────────────┘   └──────────────────────────┬────────────────────────────┘  │
│                                                        │                               │
│       ┌───────────────────┬───────────────────┬────────┴─────────┬──────────────┐      │
│       ▼                   ▼                   ▼                  ▼              ▼      │
│  ┌───────────┐      ┌───────────┐       ┌───────────┐      ┌───────────┐  ┌──────────┐ │
│  │ HQ Space  │      │  Client   │       │  Vendor   │      │ Candidate │  │ Advisory │ │
│  │ /admin    │      │  /client  │       │  /vendor  │      │/candidate │  │ AI Draft │ │
│  │/recruiter │      │ +/vendors │       │           │      │ +/browse  │  │ Controls │ │
│  └─────┬─────┘      └─────┬─────┘       └─────┬─────┘      └─────┬─────┘  └────┬─────┘ │
│        │                  │                   │                  │             │       │
│        └──────────────────┴─────────┬─────────┴──────────────────┘             │       │
│                                     ▼                                          ▼       │
│  ┌──────────────────────────────────────────────────────────────────┐  ┌─────────────┐ │
│  │       TanStack Query Domain API Layer (25 RPCs + 11 Tables)      │  │ /api/gemini │ │
│  │  • Bounded .range(from,to)  • SHA-256 Digest  • Error Mapper     │  │ + JWT Token │ │
│  └──────────────────────────────────┬───────────────────────────────┘  └──────┬──────┘ │
└─────────────────────────────────────┼─────────────────────────────────────────┼────────┘
                                      │                                         │
                                      ▼                                         ▼
┌──────────────────────────────────────────────────────────────────┐  ┌──────────────────┐
│                SUPABASE BACKEND (Source of Truth)                │  │  EXPRESS SERVER  │
│  • Auth & RLS Policies (profiles, organizations, requirements)   │◀─│  • Verify JWT    │
│  • All 25 Governed RPCs & 19 Public Tables                       │  │  • 20/hr Limit   │
│  • Private Storage Bucket (`resumes` via 300s Signed URLs)       │  │  • Strip All PII │
└──────────────────────────────────────────────────────────────────┘  │  • 3.8-flash /   │
                                                                      │    3.1-flash-lite│
                                                                      └──────────────────┘
```

### Complete 25-RPC Mapping
1. `admin_assign_user(p_user_id, p_role, p_org_id?, p_status?)` — Admin Approvals & Users screens
2. `set_requirement_status(p_requirement_id, p_status, p_reason?)` — HQ & Client Requirement detail
3. `set_requirement_public(p_requirement_id, p_is_public)` — HQ Requirement detail
4. `share_requirement_with_vendors(p_requirement_id, p_vendor_org_ids, p_sla_hours?)` — HQ Requirement Vendor Sharing tab
5. `revoke_requirement_share(p_requirement_id, p_vendor_org_id)` — HQ Requirement Vendor Sharing tab
6. `acknowledge_requirement(p_requirement_id)` — Vendor Shared Requirement detail
7. `check_candidate_duplicate(p_email?, p_phone?, p_resume_hash?)` — Candidate creation & onboarding wizards
8. `create_candidate(p_full_name, p_email?, p_phone?, p_linkedin_url?, p_current_title?, p_location?, p_total_experience_years?, p_skills?, p_summary?, p_resume_hash?)` — Vendor, HQ & Candidate creation flows
9. `submit_candidate(p_requirement_id, p_candidate_id, p_notes?)` — Vendor & HQ match/submission flows
10. `apply_to_requirement(p_requirement_id)` — Candidate Jobs for Me & Browse Open Jobs
11. `transition_submission(p_submission_id, p_to, p_reason?)` — HQ, Client, Vendor & Candidate stage transitions
12. `mark_submission_invalid(p_submission_id, p_reason)` — HQ Submission detail drawer
13. `schedule_interview(p_submission_id, p_round_type, p_scheduled_at, p_duration_minutes?, p_mode?, p_meeting_link?)` — HQ & Client interview scheduler
14. `update_interview_status(p_interview_id, p_status)` — HQ & Client Interviews views
15. `my_pending_feedback()` — Client & HQ Dashboard and Interviews pending-feedback queue
16. `set_feedback_vendor_visibility(p_kind, p_feedback_id, p_visible)` — Admin Feedback Moderation screen
17. `raise_rating_dispute(p_kind, p_feedback_id, p_reason)` — Vendor Admin Ratings & Performance screen
18. `resolve_rating_dispute(p_dispute_id, p_upheld, p_note)` — Admin Disputes screen
19. `override_match(p_requirement_id, p_candidate_id, p_score, p_reason)` — HQ-only (`admin`/`recruiter`) Requirement & Candidate Matches tab
20. `recompute_matches(p_requirement_id)` — HQ-only (`admin`/`recruiter`) Requirement Matches tab
21. `resolve_duplicate_flag(p_flag_id, p_note, p_new_owner_vendor_org_id?)` — HQ Duplicates & Ownership screen
22. `admin_link_candidate_account(p_candidate_id, p_user_id)` — Admin Users / Duplicates account linking modal
23. `get_vendor_performance(p_vendor_org_id)` — Vendor Ratings, Admin Org Detail, and Client Vendor Summary (`/client/vendors`)
24. `admin_vendor_performance(p_limit?, p_offset?)` — HQ Vendor Performance leaderboard
25. `admin_dashboard_summary()` — HQ Dashboard StatCards

### Deliverables Verification
- Complete working application across all 8 roles (`admin`, `recruiter`, `client_manager`, `client_member`, `vendor_admin`, `vendor_recruiter`, `candidate`, `pending`).
- Exact `src/types/db.ts` matching Section 5 enums, tables, and 25 RPCs.
- `README.md` documenting environment variables, role architecture, first-admin bootstrap, screen map, Gemini guardrails, and MVP boundaries.
- `TESTING.md` providing the step-by-step verification script across all 8 test personas and 16 acceptance criteria.
