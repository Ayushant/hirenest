// ============================================================================
// AIKIND PRIVATE LIMITED × HIRENESTOS
// DPDP Act, 2023 & DPDP Rules, 2025 - Privacy & Data Governance Module
// ============================================================================

export type LegalBasisType =
  | 'consent'
  | 'voluntary_employment_use'
  | 'contractual_processor_instruction'
  | 'legal_obligation';

export interface PrivacyNoticeRecord {
  noticeId: string;
  version: string;
  locale: string;
  title: string;
  purposes: string[];
  legalBasesSupported: LegalBasisType[];
  effectiveAt: string;
  publishedBy: string;
  status: 'active' | 'draft' | 'superseded';
  contentSummary: string;
  fiduciaryEntity: string;
  grievanceOfficerContact: string;
}

export interface PrivacyAcknowledgementRecord {
  id: string;
  subjectRef: string;
  subjectName: string;
  tenantId: string;
  noticeId: string;
  version: string;
  purpose: string;
  processingBasis: LegalBasisType;
  action: 'acknowledged' | 'consented' | 'withdrawn' | 'preference_updated';
  communicationPreferences: {
    email: boolean;
    whatsapp: boolean;
    sms: boolean;
  };
  timestamp: string;
  captureSource: 'candidate_portal' | 'resume_upload' | 'vendor_submission' | 'privacy_center';
  evidenceRef: string;
}

export interface DataProcessingRecord {
  id: string;
  workflow: string;
  dataCategories: string[];
  source: string;
  purpose: string;
  responsibleEntity: 'HireNest Workforce Pvt Ltd' | 'Client Organisation' | 'AIKIND Private Limited';
  legalRole: 'Data Fiduciary' | 'Data Processor' | 'Technology / Service Provider';
  processingBasis: LegalBasisType;
  recipients: string[];
  systems: string[];
  retentionPolicyId: string;
  status: 'active' | 'review_required';
}

export type PrivacyRequestType =
  | 'access'
  | 'correction'
  | 'erasure'
  | 'grievance'
  | 'consent_withdrawal';

export interface PrivacyRequestRecord {
  requestId: string;
  tenantId: string;
  requesterRef: string;
  requesterName: string;
  requesterEmail: string;
  requestType: PrivacyRequestType;
  summary: string;
  receivedAt: string;
  slaDueAt: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  status: 'open' | 'in_review' | 'approved' | 'completed' | 'rejected';
  assignedTo: string;
  decision: string | null;
  resolvedAt: string | null;
  notes: string;
}

export interface RetentionPolicyRecord {
  policyId: string;
  dataCategory: string;
  purpose: string;
  trigger: string;
  durationRule: string;
  durationDays: number;
  legalHoldException: boolean;
  legalHoldReason: string | null;
  owner: string;
  version: string;
  status: 'active' | 'under_review';
}

export type DeletionSystemTarget =
  | 'postgresql_db'
  | 'supabase_storage'
  | 'search_indexes'
  | 'ai_caches'
  | 'operational_logs'
  | 'external_processors';

export interface DeletionJobRecord {
  jobId: string;
  tenantId: string;
  subjectRef: string;
  subjectLabel: string;
  scope: 'full_erasure' | 'resume_and_storage' | 'expired_retention_purge' | 'ai_cache_and_index';
  requestedAt: string;
  status: 'queued' | 'in_progress' | 'completed' | 'legal_hold_blocked' | 'failed_retry';
  targetSystems: Record<DeletionSystemTarget, 'pending' | 'purged' | 'retained_audit_minimal' | 'blocked'>;
  attempts: number;
  verifiedAt: string | null;
  exceptionReason: string | null;
}

export interface PrivacyIncidentRecord {
  incidentId: string;
  tenantId: string;
  title: string;
  detectedAt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedSystems: string[];
  affectedRecordsEstimate: number;
  assessment: string;
  containment: string;
  notificationStatus:
    | 'assessing'
    | 'not_required'
    | 'ready_for_dpb_and_principals'
    | 'notified'
    | 'closed';
  accountableOwner: string;
  closureEvidence: string | null;
}

