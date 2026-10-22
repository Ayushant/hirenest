# HireNestOS — CTO Architecture Audit, PRD Decision Log & Handover Report

**Prepared for**: HireNest Workforce & AIKIND Engineering  
**Baseline Reviewed**: Product Requirements Document & End-to-End Application Flows + Production Database Contract (21 Tables, 25 RPCs)

---

## 1. Architecture Audit & Canonical Data Governance

HireNestOS operates on a single, unified, row-level-secured database contract with zero duplicate collections, zero mock/static match arrays, and strict separation between **Potential Matches** (`candidate_matches`) and **Pipeline Transactions** (`submissions`).

| Canonical Domain | Single Source of Truth Table | Governed Write Path |
|---|---|---|
| **Organizations & Tenants** | `public.organizations` | Admin direct insert/update (`type`: `internal \| client \| vendor`, `status`: `pending_review \| approved \| suspended \| rejected`) |
| **Users & Roles** | `public.profiles` | Auto-created on signup; role/org assignment exclusively via `admin_assign_user` RPC |
| **Job Requirements** | `public.requirements` + `requirement_financials` + `requirement_margins` | Insert/update by `client_manager` (own org) & HQ; status transitions via `set_requirement_status`; vendor shares via `share_requirement_with_vendors` & `revoke_requirement_share` |
| **Candidate 360 Registry** | `public.candidates` + `public.candidate_contacts` | Created exclusively via `create_candidate` RPC after `check_candidate_duplicate`; contacts restricted from clients by RLS |
| **Explainable Match Index** | `public.candidate_matches` | Deterministic engine (`recompute_matches`) + HQ recruiter override (`override_match`). Recruiter override wins (`final_score = coalesce(override_score, computed_score)`) |
| **Submission Pipeline** | `public.submissions` + `public.submission_stage_history` | Created only by explicit `submit_candidate` (Vendor/HQ) or `apply_to_requirement` (Direct Candidate); stages mutated exclusively via `transition_submission` |
| **Interviews & Rubrics** | `public.interviews` + `public.interview_feedback` + `public.candidate_quality_feedback` | Scheduled via `schedule_interview`; status updated via `update_interview_status`; immutable feedback rows governed by `set_feedback_vendor_visibility`, `raise_rating_dispute`, and `resolve_rating_dispute` |
| **Audit & Outbox** | `public.audit_logs` + `public.event_outbox` + `public.notifications` | Immutable system audit trail; Admin read-only inspection with JSON diff viewer |

---

## 2. Section 7 — Decisions & Conflicts Resolution Log

All 7 architectural conflicts identified in **Section 7** of the PRD have been resolved and enforced in code:

| # | Decision / Conflict | Required Resolution | Implemented Architecture & Evidence |
|---|---|---|---|
| **1** | **AI Provider Policy** | Inventory every AI call site; ensure deterministic matching/scoring requires zero paid AI and degrades gracefully when AI is offline. | Matching (`candidate_matches`) and vendor scoring (`get_vendor_performance`) are **100% deterministic in PostgreSQL**. Optional AI assistance is isolated to a single server-side route (`POST /api/gemini/suggest` in `server.ts`) restricted to 5 non-decision text tasks (`suggest_skills`, `improve_jd`, `suggest_interview_questions`, `tidy_feedback_notes`, `general_chat`). `platform_settings.ai_provider` (`'ollama'`) and `ai_screening_enabled` are respected. When AI is unavailable or rate-limited, the UI displays *"AI assistant unavailable right now"* and never blocks any workflow. |
| **2** | **Direct-Candidate Schema** | Represent direct candidates without fake vendor values or weaker access controls. | Direct candidates register with `signup_intent = 'candidate'`. `create_candidate` sets `original_source = 'direct'`, `source_vendor_org_id = null`, and `owner_vendor_org_id = null`. When they apply via `apply_to_requirement`, `submissions.source = 'direct'` and `submissions.vendor_org_id = null`. The UI (`SourceBadge`, `HqCandidateDetailPage`, `HqSubmissionsPage`, `ClientCandidatesReviewPage`) explicitly renders **Direct Applicant** and never fabricates a vendor agency. |
| **3** | **Match Data Canonical Source** | Confirm actual `candidate_matches` implementation, schemas, and writers. | All two-way discovery (`Requirement → Candidates` via `fetchMatchesForRequirement` and `Candidate → Requirements` via `fetchMatchesForCandidate`) queries `public.candidate_matches` ordered by `final_score DESC` with server-side pagination (`.range(from, to)`). Full explainable evidence (`computed_score`, `skill_score`, `experience_score`, `override_score`, `matched_skills`, `unproven_skills`, `experience_note`, `evidence`, `engine_version`, `calculated_at`) is rendered in `MatchEvidencePanel`. |
| **4** | **AI Interview Capability** | Verify end-to-end question delivery, real response capture, separate communication vs JD-skill evaluation, and modality honesty. | `ScheduleInterviewModal` supports `round_type = 'ai_screening'` and `mode = 'ai_text'`. `ScreeningInterviewRunnerModal` (`src/components/domain/InterviewModals.tsx`) verifies candidate consent and declared modality (`ai_text | video | phone | in_person`), explicitly disclaims speech/prosody evaluation when `ai_text` is captured, records real candidate responses per question plus strengths/gaps/follow-ups, captures separate `skill_rating` (1–5) and `communication_rating` (1–5), and persists the report via `update_interview_status` + `interview_feedback`. |
| **5** | **Vision PRD & Documentation** | Maintain canonical documentation without overwriting contracts. | Added `/ARCHITECTURE_AUDIT_AND_PRD_HANDOVER.md`, `/README.md`, and `/TESTING.md`, plus an interactive **Architecture Decision Log & AI Inventory** tab inside `/admin/settings`. |
| **6** | **Repository Strategy** | Preserve clean modular boundaries (`src/types/db.ts`, `src/api/*`, `src/auth/*`, `src/components/domain/*`, `src/pages/*`). | All 21 tables and 25 RPCs are strictly typed in `src/types/db.ts`; domain queries are isolated in `src/api/{admin,requirements,candidates,submissions,interviews,notifications,ai}.ts`. |
| **7** | **Status Vocabulary** | Align UI labels with existing schema enums (`Potential Match` and `Direct Applied` as UI/source labels, not new enum values). | The database enum `submission_stage` (`applied`, `recruiter_review`, `client_review`, `interviewing`, `offered`, `offer_accepted`, `offer_declined`, `rejected`, `withdrawn`, `onboarded`) is preserved unchanged. In all match tables, unsubmitted matches are badged **`Potential Match (Not Applied)`**, direct applications are badged **`Direct Applied · <Stage>`**, and agency submissions are badged **`Vendor Submitted · <Stage>`**. |

---

## 3. Section 3 — Roles & Permissions Matrix Verification

| Role (`profiles.role`) | Route Prefix | Enforced Access & Capabilities |
|---|---|---|
| **Admin / HQ Admin (`admin`)** | `/admin/*` | Global visibility across clients, vendors, vendor candidates, direct candidates, requirements, matches, submissions, interviews, margins, feedback moderation (`set_feedback_vendor_visibility`), dispute resolution (`resolve_rating_dispute`), platform weights (`platform_settings`), user/org governance (`admin_assign_user`, `admin_link_candidate_account`), and `audit_logs`. |
| **Internal Recruiter / Operations (`recruiter`)** | `/recruiter/*` | Manage requirements, vendor shares (`share_requirement_with_vendors`), candidate pool, bidirectional matches (`recompute_matches`, `override_match`), submission stage transitions (`transition_submission`, `mark_submission_invalid`), duplicate flags (`resolve_duplicate_flag`), and interviews. Admin-only governance routes are hidden and blocked. |
| **Vendor Agency (`vendor_admin`, `vendor_recruiter`)** | `/vendor/*` | Manage own candidate pool (`owner_vendor_org_id = org_id`), view & acknowledge requirements shared with their vendor (`acknowledge_requirement`), bidirectional matching (`Requirement → Candidates` and `Candidate → Requirements`), submit candidates (`submit_candidate`), track/withdraw own submissions, view 3-axis vendor performance scorecard (`get_vendor_performance`), and raise disputes (`raise_rating_dispute`, `vendor_admin` only). Never sees client actual budgets or other vendors' candidates. |
| **Client Hiring Manager / Member (`client_manager`, `client_member`)** | `/client/*` | Manage own organization's requirements (`client_manager`), review candidates shared with client (`stage >= client_review`), compare up to 3 candidates side-by-side, schedule interviews, submit mandatory interview & candidate quality rubrics, and view optional white-labeled vendor summary. Contact details are masked (`"Contact details are managed by HireNest"`). |
| **Direct Candidate (`candidate`)** | `/candidate/*` | Register independently (`signup_intent = 'candidate'`), maintain own profile & SHA-256 resume (`candidates` & `candidate_contacts`), view matched open public jobs (`Jobs For Me`) and all open public jobs (`Browse All Open Jobs`), explicitly apply (`apply_to_requirement`), and track/withdraw own applications. |

