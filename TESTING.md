# HireNestOS — End-to-End Manual Verification & Testing Script

This document walks through all **16 acceptance verification scenarios** across the **8 test personas** to validate role-based access control (RLS), deterministic RPC workflows, SHA-256 resume deduplication, stage transitions, and Gemini AI guardrails.

---

## 1. Test Personas Setup

Create the following 8 accounts via `/signup` (or Supabase Auth) and configure them as follows:

| # | Persona | Email | Role | Organization |
|---|---|---|---|---|
| 1 | **Admin (HQ)** | `admin@hirenest.test` | `admin` | *(None — HQ)* |
| 2 | **Recruiter (HQ)** | `recruiter@hirenest.test` | `recruiter` | *(None — HQ)* |
| 3 | **Client A Manager** | `manager@client-a.test` | `client_manager` | **Client Org A** (`type = 'client'`) |
| 4 | **Client A Member** | `member@client-a.test` | `client_member` | **Client Org A** (`type = 'client'`) |
| 5 | **Client B Manager** | `manager@client-b.test` | `client_manager` | **Client Org B** (`type = 'client'`) |
| 6 | **Vendor X Admin** | `admin@vendor-x.test` | `vendor_admin` | **Vendor Org X** (`type = 'vendor'`) |
| 7 | **Vendor Y Recruiter** | `recruiter@vendor-y.test` | `vendor_recruiter` | **Vendor Org Y** (`type = 'vendor'`) |
| 8 | **Direct Candidate** | `candidate@talent.test` | `candidate` | *(None — Direct)* |

### Bootstrap SQL for Persona 1 (`admin@hirenest.test`)
After signing up `admin@hirenest.test`, run this once in the Supabase SQL Editor:
```sql
update public.profiles
set role = 'admin', status = 'active', approved_at = now()
where email = 'admin@hirenest.test';
```

All other 7 personas can be approved directly inside the app via **Admin → Approvals** (`/admin/approvals`).

---

## 2. Step-by-Step Verification Checklist (16 Scenarios)

### Step 1: Pending User Gate
1. Sign up a new user via `/signup`.
2. Verify the user is automatically redirected to `/pending` (**Account Pending Approval**).
3. Attempt to navigate directly to `/admin`, `/client`, `/vendor`, or `/candidate`.
4. **Expected**: All routes redirect back to `/pending`. No business data is queried or displayed.

### Step 2: Admin Approves Organizations & Users
1. Sign in as **Persona 1 (`admin@hirenest.test`)**.
2. Go to `/admin/organizations` and create:
   - **Client Org A** (`type = 'client'`)
   - **Client Org B** (`type = 'client'`)
   - **Vendor Org X** (`type = 'vendor'`)
   - **Vendor Org Y** (`type = 'vendor'`)
3. Go to `/admin/approvals` and approve Personas 2–8 into their respective roles and organizations using the **Approve User** modal (`approve_user` RPC).
4. **Expected**: Each user disappears from the pending queue, and `public.profiles` reflects `status = 'active'`.

### Step 3: Client Creates & Publishes a Requirement
1. Sign in as **Persona 3 (`manager@client-a.test`)**.
2. Navigate to `/client/requirements` and click **New Requirement**.
3. Fill in title (e.g., `"Senior Platform Engineer"`), required skills (`["TypeScript", "PostgreSQL", "Kubernetes"]`), experience (`4` to `8` years), budget, and SLA hours (`48`).
4. Save as `open` (or transition `draft` → `open`).
5. **Expected**: Requirement appears in Client Org A's list with a generated `req_number`.

### Step 4: Cross-Tenant Client Isolation (RLS Check)
1. Sign in as **Persona 5 (`manager@client-b.test`)**.
2. Navigate to `/client/requirements`.
3. **Expected**: Client Org A's requirement is **not** visible. Attempting to visit `/client/requirements/<client-a-req-id>` shows "Requirement not found or access denied".

### Step 5: HQ Assigns Requirement to Vendor X Only
1. Sign in as **Persona 2 (`recruiter@hirenest.test`)** or **Persona 1 (`admin@hirenest.test`)**.
2. Open Client Org A's requirement at `/recruiter/requirements/:id` → **Assigned Vendors** tab.
3. Click **Assign Vendor**, select **Vendor Org X**, and submit (`assign_requirement_to_vendor` RPC).
4. **Expected**: Vendor Org X appears in the Assigned Vendors table with `status = 'active'`.

### Step 6: Cross-Tenant Vendor Assignment Isolation
1. Sign in as **Persona 6 (`admin@vendor-x.test`)** and visit `/vendor/requirements`.
   - **Expected**: Client Org A's requirement is visible with an active SLA countdown.
2. Sign in as **Persona 7 (`recruiter@vendor-y.test`)** and visit `/vendor/requirements`.
   - **Expected**: Client Org A's requirement is **not** visible to Vendor Org Y.

### Step 7: Vendor Uploads Candidate & SHA-256 Resume
1. Stay signed in as **Persona 6 (`admin@vendor-x.test`)**.
2. Go to `/vendor/candidates` and click **Add Candidate**.
3. Enter candidate details (skills overlapping the requirement: `TypeScript`, `PostgreSQL`, `Kubernetes`) and upload a PDF/DOCX resume (`<= 10 MB`).
4. **Expected**:
   - Browser computes SHA-256 hash (`resume_hash`).
   - File uploads to `resumes/{vendor_X_org_id}/{candidate_id}/{timestamp}_{safe_filename}`.
   - `check_candidate_duplicate` runs automatically.