export interface PrivacyAuditEventRecord {
  eventId: string;
  actorRef: string;
  actorRole: string;
  tenantId: string;
  action:
    | 'notice_published'
    | 'consent_recorded'
    | 'consent_withdrawn'
    | 'candidate_shared'
    | 'candidate_exported'
    | 'resume_accessed'
    | 'rights_request_updated'
    | 'deletion_job_executed'
    | 'incident_logged'
    | 'unauthorized_share_blocked';
  resourceType:
    | 'privacy_notice'
    | 'candidate_profile'
    | 'candidate_resume'
    | 'submission_packet'
    | 'privacy_request'
    | 'deletion_job'
    | 'privacy_incident';
  resourceRef: string;
  purpose: string;
  timestamp: string;
  outcome:
    | 'allowed'
    | 'denied_cross_tenant'
    | 'denied_consent_withdrawn'
    | 'denied_unverified_ownership'
    | 'masked_pii'
    | 'completed';
  correlationId: string;
}

export interface SubProcessorRecord {
  id: string;
  name: string;
  category: 'AI Gateway' | 'Database & Storage' | 'Messaging (WhatsApp)' | 'Email & Calendar';
  purpose: string;
  dataCategoriesShared: string[];
  piiScrubbingEnabled: boolean;
  modelTrainingOptOut: boolean;
  dpaStatus: 'executed' | 'in_review';
  region: string;
  deletionHookSupported: boolean;
}

export interface DpdpPhaseItem {
  phase: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  title: string;
  focus: string;
  keyDeliverables: string[];
  acceptanceCriteria: string;
  status: 'implemented' | 'active_enforcement';
  ownerSplit: string;
}

export interface PrivacyDashboardResponse {
  ok: boolean;
  serverNow: string;
  notices: PrivacyNoticeRecord[];
  acknowledgements: PrivacyAcknowledgementRecord[];
  processingRecords: DataProcessingRecord[];
  requests: PrivacyRequestRecord[];
  retentionPolicies: RetentionPolicyRecord[];
  deletionJobs: DeletionJobRecord[];
  incidents: PrivacyIncidentRecord[];
  auditEvents: PrivacyAuditEventRecord[];
  subProcessors: SubProcessorRecord[];
  roadmapPhases: DpdpPhaseItem[];
}

export const INITIAL_PRIVACY_NOTICES: PrivacyNoticeRecord[] = [
  {
    noticeId: 'HN-DPDP-NOTICE-2026-V2',
    version: '2.4.0',
    locale: 'en-IN',
    title: 'HireNestOS Candidate & Workforce Personal Data Protection Notice (DPDP Act, 2023)',
    purposes: [
      'Candidate profile creation, resume parsing & SHA-256 deduplication',
      '4-dimension JD skill matching & explainable recruiter screening',
      'Authorised submission to mapped hiring clients with human recruiter approval',
      'Interview scheduling, evaluation feedback & communication (Email / WhatsApp)',
    ],
    legalBasesSupported: [
      'consent',
      'voluntary_employment_use',
      'contractual_processor_instruction',
    ],
    effectiveAt: '2026-10-26T00:00:00.000Z',
    publishedBy: 'Data Protection & Governance Office (HireNest Workforce Pvt Ltd)',
    status: 'active',
    contentSummary:
      'Explains categories of personal data collected (resume, contact details, employment history, skills, interview evaluations), specific recruitment purposes, Data Fiduciary/Processor responsibilities, AI Gateway PII redaction safeguards, retention windows, and how Data Principals can exercise rights of access, correction, consent withdrawal, erasure, and grievance redressal.',
    fiduciaryEntity: 'HireNest Workforce Private Limited (Technical Partner: AIKIND Private Limited)',
    grievanceOfficerContact: 'dpo-grievance@hirenestworkforce.com',
  },
  {
    noticeId: 'HN-DPDP-VENDOR-2026-V1',
    version: '1.2.0',
    locale: 'en-IN',
    title: 'Vendor Agency Candidate Representation & Notice Attestation Charter',
    purposes: [
      'Vendor representation attestation & candidate notice delivery confirmation',
      'Ownership lock verification (30-day exclusivity window) & dispute resolution',
    ],
    legalBasesSupported: ['consent', 'contractual_processor_instruction'],
    effectiveAt: '2026-09-15T00:00:00.000Z',
    publishedBy: 'HQ Compliance & Vendor Operations',
    status: 'active',
    contentSummary:
      'Requires staffing vendors uploading candidate resumes to attest that the candidate has received the HireNestOS DPDP Notice and authorized submission to the specific requirement.',
    fiduciaryEntity: 'HireNest Workforce Private Limited',
    grievanceOfficerContact: 'vendor-privacy@hirenestworkforce.com',
  },
];

