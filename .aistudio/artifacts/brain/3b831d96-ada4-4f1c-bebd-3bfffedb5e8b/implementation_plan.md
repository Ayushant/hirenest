# HireNestOS — Requirement Sharing & WhatsApp Distribution Flow (Phase 1)

This focused implementation delivers the end-to-end **Requirement Sharing & Response Tracking Flow** so that every shared requirement originates from HireNestOS, can be distributed via **WhatsApp, Copy Link, or In-App Feed** to **Approved Vendors** or **Direct Candidates**, and tracks every recipient, share event, and inbound response (vendor submission or candidate application) through **Screening → Interview → Placement**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Per your direction and flowchart, we are scoping **Phase 1** strictly to the **7-Step Requirement Sharing & WhatsApp Distribution Flow** first, and deferring the remaining modules to subsequent phases once this workflow is live. Click **Proceed** to build Phase 1 now.

- **Confirmed Decision 1 — Focused Phase 1 Scope (7-Step Requirement Sharing Flow)**:
  - **Step 1 & 2 (Requirement Received & Approved)**: Requirements in HireNestOS are verified and opened (`status = 'open'`) before sharing.
  - **Step 3 ("Share Requirement" Modal & Audience Selector)**: Clicking **Share Requirement** on any Requirement row or Requirement detail page lets HQ (`admin` / `recruiter`) choose between two audience tracks:
    - **Vendor Sharing**: Select one or more approved vendor organizations (with SLA hours configuration).
    - **Direct Candidates**: Share eligible **FTE / onsite roles** with direct candidates or public candidate channels (automatically blocking ineligible C2C/C2H roles from direct candidate sharing).
  - **Step 4 (Three Sharing Methods — `WhatsApp · Copy Link · In-app Feed`)**:
    - **WhatsApp**: Generates a client-sanitized WhatsApp job message (Role title, Requirement ID, Mandatory skills, Experience range, Location & Work mode, Vendor/Candidate budget in LPA/LPM, and a tracked HireNestOS deep link) with a one-click **Send via WhatsApp (`wa.me`)** button and **Copy WhatsApp Message** button.
    - **Copy Link**: Copies a tracked, role-scoped HireNestOS requirement link (`?share_ref=<share_id>`) directly to the clipboard.
    - **In-app Feed**: Publishes directly to the selected Vendors' **Shared Requirements Feed** (`/vendor/requirements`) or the **Direct Candidate Job Feed** (`/candidate` & `/candidate/browse`).
  - **Step 5, 6 & 7 (Sharing Activity Ledger & Response Tracking)**:
    - Every share action records the exact **recipient** (Vendor org or Direct Candidate channel/recipient), **sharing method** (`whatsapp`, `copy_link`, `in_app`), **timestamp**, **shared by**, and **tracked link token** in HireNestOS.
    - When a **Vendor submits candidate profiles** or a **Direct Candidate applies** via the shared requirement, HireNestOS links the response back to the sharing activity and tracks status across **Applications · Submissions · Follow-ups · Screening → Interview → Placement**.

---

## 1. Overview & Core Concept

- **What It Does**: Implements the exact 7-step sharing workflow from your diagram:
  1. **Client Requirement Received**: New job requirement added to HireNestOS.
  2. **Requirement Approved**: Details checked and requirement opened (`open`) for sharing.
  3. **Click "Share Requirement"**: Choose target audience—**Vendor Sharing** (select approved vendors) or **Direct Candidates** (eligible FTE / onsite roles).
  4. **Choose Sharing Method**: Distribute via **WhatsApp**, **Copy Link**, or **In-app Feed**.
  5. **Requirement Shared**: Record recipient, channel, sanitized message snapshot, and sharing activity in HireNestOS.
  6. **HireNestOS Tracks Responses**: Track **Vendor Responses** (submitted candidate profiles) and **Candidate Responses** (direct applications), along with follow-up reminders and acknowledgment status.
  7. **Screening → Interview → Placement**: Connect every shared requirement's responses directly to the hiring pipeline and placement outcomes.
- **Expected Outcome**: Every shared requirement originates from HireNestOS, recipients respond through the platform, and the HQ team can see at a glance **what was shared, with whom, via which channel, and what happened next**.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Quick "Share Requirement" Action (Requirements Table & Requirement Detail View)**:
   - Every approved (`open`) requirement row in `/admin/requirements` and `/recruiter/requirements` (as well as the top action bar in Requirement Detail) includes a primary **Share Requirement** button.
   - If a requirement is still in `draft` or `pending_approval`, a one-click **Approve & Open for Sharing** action transitions it to `open` first.
2. **Unified "Share Requirement" Modal (Steps 3, 4 & 5)**:
   - **Audience Toggle**:
     - *Card A — Vendor Sharing (`Select approved vendors`)*: Multi-select list of approved vendors with search, SLA timer setting, and existing share status badges.
     - *Card B — Direct Candidates (`Eligible FTE / onsite roles`)*: Verifies that the requirement is an eligible FTE or onsite role, lets the user optionally enter recipient phone/name or broadcast to the Direct Candidate pool, and toggles public candidate visibility.
   - **Sharing Method Selector (`WhatsApp` · `Copy Link` · `In-app Feed`)**:
     - *WhatsApp Tab*: Live preview of the sanitized WhatsApp requirement message (client name masked so confidential client identity is never leaked), optional recipient WhatsApp number input, **Open in WhatsApp** action, and **Copy Message & Log Share** action.
     - *Copy Link Tab*: Generates a unique tracked HireNestOS URL with one-click copy and automatic share logging.
     - *In-app Feed Tab*: Immediately dispatches the requirement to the selected Vendors' in-app workspace or the Direct Candidate job board with in-app notification delivery.