### Step 8: Duplicate Detection Dialog
1. Still as **Persona 6**, click **Add Candidate** again and enter the **same email, phone, or resume file**.
2. **Expected**: `check_candidate_duplicate` returns matches (`>= 0.45` confidence) and triggers the **Duplicate Candidate Detected** dialog displaying confidence scores and match reasons.

### Step 9: Vendor Computes Match & Submits Candidate to HQ
1. Open the assigned requirement at `/vendor/requirements/:id`.
2. Click **Submit Candidate**, select the newly created candidate, and click **Preview Match & Check Duplicates**.
3. Verify the deterministic 6-pillar match breakdown (`compute_match` RPC) is displayed.
4. Click **Submit Candidate** (`create_submission` RPC).
5. **Expected**: Submission is created in stage `vendor_submitted` with a snapshot of the match score.

### Step 10: Client Visibility Gate Before `client_submitted`
1. Sign in as **Persona 3 (`manager@client-a.test`)** and open `/client/requirements/:id`.
2. **Expected**: The submission in `vendor_submitted` (or `hq_review` / `hq_shortlisted`) is **invisible** to the client.

### Step 11: HQ Screens & Forwards Candidate to Client (`client_submitted`)
1. Sign in as **Persona 2 (`recruiter@hirenest.test`)** and open `/recruiter/requirements/:id` → **Submissions Pipeline** tab.
2. Move the submission through valid transitions using `transition_submission_stage`:
   - `vendor_submitted` → `hq_review`
   - `hq_review` → `hq_shortlisted`
   - `hq_shortlisted` → `client_submitted`
3. Try an invalid jump (e.g., `vendor_submitted` → `offered`) or rejecting without a `rejection_reason`.
4. **Expected**: Invalid transitions are blocked by both UI validation and database constraints; once in `client_submitted`, the candidate becomes visible to Client Org A.

### Step 12: Client Reviews, Compares, & Schedules Interview
1. Sign in as **Persona 3 (`manager@client-a.test`)** and open `/client/requirements/:id` → **Forwarded Candidates** tab.
2. Verify the candidate is now visible. Select up to 3 candidates to open the **Side-by-Side Comparison** modal.
3. Click **Shortlist** (`client_submitted` → `client_shortlisted`), then click **Schedule Interview** (`schedule_interview` RPC).
4. **Expected**: Interview is created and submission stage advances to `interview_scheduled`.

### Step 13: Interview Rubric Submission (`submit_interview_feedback`)
1. As **Persona 3 (`manager@client-a.test`)** or **Persona 4 (`member@client-a.test`)**, go to `/client/interviews`.
2. Click **Submit Feedback** on the scheduled interview.
3. Complete the 4-dimension 1–5 star rubric (`technical`, `communication`, `problem_solving`, `culture_fit`), recommendation (`strong_hire` / `hire`), and notes.
4. **Expected**: `submit_interview_feedback` records the rubric and updates the interview status to `completed`.

### Step 14: Offer, Placement, & Requirement Auto-Fulfillment
1. Advance the submission through `interview_completed` → `offered` → `offer_accepted` → `placed` (providing `offered_ctc` and `joined_at`).
2. **Expected**: `Requirements.filled_count` increments; when `filled_count >= openings_count`, the requirement transitions to `fulfilled`.

### Step 15: Client Vendor Feedback, Admin Moderation, Vendor Score, & Dispute Flow
1. As **Persona 3 (`manager@client-a.test`)**, go to `/client/vendors` or `/client/requirements/:id` → **Feedback** tab and submit a vendor rating (`submit_vendor_feedback` RPC).
2. Sign in as **Persona 1 (`admin@hirenest.test`)**, go to `/admin/feedback`, and approve the feedback (`moderate_vendor_feedback` RPC).
3. Go to `/admin/vendors` and click **Recompute All Scores** (`compute_all_vendor_scores` RPC).
4. Sign in as **Persona 6 (`admin@vendor-x.test`)**, visit `/vendor/ratings`, inspect the 5-axis `VendorScoreCard`, and click **File Dispute** (`raise_vendor_dispute` RPC) or **Respond** (`respond_to_vendor_feedback` RPC).
5. Sign in as **Persona 1 (`admin@hirenest.test`)**, go to `/admin/disputes`, and resolve the dispute (`resolve_vendor_dispute` RPC with `recompute = true`).

### Step 16: Direct Candidate Self-Service Flow & Gemini Guardrail Verification
1. Sign in as **Persona 8 (`candidate@talent.test`)**.
2. Visit `/candidate/profile` to update skills (`TypeScript`, `PostgreSQL`) and upload a resume.
3. Visit `/candidate` (**Jobs For Me**) and `/candidate/browse` (**Browse All Open Jobs**).
4. Click **Apply Now** (`apply_to_requirement` RPC) on an open requirement.
5. Visit `/candidate/applications` to view the plain-English status timeline and test **Withdraw Application** (`withdraw_submission` RPC).
6. **Gemini Guardrail Checks**:
   - Verify the **AI Assistant** button in the top bar is **hidden** for `candidate` role users.
   - Verify calling `POST /api/gemini/suggest` without a valid Bearer token returns `401`, and calling it with a `candidate` or `pending` user token returns `403`.
   - Sign in as **Persona 2 (`recruiter@hirenest.test`)** and test the 4 allowed AI buttons (**Suggest skills**, **Improve JD wording**, **Suggest interview questions**, **Tidy my notes**) and verify every output carries the `"AI suggestion: review before use"` badge and never writes directly to the database.