export const INITIAL_PROCESSING_RECORDS: DataProcessingRecord[] = [
  {
    id: 'ROPA-01',
    workflow: 'Candidate Portal & Resume Upload',
    dataCategories: [
      'Full Name, Email, Phone, LinkedIn URL',
      'Resume Document (PDF/DOCX) & SHA-256 Digest',
      'Employment & Education History, Skills',
    ],
    source: 'Direct Candidate Portal / Vendor Upload',
    purpose: 'Candidate onboarding, structured profile creation, and duplicate ownership check',
    responsibleEntity: 'HireNest Workforce Pvt Ltd',
    legalRole: 'Data Fiduciary',
    processingBasis: 'consent',
    recipients: ['Internal HQ Recruiters', 'Authorised Hiring Clients (on approved submission)'],
    systems: ['Supabase PostgreSQL', 'Supabase Storage (resumes bucket)'],
    retentionPolicyId: 'RET-CAND-ACTIVE',
    status: 'active',
  },
  {
    id: 'ROPA-02',
    workflow: 'AI Screening & 4-Dimension Matching',
    dataCategories: [
      'PII-Scrubbed Resume Text Snippet',
      'Extracted Atomic Skills, Match Scores & Explanations',
      'First-Round Advisory Screening Q&A',
    ],
    source: 'Candidate Profile & Requirement JD',
    purpose: 'Explainable JD-to-candidate matching and advisory recruiter screening assistance',
    responsibleEntity: 'AIKIND Private Limited',
    legalRole: 'Technology / Service Provider',
    processingBasis: 'voluntary_employment_use',
    recipients: ['HireNestOS Matching Engine', 'Server-Side Gemini AI Gateway (PII Redacted)'],
    systems: ['HireNestOS Express API Gateway', 'Supabase PostgreSQL'],
    retentionPolicyId: 'RET-AI-TELEMETRY',
    status: 'active',
  },
  {
    id: 'ROPA-03',
    workflow: 'Vendor / Client Candidate Collaboration',
    dataCategories: [
      'Candidate Submission Packet',
      'Ownership Evidence & Timestamp',
      'Client Shortlist & Interview Decisions',
    ],
    source: 'Vendor Agency / HQ Recruiter',
    purpose: 'Evaluating and presenting shortlisted candidates against specific client requirements',
    responsibleEntity: 'Client Organisation',
    legalRole: 'Data Processor',
    processingBasis: 'contractual_processor_instruction',
    recipients: ['Mapped Client Hiring Managers', 'Submitting Vendor Agency'],
    systems: ['Supabase PostgreSQL', 'Server-Side Sharing & Export Guard'],
    retentionPolicyId: 'RET-SUBMISSION-RECORD',
    status: 'active',
  },
  {
    id: 'ROPA-04',
    workflow: 'Recruiter & Admin Governance Operations',
    dataCategories: [
      'User Identity, Role & Organization Mapping',
      'Approval Decisions, Dispute Rulings & Audit Events',
    ],
    source: 'Authenticated Workspace Users',
    purpose: 'RBAC/ABAC access control, SLA monitoring, and statutory audit compliance',
    responsibleEntity: 'HireNest Workforce Pvt Ltd',
    legalRole: 'Data Fiduciary',
    processingBasis: 'legal_obligation',
    recipients: ['HQ Admin', 'Security & Audit Governance Officers'],
    systems: ['Supabase Auth', 'Enterprise Governance Store'],
    retentionPolicyId: 'RET-AUDIT-LEDGER',
    status: 'active',
  },
  {
    id: 'ROPA-05',
    workflow: 'WhatsApp, Email & Calendar Notifications',
    dataCategories: [
      'Contact Identifiers (Email, Mobile)',
      'Interview Slot Details & Meeting Links',
      'Channel Opt-In / Opt-Out Preferences',
    ],
    source: 'Candidate & Recruiter Scheduling Workflows',
    purpose: 'Interview invitations, SLA reminders, and application status updates',
    responsibleEntity: 'HireNest Workforce Pvt Ltd',
    legalRole: 'Data Fiduciary',
    processingBasis: 'consent',
    recipients: ['Transactional Email Relay', 'WhatsApp Business Gateway'],
    systems: ['Notification Dispatcher', 'Consent & Preference Registry'],
    retentionPolicyId: 'RET-COMM-LOGS',
    status: 'active',
  },
];