3. **Sharing & Response Tracker Tab (Steps 5, 6 & 7)**:
   - Inside Requirement Detail (**Vendor Sharing & Distribution** tab) and a dedicated summary strip on the Requirements page, HQ sees:
     - **Sharing Activity Log**: Who shared the requirement, with which Vendor or Direct Candidate audience, via which method (`WhatsApp` / `Copy Link` / `In-app Feed`), and when.
     - **Response & Conversion Tracker**: Tracks recipient status (`Shared` → `Viewed / Acknowledged` → `Vendor Submitted Profile` / `Candidate Applied` → `Screening` → `Interview` → `Placement`) with a one-click **Log Follow-up** action.

### Visual Identity & Theme
- **Aesthetic Direction**: Clean HireNestOS Storm Slate interface with distinct, intuitive audience cards matching the visual clarity of your workflow diagram (Emerald tint for *Vendor Sharing*, Amber/Gold tint for *Direct Candidates*, and Royal Blue `#1F4CC4` primary actions).
- **Typography & Tabular Discipline**: `Plus Jakarta Sans` headings, `Public Sans` controls, and `JetBrains Mono` (`tabular-nums`) for share counts, SLA countdowns, response conversion counts, and timestamps.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Client-Sanitized WhatsApp Message Generation**
  - *Chosen Approach*: When sharing via WhatsApp, HireNestOS automatically generates a structured, professional recruitment message containing the Requirement Title, Reference Code, Mandatory Skills, Experience Range, Location/Work Mode, Budget (`LPA`/`LPM`), and a tracked HireNestOS portal link—while keeping the hiring client's legal name masked.
  - *Why*: Lets recruiters share requirements on WhatsApp in seconds while protecting client confidentiality and driving all vendor submissions and candidate applications back into HireNestOS.
- **Decision 2: Eligibility Guard on Direct Candidate Sharing**
  - *Chosen Approach*: When the user selects **Direct Candidates** in Step 3, HireNestOS checks that the requirement is an eligible **FTE / permanent** or **onsite** role. If a requirement is marked as vendor-only C2C/C2H, the modal clearly advises the recruiter to use **Vendor Sharing** or update the role's employment type.
  - *Why*: Enforces your Direct Candidate visibility rule right at the point of sharing.

---

## 4. Technical Architecture & Data Strategy

### 7-Step Sharing & Response Tracking Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                         1. CLIENT REQUIREMENT RECEIVED                                │
│                         2. REQUIREMENT APPROVED (OPEN)                                │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                      3. CLICK "SHARE REQUIREMENT" MODAL                               │
│                                                                                       │
│   ┌───────────────────────────────────┐       ┌───────────────────────────────────┐   │
│   │          VENDOR SHARING           │       │         DIRECT CANDIDATES         │   │
│   │     • Select approved vendors     │       │    • Eligible FTE / onsite roles  │   │
│   │     • Set SLA hours               │       │    • Enable candidate portal apply│   │
│   └─────────────────┬─────────────────┘       └─────────────────┬─────────────────┘   │
│                     └─────────────────────┬─────────────────────┘                     │
│                                           ▼                                           │
│                      4. CHOOSE SHARING METHOD                                         │
│         [ WhatsApp (Sanitized JD + Link) ] · [ Copy Link ] · [ In-app Feed ]          │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                      5. REQUIREMENT SHARED (ACTIVITY LEDGER)                          │
│     Records: requirement_id, audience_type (vendor | direct_candidate),               │
│              recipient_id/name, method (whatsapp | copy_link | in_app),               │
│              share_token, shared_by, shared_at, follow_up_status                      │
└─────────────────────┬───────────────────────────────────────────┬─────────────────────┘
                      ▼                                           ▼
        ┌───────────────────────────┐               ┌───────────────────────────┐
        │      VENDOR RESPONSE      │               │    CANDIDATE RESPONSE     │
        │ • Acknowledge requirement │               │ • Open shared job link    │
        │ • Submit candidate profile│               │ • Apply for requirement   │
        └─────────────┬─────────────┘               └─────────────┬─────────────┘
                      └─────────────────────┬─────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│           6. HIRENESTOS TRACKS RESPONSES (Applications · Submissions · Status)        │
│           7. SCREENING ──▶ INTERVIEW ──▶ PLACEMENT (Pipeline & Outcome Trail)         │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Interactive Handlers
- **Sharing Activity Ledger (`requirement_share_activities` + Supabase `requirement_vendor_shares` & `audit_logs`)**:
  - Stores every sharing event with `id`, `requirement_id`, `audience_type` (`'vendor' | 'direct_candidate'`), `recipient_org_id`, `recipient_label`, `recipient_contact`, `sharing_method` (`'whatsapp' | 'copy_link' | 'in_app'`), `share_link`, `message_preview`, `shared_by`, `shared_at`, `response_status` (`'shared' | 'acknowledged' | 'responded' | 'follow_up_sent'`), and linked submission/application counts.
- **Interactive Component Mapping**:
  - `ShareRequirementModal`: Implements Steps 3, 4, and 5 with interactive Vendor/Candidate audience cards, multi-vendor selection, WhatsApp message preview/editor, `wa.me` launcher, clipboard copy with toast confirmation, in-app feed publisher, and immediate persistence.
  - `RequirementSharingTracker`: Renders Steps 5, 6, and 7 inside Requirement Detail and the Requirements list—showing every share event, recipient response counts (Vendor submissions vs. Direct Candidate applications), follow-up tracker, and live progression through `Screening → Interview → Placement`.