---

## 4. Complete AI Call-Site Inventory

Every AI call in the application goes through `src/api/ai.ts` → `POST /api/gemini/suggest` in `server.ts`.

| # | Task Name | Frontend Call Site | Server Guardrails Applied |
|---|---|---|---|
| 1 | `suggest_skills` | `src/components/domain/RequirementFormModal.tsx` | Verifies Supabase Bearer JWT (`supabase.auth.getUser`) + active non-candidate `public.profiles` row; 20 req/hr rate limit; scrubs emails/phones/URLs; returns advisory skill tags badged `"AI suggestion: review before use"`. |
| 2 | `improve_jd` | `src/components/domain/RequirementFormModal.tsx` | Same auth + rate-limit + PII scrubber; rewrites JD draft text only; human must review and click **Apply Improved Wording**. |
| 3 | `suggest_interview_questions` | `src/components/domain/InterviewModals.tsx` (`ScheduleInterviewModal` & `ScreeningInterviewRunnerModal`) | Sends only structured `requirement_title`, `requirement_description`, `requirement_skills[]`, `candidate_skills[]`, `total_experience_years`, and `current_title`. Never sends candidate name, email, phone, or resume text. |
| 4 | `tidy_feedback_notes` | `src/components/domain/InterviewModals.tsx` (`InterviewFeedbackModal`) | Sends only the interviewer's own draft text typed into the form; never reads or modifies ratings or decisions. |
| 5 | `general_chat` | `src/components/domain/AiAssistantDrawer.tsx` | General staffing process help for non-candidate roles; sends zero candidate or database records. |

---

## 5. Module & End-to-End Flow Status Matrix

| Flow / Module | Status | Key Files & RPCs |
|---|---|---|
| **Flow A: Requirement → Candidates** | **Working (Production)** | `HqRequirementsPages.tsx`, `VendorWorkspacePages.tsx`, `MatchEvidence.tsx`, `fetchMatchesForRequirement`, `recompute_matches`, `override_match`, `submit_candidate` |
| **Flow B: Candidate → Requirements** | **Working (Production)** | `HqCandidatesAndPipelinePages.tsx` (`HqCandidateDetailPage`), `VendorWorkspacePages.tsx` (`VendorCandidateDetailPage`), `CandidateWorkspacePages.tsx` (`CandidateJobsForMePage`), `fetchMatchesForCandidate` |
| **Flow C: Vendor Candidate Lifecycle** | **Working (Production)** | `CandidateFormModal.tsx`, `DuplicateDialog.tsx`, `check_candidate_duplicate`, `create_candidate`, `submit_candidate`, `SubmissionDetailDrawer.tsx` |
| **Flow D: Direct Candidate Lifecycle** | **Working (Production)** | `AuthPages.tsx`, `CandidateWorkspacePages.tsx`, `apply_to_requirement`, `transition_submission` |
| **Flow E: First-Round Screening Interview** | **Working (Production)** | `InterviewModals.tsx` (`ScreeningInterviewRunnerModal`), `SubmissionDetailDrawer.tsx`, `schedule_interview`, `update_interview_status`, `interview_feedback` |
| **Flow F: Admin Oversight & Audit** | **Working (Production)** | `HqDashboardAndGov.tsx`, `HqRatingsAndSystemPages.tsx`, `admin_dashboard_summary`, `admin_assign_user`, `admin_link_candidate_account`, `resolve_duplicate_flag`, `audit_logs` |
| **Flow G: Vendor Rating & Dispute Governance** | **Working (Production)** | `VendorScoreCard.tsx`, `HqRatingsAndSystemPages.tsx`, `get_vendor_performance`, `admin_vendor_performance`, `set_feedback_vendor_visibility`, `raise_rating_dispute`, `resolve_rating_dispute` |

---

## 6. Deployment, Cutover & Rollback Checklist

### Pre-Deployment Verification
1. Verify environment variables are set:
   - `VITE_SUPABASE_URL` (publishable Supabase project URL)
   - `VITE_SUPABASE_ANON_KEY` (publishable anon key — **never** a service-role key)
   - `GEMINI_API_KEY` (server-only environment variable — **never** prefixed with `VITE_`)
2. Run static type checking and production bundle build:
   ```bash
   npm run lint
   npm run build
   ```
3. Start production server:
   ```bash
   npm start
   ```

### Rollback Plan
- Because HireNestOS performs **zero destructive schema migrations** and uses the existing canonical Supabase tables, RLS policies, and RPCs without alteration, rolling back an application release requires only redeploying the previous container image or git commit tag—no database rollback or data migration is required.