export const INITIAL_PRIVACY_ACKNOWLEDGEMENTS: PrivacyAcknowledgementRecord[] = [
  {
    id: 'ACK-2026-901',
    subjectRef: 'cand_aarav_mehta',
    subjectName: 'Aarav Mehta',
    tenantId: 'hirenest_hq',
    noticeId: 'HN-DPDP-NOTICE-2026-V2',
    version: '2.4.0',
    purpose: 'Candidate profile creation, AI matching & authorised client submission',
    processingBasis: 'consent',
    action: 'consented',
    communicationPreferences: { email: true, whatsapp: true, sms: false },
    timestamp: '2026-10-24T09:15:00.000Z',
    captureSource: 'candidate_portal',
    evidenceRef: 'sha256:8f3c91b2e4d10a77c5f',
  },
  {
    id: 'ACK-2026-902',
    subjectRef: 'cand_divya_nair',
    subjectName: 'Divya Nair',
    tenantId: 'hirenest_hq',
    noticeId: 'HN-DPDP-NOTICE-2026-V2',
    version: '2.4.0',
    purpose: 'Direct job application & interview scheduling',
    processingBasis: 'voluntary_employment_use',
    action: 'acknowledged',
    communicationPreferences: { email: true, whatsapp: false, sms: false },
    timestamp: '2026-10-25T11:40:00.000Z',
    captureSource: 'resume_upload',
    evidenceRef: 'sha256:4b2d88e19f02a631d9c',
  },
  {
    id: 'ACK-2026-903',
    subjectRef: 'cand_rohan_kulkarni',
    subjectName: 'Rohan Kulkarni',
    tenantId: 'vendor_apex_talent',
    noticeId: 'HN-DPDP-VENDOR-2026-V1',
    version: '1.2.0',
    purpose: 'Vendor agency submission for Senior Backend Architect',
    processingBasis: 'consent',
    action: 'withdrawn',
    communicationPreferences: { email: false, whatsapp: false, sms: false },
    timestamp: '2026-10-26T06:20:00.000Z',
    captureSource: 'privacy_center',
    evidenceRef: 'sha256:1e9f77a43c88b012e4a',
  },
];

export const INITIAL_PRIVACY_REQUESTS: PrivacyRequestRecord[] = [
  {
    requestId: 'DSR-2026-104',
    tenantId: 'hirenest_hq',
    requesterRef: 'cand_rohan_kulkarni',
    requesterName: 'Rohan Kulkarni',
    requesterEmail: 'rohan.kulkarni@example.in',
    requestType: 'erasure',
    summary:
      'Requesting erasure of resume PDF, contact details, and parsed profile from active sourcing pools following consent withdrawal.',
    receivedAt: '2026-10-25T14:10:00.000Z',
    slaDueAt: '2026-11-01T14:10:00.000Z',
    verificationStatus: 'verified',
    status: 'in_review',
    assignedTo: 'Ananya Sharma (HQ Privacy Desk)',
    decision: null,
    resolvedAt: null,
    notes: 'Identity verified via registered email OTP. Checking active legal/dispute holds before queuing multi-system deletion job.',
  },
  {
    requestId: 'DSR-2026-103',
    tenantId: 'hirenest_hq',
    requesterRef: 'cand_priya_iyer',
    requesterName: 'Priya Iyer',
    requesterEmail: 'priya.iyer@example.in',
    requestType: 'access',
    summary:
      'Requesting summary of personal data processed, match scores generated, and list of client organisations with whom profile was shared.',
    receivedAt: '2026-10-23T10:00:00.000Z',
    slaDueAt: '2026-10-30T10:00:00.000Z',
    verificationStatus: 'verified',
    status: 'completed',
    assignedTo: 'Vikram Desai (Compliance Lead)',
    decision: 'Provided structured JSON/PDF export of profile, 2 client submissions, and notice history.',
    resolvedAt: '2026-10-24T16:45:00.000Z',
    notes: 'Disclosed all recipient organisations as required under DPDP Act Section 11.',
  },
  {
    requestId: 'DSR-2026-105',
    tenantId: 'hirenest_hq',
    requesterRef: 'cand_karthik_reddy',
    requesterName: 'Karthik Reddy',
    requesterEmail: 'karthik.r@example.in',
    requestType: 'correction',
    summary:
      'Correction of total experience from 4.5 years to 6.0 years and updated notice period record.',
    receivedAt: '2026-10-26T04:30:00.000Z',
    slaDueAt: '2026-11-02T04:30:00.000Z',
    verificationStatus: 'verified',
    status: 'open',
    assignedTo: 'Ananya Sharma (HQ Privacy Desk)',
    decision: null,
    resolvedAt: null,
    notes: 'Propagating correction across candidate profile and recomputing active JD match scores.',
  },
];

export const INITIAL_RETENTION_POLICIES: RetentionPolicyRecord[] = [
  {
    policyId: 'RET-CAND-ACTIVE',
    dataCategory: 'Candidate Profiles & Uploaded Resumes',
    purpose: 'Active recruitment matching, career portal applications & talent pool sourcing',
    trigger: 'Last candidate interaction, application activity, or consent renewal',
    durationRule: '24 months from last active interaction (or immediate upon erasure/withdrawal)',
    durationDays: 730,
    legalHoldException: false,
    legalHoldReason: null,
    owner: 'HQ Talent Operations & DPO',
    version: '1.3',
    status: 'active',
  },
  {
    policyId: 'RET-SUBMISSION-RECORD',
    dataCategory: 'Client Submissions & Vendor Ownership Locks',
    purpose: 'Commercial agency fee attribution, 30-day ownership governance & client audit',
    trigger: 'Requirement closure or final submission stage disposition',
    durationRule: '36 months post requirement closure (statutory commercial dispute window)',
    durationDays: 1095,
    legalHoldException: true,
    legalHoldReason: 'Active vendor ownership dispute #DSP-2026-08 requires preserving submission timestamp metadata.',
    owner: 'HQ Legal & Commercial Governance',
    version: '2.0',
    status: 'active',
  },
  {
    policyId: 'RET-AI-TELEMETRY',
    dataCategory: 'AI Gateway Prompts & Screening Evaluations',
    purpose: 'Explainable AI auditability, rate-limit enforcement & quality assurance',
    trigger: 'AI Gateway execution timestamp',
    durationRule: 'Zero raw PII persisted in prompts; advisory evaluation artifacts retained 180 days',
    durationDays: 180,
    legalHoldException: false,
    legalHoldReason: null,
    owner: 'AIKIND Engineering & Security',
    version: '1.1',
    status: 'active',
  },
  {
    policyId: 'RET-AUDIT-LEDGER',
    dataCategory: 'Privacy & Security Audit Events (Minimal Non-PII)',
    purpose: 'DPDP Act accountability, breach investigation & regulatory evidence',
    trigger: 'Audit event creation',
    durationRule: '60 months immutable metadata retention (no raw resume text or contact PII)',
    durationDays: 1825,
    legalHoldException: false,
    legalHoldReason: null,
    owner: 'Chief Information Security Officer',
    version: '1.0',
    status: 'active',
  },
];

export const INITIAL_DELETION_JOBS: DeletionJobRecord[] = [
  {
    jobId: 'DEL-JOB-2026-401',
    tenantId: 'hirenest_hq',
    subjectRef: 'cand_suresh_menon_archived',
    subjectLabel: 'Subject #cand_suresh_menon (Erasure Request DSR-2026-098)',
    scope: 'full_erasure',
    requestedAt: '2026-10-22T08:00:00.000Z',
    status: 'completed',
    targetSystems: {
      postgresql_db: 'purged',
      supabase_storage: 'purged',
      search_indexes: 'purged',
      ai_caches: 'purged',
      operational_logs: 'retained_audit_minimal',
      external_processors: 'purged',
    },
    attempts: 1,
    verifiedAt: '2026-10-22T08:04:12.000Z',
    exceptionReason: null,
  },
  {
    jobId: 'DEL-JOB-2026-402',
    tenantId: 'vendor_apex_talent',
    subjectRef: 'cand_rohan_kulkarni',
    subjectLabel: 'Subject #cand_rohan_kulkarni (Consent Withdrawal DSR-2026-104)',
    scope: 'full_erasure',
    requestedAt: '2026-10-26T06:25:00.000Z',
    status: 'in_progress',
    targetSystems: {
      postgresql_db: 'pending',
      supabase_storage: 'pending',
      search_indexes: 'purged',
      ai_caches: 'purged',
      operational_logs: 'retained_audit_minimal',
      external_processors: 'pending',
    },
    attempts: 1,
    verifiedAt: null,
    exceptionReason: null,
  },
];

export const INITIAL_PRIVACY_INCIDENTS: PrivacyIncidentRecord[] = [
  {
    incidentId: 'INC-DPDP-2026-01',
    tenantId: 'vendor_global_staffing',
    title: 'Blocked Cross-Tenant Bulk Candidate Export Attempt by Unauthorised Vendor Role',
    detectedAt: '2026-10-24T17:22:10.000Z',
    severity: 'medium',
    affectedSystems: ['Server-Side Sharing & Export Guard', 'Vendor Candidate Pool API'],
    affectedRecordsEstimate: 0,
    assessment:
      'Vendor recruiter session attempted to export candidate contact records belonging to another tenant ID. Server-side ABAC Sharing Guard intercepted and denied the request with HTTP 403 before any PII left the database.',
    containment:
      'Request blocked automatically; session token rotated; vendor admin notified to review recruiter role permissions.',
    notificationStatus: 'not_required',
    accountableOwner: 'AIKIND Security Operations & HireNest DPO',
    closureEvidence: 'Audit Correlation ID corr_99281a7b confirms 0 bytes exfiltrated.',
  },
];

export const INITIAL_PRIVACY_AUDIT_EVENTS: PrivacyAuditEventRecord[] = [
  {
    eventId: 'evt_dpdp_8801',
    actorRef: 'usr_hq_admin_01',
    actorRole: 'admin',
    tenantId: 'hirenest_hq',
    action: 'notice_published',
    resourceType: 'privacy_notice',
    resourceRef: 'HN-DPDP-NOTICE-2026-V2',
    purpose: 'Publish DPDP Act 2023 Candidate Privacy Notice v2.4.0',
    timestamp: '2026-10-26T01:00:00.000Z',
    outcome: 'completed',
    correlationId: 'corr_dpdp_20261026_01',
  },
  {
    eventId: 'evt_dpdp_8802',
    actorRef: 'cand_rohan_kulkarni',
    actorRole: 'candidate',
    tenantId: 'vendor_apex_talent',
    action: 'consent_withdrawn',
    resourceType: 'candidate_profile',
    resourceRef: 'cand_rohan_kulkarni',
    purpose: 'Data Principal withdrew recruitment processing consent via Privacy Center',
    timestamp: '2026-10-26T06:20:00.000Z',
    outcome: 'completed',
    correlationId: 'corr_dpdp_20261026_02',
  },
  {
    eventId: 'evt_dpdp_8803',
    actorRef: 'usr_vendor_rec_09',
    actorRole: 'vendor_recruiter',
    tenantId: 'vendor_global_staffing',
    action: 'unauthorized_share_blocked',
    resourceType: 'submission_packet',
    resourceRef: 'cand_rohan_kulkarni',
    purpose: 'Attempted client submission after candidate consent withdrawal',
    timestamp: '2026-10-26T06:45:12.000Z',
    outcome: 'denied_consent_withdrawn',
    correlationId: 'corr_dpdp_20261026_03',
  },
  {
    eventId: 'evt_dpdp_8804',
    actorRef: 'usr_hq_recruiter_04',
    actorRole: 'recruiter',
    tenantId: 'hirenest_hq',
    action: 'candidate_shared',
    resourceType: 'submission_packet',
    resourceRef: 'sub_aarav_mehta_req_101',
    purpose: 'Authorised shortlist submission to mapped client organisation',
    timestamp: '2026-10-25T15:30:00.000Z',
    outcome: 'allowed',
    correlationId: 'corr_dpdp_20261025_09',
  },
];

export const SUB_PROCESSOR_INVENTORY: SubProcessorRecord[] = [
  {
    id: 'PROC-AI-GEMINI',
    name: 'Google Gemini API (via HireNestOS Server AI Gateway)',
    category: 'AI Gateway',
    purpose: 'Structured resume parsing, JD improvement, interview question suggestions & screening evaluation',
    dataCategoriesShared: ['PII-Redacted Resume Text', 'Job Description Skills', 'Screening Q&A Text'],
    piiScrubbingEnabled: true,
    modelTrainingOptOut: true,
    dpaStatus: 'executed',
    region: 'Asia-South1 / Global Enterprise Endpoint',
    deletionHookSupported: true,
  },
  {
    id: 'PROC-DB-SUPABASE',
    name: 'Supabase (Managed PostgreSQL & Object Storage)',
    category: 'Database & Storage',
    purpose: 'Primary system of record for tenants, profiles, candidates, requirements, submissions & resume files',
    dataCategoriesShared: ['All Core Recruitment Records', 'Encrypted Resume Files (PDF/DOCX)'],
    piiScrubbingEnabled: false,
    modelTrainingOptOut: true,
    dpaStatus: 'executed',
    region: 'ap-south-1 (Mumbai, India)',
    deletionHookSupported: true,
  },
  {
    id: 'PROC-MSG-WHATSAPP',
    name: 'WhatsApp Business Cloud API Gateway',
    category: 'Messaging (WhatsApp)',
    purpose: 'Opt-in candidate interview reminders and application stage notifications',
    dataCategoriesShared: ['Candidate Phone Number', 'Approved Notification Template Variables'],
    piiScrubbingEnabled: true,
    modelTrainingOptOut: true,
    dpaStatus: 'executed',
    region: 'India / Meta Cloud Gateway',
    deletionHookSupported: true,
  },
  {
    id: 'PROC-MAIL-SMTP',
    name: 'Enterprise Transactional Email & Calendar Relay',
    category: 'Email & Calendar',
    purpose: 'Interview calendar invites, SLA alerts, and DPDP grievance/rights correspondence',
    dataCategoriesShared: ['Recipient Email Address', 'Calendar Invite Metadata'],
    piiScrubbingEnabled: false,
    modelTrainingOptOut: true,
    dpaStatus: 'executed',
    region: 'ap-south-1 (India)',
    deletionHookSupported: true,
  },
];

export const DPDP_ROADMAP_PHASES: DpdpPhaseItem[] = [
  {
    phase: 'P0',
    title: 'Foundation & Data Inventory',
    focus: 'Confirm personal-data fields, tenant boundaries, processing purposes and legal roles',
    keyDeliverables: [
      'Data flow map & personal-data table/field inventory across 6 workflows',
      'Processor list (Supabase, Gemini AI Gateway, WhatsApp, Email/Calendar)',
      'Policy templates & Data Fiduciary / Data Processor role matrix',
    ],
    acceptanceCriteria: 'Every personal-data table/field has an owner, purpose and classification.',
    status: 'implemented',
    ownerSplit: 'AIKIND (Schema & Flow Inventory) + HireNest Workforce (Legal Role & Policy Sign-off)',
  },
  {
    phase: 'P1',
    title: 'Notice, Consent & Candidate Controls',
    focus: 'Make notice and consent capture visible and auditable across candidate touchpoints',
    keyDeliverables: [
      'Versioned privacyNotice registry (en-IN & multi-locale ready)',
      'Acknowledgement & consent log at resume upload and candidate onboarding',
      'Consent withdrawal & channel preference UI (Email / WhatsApp / SMS)',
    ],
    acceptanceCriteria: 'Candidate can view notice, grant/withdraw consent where applicable, and see status.',
    status: 'active_enforcement',
    ownerSplit: 'AIKIND (Notice UI, Consent Registry & API) + HireNest Workforce (Notice Copy & Counsel Review)',
  },
  {
    phase: 'P2',
    title: 'Access, Sharing & Audit Controls',
    focus: 'Harden cross-tenant boundaries, candidate sharing gates and audit evidence',
    keyDeliverables: [
      'Server-side candidate sharing & export guard with PII masking',
      'Download/export gate blocking cross-tenant or consent-withdrawn records',
      'Immutable minimal privacyAuditEvents ledger with correlationId',
    ],
    acceptanceCriteria: 'Unauthorised cross-tenant access or export is blocked and logged.',
    status: 'active_enforcement',
    ownerSplit: 'AIKIND (Server Guard, ABAC Enforcement & Audit Ledger) + HireNest Workforce (Sharing Governance Rules)',
  },
  {
    phase: 'P3',
    title: 'Rights, Grievance & Retention Engine',
    focus: 'Operationalise individual requests and data lifecycle rules',
    keyDeliverables: [
      'Rights & Grievance Desk (Access, Correction, Erasure, Grievance)',
      'Retention policy registry with legal/dispute hold exceptions',
      'Multi-system deletion job runner (PostgreSQL, Storage, Indexes, Caches, Logs)',
    ],
    acceptanceCriteria: 'Requests and deletions can be tracked end-to-end with verification evidence.',
    status: 'active_enforcement',
    ownerSplit: 'AIKIND (Erasure Engine & Desk Workflow) + HireNest Workforce (Grievance Officer & SLA Operations)',
  },
  {
    phase: 'P4',
    title: 'Incident Readiness & Processor Governance',
    focus: 'Prepare for security incidents, processor reviews and ongoing compliance audits',
    keyDeliverables: [
      'Incident & Breach Desk with DPB / Data Principal notification readiness',
      'Sub-processor registry with AI PII-scrubbing & training opt-out verification',
      'Executive Compliance Dashboard & exportable audit evidence packs',
    ],
    acceptanceCriteria: 'Incident drill completed and compliance dashboard available to leadership.',
    status: 'active_enforcement',
    ownerSplit: 'AIKIND (Incident Desk, AI Redaction & Security Controls) + HireNest Workforce (Incident Notification & Counsel)',
  },
];

// ============================================================================
// Client API Helpers for /api/privacy/*
// ============================================================================

export async function fetchPrivacyDashboard(params?: {
  tenantId?: string;
  role?: string;
  userId?: string;
}): Promise<PrivacyDashboardResponse> {
  const qs = new URLSearchParams();
  if (params?.tenantId) qs.set('tenantId', params.tenantId);
  const res = await fetch(`/api/privacy/dashboard?${qs.toString()}`, {
    headers: {
      'x-hirenest-role': params?.role || 'admin',
      'x-hirenest-user-id': params?.userId || 'workspace_user',
    },
  });
  if (!res.ok) {
    throw new Error('Failed to load DPDP Privacy & Data Governance dashboard');
  }
  return res.json();
}

export async function publishPrivacyNoticeApi(payload: {
  title: string;
  version: string;
  locale: string;
  purposes: string[];
  contentSummary: string;
  publishedBy?: string;
}): Promise<{ ok: boolean; notice: PrivacyNoticeRecord }> {
  const res = await fetch('/api/privacy/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not publish privacy notice');
  }
  return res.json();
}

export async function recordPrivacyAcknowledgementApi(payload: {
  subjectRef: string;
  subjectName: string;
  tenantId?: string;
  noticeId?: string;
  version?: string;
  purpose: string;
  processingBasis?: LegalBasisType;
  action: 'acknowledged' | 'consented' | 'withdrawn' | 'preference_updated';
  communicationPreferences?: { email: boolean; whatsapp: boolean; sms: boolean };
  captureSource?: 'candidate_portal' | 'resume_upload' | 'vendor_submission' | 'privacy_center';
}): Promise<{ ok: boolean; acknowledgement: PrivacyAcknowledgementRecord }> {
  const res = await fetch('/api/privacy/acknowledgements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not record consent/notice acknowledgement');
  }
  return res.json();
}

export async function createPrivacyRequestApi(payload: {
  tenantId?: string;
  requesterRef: string;
  requesterName: string;
  requesterEmail: string;
  requestType: PrivacyRequestType;
  summary: string;
}): Promise<{ ok: boolean; request: PrivacyRequestRecord }> {
  const res = await fetch('/api/privacy/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not create privacy request');
  }
  return res.json();
}

export async function updatePrivacyRequestApi(payload: {
  requestId: string;
  verificationStatus?: 'pending' | 'verified' | 'rejected';
  status?: 'open' | 'in_review' | 'approved' | 'completed' | 'rejected';
  assignedTo?: string;
  decision?: string;
  notes?: string;
  triggerDeletionJob?: boolean;
}): Promise<{ ok: boolean; request: PrivacyRequestRecord; deletionJob?: DeletionJobRecord }> {
  const res = await fetch('/api/privacy/requests/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not update privacy request');
  }
  return res.json();
}

export async function toggleRetentionLegalHoldApi(payload: {
  policyId: string;
  legalHoldException: boolean;
  legalHoldReason?: string;
}): Promise<{ ok: boolean; policy: RetentionPolicyRecord }> {
  const res = await fetch('/api/privacy/retention/policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not update retention policy');
  }
  return res.json();
}

export async function runDeletionJobApi(payload: {
  jobId?: string;
  subjectRef?: string;
  subjectLabel?: string;
  scope?: DeletionJobRecord['scope'];
  tenantId?: string;
}): Promise<{ ok: boolean; job: DeletionJobRecord }> {
  const res = await fetch('/api/privacy/deletion-jobs/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not execute deletion job');
  }
  return res.json();
}

export async function evaluateCandidateSharingGuardApi(payload: {
  actorRef: string;
  actorRole: string;
  callerTenantId: string;
  targetTenantId: string;
  candidateRef: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  requirementId: string;
  actionType: 'share_with_client' | 'export_csv' | 'download_resume';
  humanRecruiterApproved: boolean;
}): Promise<{
  allowed: boolean;
  outcome: PrivacyAuditEventRecord['outcome'];
  reason: string;
  maskedPayload: {
    candidateRef: string;
    candidateName: string;
    email: string;
    phone: string;
    contactMasked: boolean;
  };
  auditEvent: PrivacyAuditEventRecord;
}> {
  const res = await fetch('/api/privacy/sharing-guard/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function createOrUpdatePrivacyIncidentApi(payload: {
  incidentId?: string;
  tenantId?: string;
  title: string;
  severity: PrivacyIncidentRecord['severity'];
  affectedSystems: string[];
  affectedRecordsEstimate: number;
  assessment: string;
  containment: string;
  notificationStatus: PrivacyIncidentRecord['notificationStatus'];
  accountableOwner: string;
  closureEvidence?: string;
}): Promise<{ ok: boolean; incident: PrivacyIncidentRecord }> {
  const res = await fetch('/api/privacy/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not save privacy incident');
  }
  return res.json();
}
