import type {
  AppRole,
  EmploymentType,
  Submission,
  SubmissionStage,
} from '../types/db';
import type { SubmissionValidationRecord } from './recruiterValidation';
import { getSubmissionValidationLocal } from './recruiterValidation';
import { isRequirementVisibleToClientOrg, isRequirementSoftDeleted } from './enterpriseLifecycle';

// ============================================================================
// 1. Shared Offer & Onboarding Lifecycle Types
// ============================================================================

export type OfferLifecycleStage =
  | 'candidate_selected'
  | 'offer_issued'
  | 'offer_accepted'
  | 'offer_declined'
  | 'joining_scheduled'
  | 'onboarded'
  | 'did_not_join';

export type OfferStatus = 'none' | 'issued' | 'accepted' | 'declined' | 'withdrawn';

export type OnboardingStatus =
  | 'not_started'
  | 'pending_offer_response'
  | 'joining_scheduled'
  | 'onboarded'
  | 'did_not_join';

export type VendorOfferReportStatus =
  | 'none'
  | 'acceptance_confirmed'
  | 'availability_confirmed'
  | 'notice_buyout_needed'
  | 'withdrawal_risk'
  | 'joining_issue';

export type OfferActionType =
  | 'select_candidate'
  | 'issue_offer'
  | 'accept_offer'
  | 'decline_offer'
  | 'schedule_joining'
  | 'confirm_onboarded'
  | 'mark_did_not_join'
  | 'admin_verify_or_correct'
  | 'vendor_report_update';

export interface OfferOnboardingAuditEvent {
  id: string;
  submissionId: string;
  action: OfferActionType;
  fromLifecycleStage: OfferLifecycleStage | null;
  toLifecycleStage: OfferLifecycleStage;
  actorId: string;
  actorName: string;
  actorRole: AppRole;
  actorOrgId: string | null;
  timestamp: string;
  summary: string;
  notes: string | null;
  snapshot: {
    offerStatus: OfferStatus;
    onboardingStatus: OnboardingStatus;
    offerDate: string | null;
    offerResponseDate: string | null;
    expectedDoj: string | null;
    actualDoj: string | null;
  };
}

export interface OfferOnboardingRecord {
  submissionId: string;
  candidateId: string;
  requirementId: string;
  clientOrgId: string | null;
  vendorOrgId: string | null;
  lifecycleStage: OfferLifecycleStage;
  offerStatus: OfferStatus;
  onboardingStatus: OnboardingStatus;

  // Strictly separated lifecycle date fields (YYYY-MM-DD or ISO)
  offerDate: string | null;
  offerResponseDate: string | null;
  expectedDoj: string | null;
  actualDoj: string | null;

  // Offer commercial / letter metadata
  offeredCtc: string | null;
  offerReferenceCode: string | null;
  offerNotes: string | null;
  issuedByUserId: string | null;
  issuedByName: string | null;
  issuedByRole: AppRole | null;
  issuedAt: string | null;

  // Joining & Onboarding confirmation metadata (Client or Admin)
  joiningConfirmedByUserId: string | null;
  joiningConfirmedByName: string | null;
  joiningConfirmedByRole: AppRole | null;
  joiningConfirmedAt: string | null;
  joiningConfirmationNotes: string | null;
  didNotJoinReason: string | null;

  // Admin HQ verification & governance metadata
  adminVerified: boolean;
  adminVerifiedByUserId: string | null;
  adminVerifiedByName: string | null;
  adminVerifiedAt: string | null;
  adminCorrectionNotes: string | null;

  // Vendor coordination & availability reporting (read-safe, cannot override Client/Admin confirmation)
  vendorReportedStatus: VendorOfferReportStatus;
  vendorReportedExpectedDoj: string | null;
  vendorReportedNotes: string | null;
  vendorReportedByName: string | null;
  vendorReportedAt: string | null;

  updatedAt: string;
  auditTrail: OfferOnboardingAuditEvent[];
}

export const OFFER_LIFECYCLE_LABELS: Record<OfferLifecycleStage, string> = {
  candidate_selected: 'Candidate Selected',
  offer_issued: 'Offer Issued',
  offer_accepted: 'Offer Accepted',
  offer_declined: 'Offer Declined',
  joining_scheduled: 'Joining Scheduled',
  onboarded: 'Onboarded',
  did_not_join: 'Did Not Join',
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  none: 'No Formal Offer',
  issued: 'Pending Response',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  not_started: 'Not Started',
  pending_offer_response: 'Awaiting Offer Acceptance',
  joining_scheduled: 'Joining Scheduled (Pre-Boarding)',
  onboarded: 'Confirmed Onboarded',
  did_not_join: 'Did Not Join / Backed Out',
};

export const VENDOR_REPORT_STATUS_LABELS: Record<VendorOfferReportStatus, string> = {
  none: 'No Vendor Escalation',
  acceptance_confirmed: 'Candidate Acceptance Confirmed',
  availability_confirmed: 'DOJ & Notice Relieving Verified',
  notice_buyout_needed: 'Notice Buyout / Early Joining Requested',
  withdrawal_risk: 'Counter-Offer / Drop Risk Flagged',
  joining_issue: 'Joining Delay / Issue Reported',
};

// ============================================================================
// 2. Contract-Specific Candidate Contact Governance (C2C / C2H vs FTE)
// ============================================================================

export interface ContractContactPolicy {
  employmentType: EmploymentType;
  engagementCode: 'FTE' | 'C2C' | 'C2H' | 'PT';
  engagementLabel: string;
  isContractEngagement: boolean;
  hideAndOmitContactFieldsByDefault: boolean;
  requireCandidateEmailAndPhone: boolean;
  policyExplanation: string;
}

export function getContractContactPolicy(
  employmentType?: EmploymentType | string | null
): ContractContactPolicy {
  const normalized = (employmentType || 'full_time') as EmploymentType;
  if (normalized === 'contract') {
    return {
      employmentType: 'contract',
      engagementCode: 'C2C',
      engagementLabel: 'C2C (Contract-to-Contract)',
      isContractEngagement: true,
      hideAndOmitContactFieldsByDefault: true,
      requireCandidateEmailAndPhone: false,
      policyExplanation:
        'C2C Engagement Policy: Direct candidate email and phone fields are hidden and omitted by default to protect vendor/partner representation.',
    };
  }
  if (normalized === 'contract_to_hire') {
    return {
      employmentType: 'contract_to_hire',
      engagementCode: 'C2H',
      engagementLabel: 'C2H (Contract-to-Hire)',
      isContractEngagement: true,
      hideAndOmitContactFieldsByDefault: true,
      requireCandidateEmailAndPhone: false,
      policyExplanation:
        'C2H Engagement Policy: Direct candidate email and phone fields are hidden and omitted by default during contract staffing evaluation.',
    };
  }
  if (normalized === 'part_time') {
    return {
      employmentType: 'part_time',
      engagementCode: 'PT',
      engagementLabel: 'Part-Time',
      isContractEngagement: false,
      hideAndOmitContactFieldsByDefault: false,
      requireCandidateEmailAndPhone: true,
      policyExplanation:
        'Part-Time Direct Engagement: Candidate email and phone are captured and governed by RBAC/ABAC contact rules.',
    };
  }
  return {
    employmentType: 'full_time',
    engagementCode: 'FTE',
    engagementLabel: 'FTE (Full-Time Direct)',
    isContractEngagement: false,
    hideAndOmitContactFieldsByDefault: false,
    requireCandidateEmailAndPhone: true,
    policyExplanation:
      'FTE Engagement Policy: Candidate email and phone are required for direct full-time hiring and protected by RBAC/ABAC stage rules.',
  };
}

// ============================================================================
// 3. Mandatory Admin Recruiter Gate & Client Visibility Guard
// ============================================================================

const CLIENT_VISIBLE_DB_STAGES: SubmissionStage[] = [
  'client_review',
  'interviewing',
  'offered',
  'offer_accepted',
  'offer_declined',
  'onboarded',
];

/**
 * Enforces that no submission is visible to a client user unless:
 * 1. The requirement is active/not soft-deleted and mapped to the client's organization.
 * 2. The submission has passed the Admin Recruiter Validation Gate (explicitly approved & shared with client,
 *    or already in a post-approval client stage).
 */
export function isSubmissionApprovedForClientVisibility(
  submission: Submission,
  clientOrgId?: string | null,
  validationRecord?: SubmissionValidationRecord | null
): boolean {
  if (!submission || submission.is_valid === false) return false;

  // Check requirement tenant ownership if requirement object is embedded
  if (submission.requirements) {
    if (isRequirementSoftDeleted(submission.requirements)) return false;
    if (clientOrgId && !isRequirementVisibleToClientOrg(submission.requirements, clientOrgId)) {
      return false;
    }
  }

  const val = validationRecord ?? getSubmissionValidationLocal(submission.id);
  if (val) {
    if (
      val.validationStage === 'rejected' ||
      val.validationStage === 'hold_for_clarification' ||
      val.validationStage === 'validation_interview_scheduled' ||
      val.validationStage === 'interview_completed' ||
      val.validationStage === 'recruiter_review' ||
      val.validationStage === 'matched'
    ) {
      // Only allow if DB stage was already explicitly transitioned past client_review AND shared_with_client_at is set
      if (
        !CLIENT_VISIBLE_DB_STAGES.includes(submission.stage) ||
        !submission.shared_with_client_at
      ) {
        return false;
      }
    }
    if (
      val.validationStage === 'submitted_to_client' ||
      val.validationStage === 'approved_for_submission'
    ) {
      return CLIENT_VISIBLE_DB_STAGES.includes(submission.stage) || Boolean(submission.shared_with_client_at);
    }
  }

  // Fallback to DB stage + shared_with_client_at check
  return CLIENT_VISIBLE_DB_STAGES.includes(submission.stage);
}

// ============================================================================
// 4. Local Cache + Server Persistence Sync for Offer & Onboarding Records
// ============================================================================

const OFFER_ONBOARDING_STORAGE_KEY = 'hirenest_offer_onboarding_records_v1';

function loadLocalOfferOnboardingMap(): Record<string, OfferOnboardingRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(OFFER_ONBOARDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalOfferOnboardingMap(map: Record<string, OfferOnboardingRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OFFER_ONBOARDING_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Derives or retrieves the shared OfferOnboardingRecord for a given Submission.
 * Guarantees deterministic synchronization with the submission's existing DB stage
 * while preserving separate offerDate, offerResponseDate, expectedDoj, and actualDoj.
 */
export function getOrBuildOfferOnboardingRecord(
  submission: Submission,
  existingMap?: Record<string, OfferOnboardingRecord>
): OfferOnboardingRecord {
  const map = existingMap ?? loadLocalOfferOnboardingMap();
  const saved = map[submission.id];

  const clientOrgId = submission.requirements?.client_org_id || null;
  const vendorOrgId =
    submission.vendor_org_id || submission.candidates?.owner_vendor_org_id || null;

  if (saved) {
    // Keep relational IDs synced and reconcile if DB stage moved ahead externally
    const reconciled = reconcileRecordWithSubmissionStage(saved, submission);
    return {
      ...reconciled,
      candidateId: submission.candidate_id,
      requirementId: submission.requirement_id,
      clientOrgId: clientOrgId ?? reconciled.clientOrgId,
      vendorOrgId: vendorOrgId ?? reconciled.vendorOrgId,
    };
  }

  const extSub = submission as Submission & {
    offered_at?: string | null;
    onboarded_at?: string | null;
    offered_ctc?: string | number | null;
  };

  // Build initial record from submission state without falsely treating 'offered' as 'onboarded'
  const baseDate = (
    extSub.offered_at ||
    submission.updated_at ||
    submission.created_at ||
    new Date().toISOString()
  ).slice(0, 10);

  let lifecycleStage: OfferLifecycleStage = 'candidate_selected';
  let offerStatus: OfferStatus = 'none';
  let onboardingStatus: OnboardingStatus = 'not_started';
  let offerDate: string | null = extSub.offered_at ? extSub.offered_at.slice(0, 10) : null;
  let offerResponseDate: string | null = null;
  let expectedDoj: string | null = null;
  let actualDoj: string | null = extSub.onboarded_at
    ? extSub.onboarded_at.slice(0, 10)
    : null;

  if (submission.stage === 'offered') {
    lifecycleStage = 'offer_issued';
    offerStatus = 'issued';
    onboardingStatus = 'pending_offer_response';
    offerDate = offerDate || baseDate;
  } else if (submission.stage === 'offer_accepted') {
    lifecycleStage = 'offer_accepted';
    offerStatus = 'accepted';
    onboardingStatus = 'joining_scheduled';
    offerDate = offerDate || baseDate;
    offerResponseDate = baseDate;
  } else if (submission.stage === 'offer_declined') {
    lifecycleStage = 'offer_declined';
    offerStatus = 'declined';
    onboardingStatus = 'did_not_join';
    offerDate = offerDate || baseDate;
    offerResponseDate = baseDate;
  } else if (submission.stage === 'onboarded') {
    lifecycleStage = 'onboarded';
    offerStatus = 'accepted';
    onboardingStatus = 'onboarded';
    offerDate = offerDate || baseDate;
    offerResponseDate = offerResponseDate || baseDate;
    expectedDoj = expectedDoj || actualDoj || baseDate;
    actualDoj = actualDoj || baseDate;
  }

  return {
    submissionId: submission.id,
    candidateId: submission.candidate_id,
    requirementId: submission.requirement_id,
    clientOrgId,
    vendorOrgId,
    lifecycleStage,
    offerStatus,
    onboardingStatus,
    offerDate,
    offerResponseDate,
    expectedDoj,
    actualDoj,
    offeredCtc: extSub.offered_ctc ? String(extSub.offered_ctc) : null,
    offerReferenceCode: offerStatus !== 'none' ? `OFR-${submission.id.slice(0, 6).toUpperCase()}` : null,
    offerNotes: null,
    issuedByUserId: null,
    issuedByName: offerStatus !== 'none' ? 'Client / HireNest Desk' : null,
    issuedByRole: null,
    issuedAt: extSub.offered_at || null,
    joiningConfirmedByUserId: null,
    joiningConfirmedByName: submission.stage === 'onboarded' ? 'Confirmed Record' : null,
    joiningConfirmedByRole: null,
    joiningConfirmedAt: extSub.onboarded_at || null,
    joiningConfirmationNotes: null,
    didNotJoinReason: null,
    adminVerified: submission.stage === 'onboarded',
    adminVerifiedByUserId: null,
    adminVerifiedByName: submission.stage === 'onboarded' ? 'HireNest Admin' : null,
    adminVerifiedAt: extSub.onboarded_at || null,
    adminCorrectionNotes: null,
    vendorReportedStatus: 'none',
    vendorReportedExpectedDoj: null,
    vendorReportedNotes: null,
    vendorReportedByName: null,
    vendorReportedAt: null,
    updatedAt: submission.updated_at || new Date().toISOString(),
    auditTrail: [],
  };
}

function reconcileRecordWithSubmissionStage(
  record: OfferOnboardingRecord,
  submission: Submission
): OfferOnboardingRecord {
  const copy = { ...record };
  const extSub = submission as Submission & {
    offered_at?: string | null;
    onboarded_at?: string | null;
  };
  const fallbackDate = (
    extSub.offered_at ||
    submission.updated_at ||
    new Date().toISOString()
  ).slice(0, 10);

  if (submission.stage === 'offered' && copy.offerStatus === 'none') {
    copy.offerStatus = 'issued';
    copy.lifecycleStage = 'offer_issued';
    copy.onboardingStatus = 'pending_offer_response';
    copy.offerDate = copy.offerDate || fallbackDate;
  } else if (
    submission.stage === 'offer_accepted' &&
    (copy.offerStatus === 'none' || copy.offerStatus === 'issued')
  ) {
    copy.offerStatus = 'accepted';
    copy.offerDate = copy.offerDate || fallbackDate;
    copy.offerResponseDate = copy.offerResponseDate || fallbackDate;
    if (copy.lifecycleStage === 'candidate_selected' || copy.lifecycleStage === 'offer_issued') {
      copy.lifecycleStage = copy.expectedDoj ? 'joining_scheduled' : 'offer_accepted';
    }
    if (copy.onboardingStatus === 'not_started' || copy.onboardingStatus === 'pending_offer_response') {
      copy.onboardingStatus = copy.expectedDoj ? 'joining_scheduled' : 'pending_offer_response';
    }
  } else if (submission.stage === 'offer_declined' && copy.offerStatus !== 'declined') {
    copy.offerStatus = 'declined';
    copy.lifecycleStage = 'offer_declined';
    copy.onboardingStatus = 'did_not_join';
    copy.offerResponseDate = copy.offerResponseDate || fallbackDate;
  } else if (submission.stage === 'onboarded' && copy.onboardingStatus !== 'onboarded') {
    copy.offerStatus = 'accepted';
    copy.lifecycleStage = 'onboarded';
    copy.onboardingStatus = 'onboarded';
    copy.actualDoj =
      copy.actualDoj ||
      (extSub.onboarded_at ? extSub.onboarded_at.slice(0, 10) : fallbackDate);
  }
  return copy;
}

// ============================================================================
// 5. Role-Based Authorization for Offer & Onboarding Actions
// ============================================================================

export function canActorPerformOfferAction(
  role: AppRole | null | undefined,
  action: OfferActionType,
  record: OfferOnboardingRecord,
  actorOrgId?: string | null
): { allowed: boolean; reason?: string } {
  if (!role) return { allowed: false, reason: 'Unauthenticated user.' };

  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';

  if (isHq) {
    return { allowed: true };
  }

  if (isClient) {
    if (record.clientOrgId && actorOrgId && record.clientOrgId !== actorOrgId) {
      return {
        allowed: false,
        reason: 'Cross-tenant restriction: Client users can only manage offers for their own organization.',
      };
    }
    if (action === 'admin_verify_or_correct' || action === 'vendor_report_update') {
      return {
        allowed: false,
        reason: 'This action is reserved for Admin or Vendor roles respectively.',
      };
    }
    return { allowed: true };
  }

  if (isVendor) {
    if (record.vendorOrgId && actorOrgId && record.vendorOrgId !== actorOrgId) {
      return {
        allowed: false,
        reason: 'Vendor users can only view and report on their own submitted candidates.',
      };
    }
    if (action === 'vendor_report_update') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        'Vendors can report candidate acceptance, availability, and joining issues, but cannot directly override client-confirmed or Admin-verified offer/onboarding records.',
    };
  }

  return { allowed: false, reason: 'Role is not authorised to modify offer records.' };
}

// ============================================================================
// 6. State Transition Engine + Server API Sync
// ============================================================================

export interface ApplyOfferOnboardingActionInput {
  submission: Submission;
  action: OfferActionType;
  actorId: string;
  actorName: string;
  actorRole: AppRole;
  actorOrgId: string | null;
  offerDate?: string | null;
  offerResponseDate?: string | null;
  expectedDoj?: string | null;
  actualDoj?: string | null;
  offeredCtc?: string | null;
  offerReferenceCode?: string | null;
  notes?: string | null;
  vendorReportedStatus?: VendorOfferReportStatus;
  vendorReportedExpectedDoj?: string | null;
  adminVerified?: boolean;
}

/**
 * Maps an Offer & Onboarding action to the corresponding database `SubmissionStage`
 * if the underlying `submissions.stage` needs to advance.
 */
export function getTargetSubmissionStageForOfferAction(
  currentStage: SubmissionStage,
  action: OfferActionType
): SubmissionStage | null {
  switch (action) {
    case 'issue_offer':
      return currentStage !== 'offered' ? 'offered' : null;
    case 'accept_offer':
    case 'schedule_joining':
      return currentStage !== 'offer_accepted' && currentStage !== 'onboarded'
        ? 'offer_accepted'
        : null;
    case 'decline_offer':
      return currentStage !== 'offer_declined' ? 'offer_declined' : null;
    case 'confirm_onboarded':
      return currentStage !== 'onboarded' ? 'onboarded' : null;
    case 'mark_did_not_join':
      return currentStage !== 'offer_declined' && currentStage !== 'withdrawn'
        ? 'offer_declined'
        : null;
    default:
      return null;
  }
}

export async function fetchAllOfferOnboardingRecordsApi(): Promise<
  Record<string, OfferOnboardingRecord>
> {
  const localMap = loadLocalOfferOnboardingMap();
  try {
    const res = await fetch('/api/offers-onboarding');
    if (res.ok) {
      const data = await res.json();
      if (data && data.records && typeof data.records === 'object') {
        const merged = { ...localMap, ...data.records };
        saveLocalOfferOnboardingMap(merged);
        return merged;
      }
    }
  } catch {
    // Fallback to local map when offline
  }
  return localMap;
}

export async function applyOfferOnboardingAction(
  input: ApplyOfferOnboardingActionInput
): Promise<OfferOnboardingRecord> {
  const map = loadLocalOfferOnboardingMap();
  const current = getOrBuildOfferOnboardingRecord(input.submission, map);

  const perm = canActorPerformOfferAction(
    input.actorRole,
    input.action,
    current,
    input.actorOrgId
  );
  if (!perm.allowed) {
    throw new Error(perm.reason || 'Unauthorized offer/onboarding action.');
  }

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);
  const next: OfferOnboardingRecord = {
    ...current,
    updatedAt: nowIso,
    auditTrail: [...(current.auditTrail || [])],
  };

  const prevStage = current.lifecycleStage;
  let actionSummary = '';

  switch (input.action) {
    case 'select_candidate': {
      next.lifecycleStage = 'candidate_selected';
      actionSummary = 'Candidate selected for formal offer preparation.';
      break;
    }

    case 'issue_offer': {
      const effectiveOfferDate = (input.offerDate || next.offerDate || todayStr).slice(0, 10);
      next.lifecycleStage = 'offer_issued';
      next.offerStatus = 'issued';
      next.onboardingStatus = 'pending_offer_response';
      next.offerDate = effectiveOfferDate;
      // Crucial invariant: issuing an offer NEVER sets actualDoj or marks onboarded
      next.actualDoj = null;
      if (input.expectedDoj !== undefined) {
        next.expectedDoj = input.expectedDoj ? input.expectedDoj.slice(0, 10) : null;
      }
      if (input.offeredCtc !== undefined) next.offeredCtc = input.offeredCtc;
      next.offerReferenceCode =
        input.offerReferenceCode ||
        next.offerReferenceCode ||
        `OFR-${input.submission.id.slice(0, 6).toUpperCase()}`;
      if (input.notes) next.offerNotes = input.notes;
      next.issuedByUserId = input.actorId;
      next.issuedByName = input.actorName;
      next.issuedByRole = input.actorRole;
      next.issuedAt = nowIso;
      actionSummary = `Formal offer issued (Offer Date: ${effectiveOfferDate}${
        next.expectedDoj ? `, Proposed DOJ: ${next.expectedDoj}` : ''
      }).`;
      break;
    }

    case 'accept_offer': {
      const effectiveResponseDate = (
        input.offerResponseDate ||
        next.offerResponseDate ||
        todayStr
      ).slice(0, 10);
      next.offerDate = next.offerDate || todayStr;
      next.offerResponseDate = effectiveResponseDate;
      next.offerStatus = 'accepted';
      if (input.expectedDoj) {
        next.expectedDoj = input.expectedDoj.slice(0, 10);
      }
      next.lifecycleStage = next.expectedDoj ? 'joining_scheduled' : 'offer_accepted';
      next.onboardingStatus = next.expectedDoj
        ? 'joining_scheduled'
        : 'pending_offer_response';
      if (input.notes) next.offerNotes = input.notes;
      actionSummary = `Offer accepted on ${effectiveResponseDate}${
        next.expectedDoj ? ` with Expected DOJ ${next.expectedDoj}` : ''
      }.`;
      break;
    }

    case 'decline_offer': {
      const effectiveResponseDate = (
        input.offerResponseDate ||
        next.offerResponseDate ||
        todayStr
      ).slice(0, 10);
      next.offerDate = next.offerDate || todayStr;
      next.offerResponseDate = effectiveResponseDate;
      next.offerStatus = 'declined';
      next.lifecycleStage = 'offer_declined';
      next.onboardingStatus = 'did_not_join';
      next.actualDoj = null;
      if (input.notes) {
        next.offerNotes = input.notes;
        next.didNotJoinReason = input.notes;
      }
      actionSummary = `Offer declined on ${effectiveResponseDate}.`;
      break;
    }

    case 'schedule_joining': {
      const scheduledDoj = (input.expectedDoj || next.expectedDoj || '').slice(0, 10);
      if (!scheduledDoj) {
        throw new Error('Expected Date of Joining (Expected DOJ) is required to schedule joining.');
      }
      next.offerDate = next.offerDate || todayStr;
      next.offerResponseDate = next.offerResponseDate || todayStr;
      next.offerStatus = 'accepted';
      next.expectedDoj = scheduledDoj;
      // Crucial invariant: scheduling expected DOJ NEVER counts as actual onboarding
      next.actualDoj = null;
      next.lifecycleStage = 'joining_scheduled';
      next.onboardingStatus = 'joining_scheduled';
      if (input.notes) next.joiningConfirmationNotes = input.notes;
      actionSummary = `Joining scheduled for Expected DOJ ${scheduledDoj} (awaiting actual Day-1 joining confirmation).`;
      break;
    }

    case 'confirm_onboarded': {
      const confirmedActualDoj = (input.actualDoj || todayStr).slice(0, 10);
      if (!confirmedActualDoj) {
        throw new Error('Confirmed Actual Date of Joining (Actual DOJ) is required to mark a candidate Onboarded.');
      }
      next.offerDate = next.offerDate || confirmedActualDoj;
      next.offerResponseDate = next.offerResponseDate || confirmedActualDoj;
      next.expectedDoj = next.expectedDoj || confirmedActualDoj;
      next.actualDoj = confirmedActualDoj;
      next.offerStatus = 'accepted';
      next.lifecycleStage = 'onboarded';
      next.onboardingStatus = 'onboarded';
      next.joiningConfirmedByUserId = input.actorId;
      next.joiningConfirmedByName = input.actorName;
      next.joiningConfirmedByRole = input.actorRole;
      next.joiningConfirmedAt = nowIso;
      if (input.notes) next.joiningConfirmationNotes = input.notes;
      if (input.actorRole === 'admin' || input.actorRole === 'recruiter') {
        next.adminVerified = true;
        next.adminVerifiedByUserId = input.actorId;
        next.adminVerifiedByName = input.actorName;
        next.adminVerifiedAt = nowIso;
      }
      actionSummary = `Candidate joining confirmed! Actual DOJ: ${confirmedActualDoj} (Confirmed by ${input.actorName}).`;
      break;
    }

    case 'mark_did_not_join': {
      next.lifecycleStage = 'did_not_join';
      next.onboardingStatus = 'did_not_join';
      next.actualDoj = null;
      next.didNotJoinReason = input.notes || 'Candidate did not join on scheduled date.';
      actionSummary = `Marked as Did Not Join (${next.didNotJoinReason}).`;
      break;
    }

    case 'admin_verify_or_correct': {
      if (input.offerDate !== undefined) {
        next.offerDate = input.offerDate ? input.offerDate.slice(0, 10) : null;
      }
      if (input.offerResponseDate !== undefined) {
        next.offerResponseDate = input.offerResponseDate
          ? input.offerResponseDate.slice(0, 10)
          : null;
      }
      if (input.expectedDoj !== undefined) {
        next.expectedDoj = input.expectedDoj ? input.expectedDoj.slice(0, 10) : null;
      }
      if (input.actualDoj !== undefined) {
        next.actualDoj = input.actualDoj ? input.actualDoj.slice(0, 10) : null;
      }
      if (input.offeredCtc !== undefined) {
        next.offeredCtc = input.offeredCtc;
      }
      if (input.adminVerified !== undefined) {
        next.adminVerified = input.adminVerified;
      } else {
        next.adminVerified = true;
      }
      next.adminVerifiedByUserId = input.actorId;
      next.adminVerifiedByName = input.actorName;
      next.adminVerifiedAt = nowIso;
      if (input.notes) next.adminCorrectionNotes = input.notes;
      actionSummary = `Admin verification / record audit completed by ${input.actorName}.`;
      break;
    }

    case 'vendor_report_update': {
      next.vendorReportedStatus = input.vendorReportedStatus || 'availability_confirmed';
      if (input.vendorReportedExpectedDoj !== undefined) {
        next.vendorReportedExpectedDoj = input.vendorReportedExpectedDoj
          ? input.vendorReportedExpectedDoj.slice(0, 10)
          : null;
      }
      next.vendorReportedNotes = input.notes || null;
      next.vendorReportedByName = input.actorName;
      next.vendorReportedAt = nowIso;
      actionSummary = `Vendor status report logged (${
        VENDOR_REPORT_STATUS_LABELS[next.vendorReportedStatus]
      }) by ${input.actorName}.`;
      break;
    }
  }

  const auditEvent: OfferOnboardingAuditEvent = {
    id: `oo_aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    submissionId: input.submission.id,
    action: input.action,
    fromLifecycleStage: prevStage,
    toLifecycleStage: next.lifecycleStage,
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    actorOrgId: input.actorOrgId,
    timestamp: nowIso,
    summary: actionSummary,
    notes: input.notes || null,
    snapshot: {
      offerStatus: next.offerStatus,
      onboardingStatus: next.onboardingStatus,
      offerDate: next.offerDate,
      offerResponseDate: next.offerResponseDate,
      expectedDoj: next.expectedDoj,
      actualDoj: next.actualDoj,
    },
  };

  next.auditTrail = [auditEvent, ...next.auditTrail];

  // Save locally first for instant reactivity
  map[input.submission.id] = next;
  saveLocalOfferOnboardingMap(map);

  // Sync with backend enterpriseStore + DPDP / governance audit log
  try {
    await fetch('/api/offers-onboarding/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: next,
        auditEvent,
        actor: {
          id: input.actorId,
          name: input.actorName,
          role: input.actorRole,
          orgId: input.actorOrgId,
        },
      }),
    });
  } catch {
    // Offline fallback already saved to localStorage
  }

  return next;
}

// ============================================================================
// 7. Database-Driven Dashboard Metrics & Monthly Hiring/Onboarding Report
// ============================================================================

export interface OfferOnboardingDashboardMetrics {
  candidatesShared: number;
  offersIssued: number;
  offersAccepted: number;
  offersDeclined: number;
  pendingOffers: number;
  joiningScheduledCount: number;
  onboardedCandidates: number;
  didNotJoinCount: number;
  upcomingJoiningsCount: number;
  upcomingJoinings: Array<{
    submission: Submission;
    record: OfferOnboardingRecord;
    daysUntilJoining: number;
  }>;
}

export function computeOfferOnboardingMetrics(
  submissions: Submission[],
  recordsMap?: Record<string, OfferOnboardingRecord>
): OfferOnboardingDashboardMetrics {
  const map = recordsMap ?? loadLocalOfferOnboardingMap();
  const validSubs = submissions.filter((s) => s.is_valid !== false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${todayIso}T00:00:00`).getTime();

  let candidatesShared = 0;
  let offersIssued = 0;
  let offersAccepted = 0;
  let offersDeclined = 0;
  let pendingOffers = 0;
  let joiningScheduledCount = 0;
  let onboardedCandidates = 0;
  let didNotJoinCount = 0;
  const upcomingJoinings: Array<{
    submission: Submission;
    record: OfferOnboardingRecord;
    daysUntilJoining: number;
  }> = [];

  for (const sub of validSubs) {
    const rec = getOrBuildOfferOnboardingRecord(sub, map);

    // Count candidates shared with client
    if (
      CLIENT_VISIBLE_DB_STAGES.includes(sub.stage) ||
      Boolean(sub.shared_with_client_at) ||
      rec.offerStatus !== 'none'
    ) {
      candidatesShared += 1;
    }

    // Offers issued includes any formal offer ever issued (issued, accepted, declined)
    if (
      rec.offerStatus === 'issued' ||
      rec.offerStatus === 'accepted' ||
      rec.offerStatus === 'declined' ||
      Boolean(rec.offerDate)
    ) {
      offersIssued += 1;
    }

    if (rec.offerStatus === 'issued') {
      pendingOffers += 1;
    } else if (rec.offerStatus === 'accepted') {
      offersAccepted += 1;
    } else if (rec.offerStatus === 'declined') {
      offersDeclined += 1;
    }

    if (rec.onboardingStatus === 'joining_scheduled') {
      joiningScheduledCount += 1;
    }

    // Strict rule: Only confirmed actual joining counts as Onboarded
    if (rec.onboardingStatus === 'onboarded' && Boolean(rec.actualDoj)) {
      onboardedCandidates += 1;
    } else if (rec.onboardingStatus === 'did_not_join' || rec.lifecycleStage === 'did_not_join') {
      didNotJoinCount += 1;
    }

    // Upcoming joining dates: accepted/scheduled candidates not yet onboarded who have an expectedDoj
    if (
      rec.onboardingStatus !== 'onboarded' &&
      rec.onboardingStatus !== 'did_not_join' &&
      rec.offerStatus === 'accepted' &&
      rec.expectedDoj
    ) {
      const targetMs = new Date(`${rec.expectedDoj}T00:00:00`).getTime();
      const diffDays = Math.ceil((targetMs - todayMs) / (1000 * 60 * 60 * 24));
      upcomingJoinings.push({
        submission: sub,
        record: rec,
        daysUntilJoining: diffDays,
      });
    }
  }

  upcomingJoinings.sort((a, b) =>
    (a.record.expectedDoj || '').localeCompare(b.record.expectedDoj || '')
  );

  return {
    candidatesShared,
    offersIssued,
    offersAccepted,
    offersDeclined,
    pendingOffers,
    joiningScheduledCount,
    onboardedCandidates,
    didNotJoinCount,
    upcomingJoiningsCount: upcomingJoinings.length,
    upcomingJoinings,
  };
}

export interface MonthlyHiringReportRow {
  monthKey: string; // YYYY-MM
  monthLabel: string;
  offersIssued: number;
  offersAccepted: number;
  offersDeclined: number;
  pendingOffers: number;
  joiningScheduled: number;
  onboarded: number;
  didNotJoin: number;
  conversionRatePercent: number;
}

export function buildMonthlyHiringOnboardingReport(
  submissions: Submission[],
  recordsMap?: Record<string, OfferOnboardingRecord>
): MonthlyHiringReportRow[] {
  const map = recordsMap ?? loadLocalOfferOnboardingMap();
  const buckets = new Map<
    string,
    {
      offersIssued: number;
      offersAccepted: number;
      offersDeclined: number;
      pendingOffers: number;
      joiningScheduled: number;
      onboarded: number;
      didNotJoin: number;
    }
  >();

  const ensureBucket = (monthKey: string) => {
    if (!buckets.has(monthKey)) {
      buckets.set(monthKey, {
        offersIssued: 0,
        offersAccepted: 0,
        offersDeclined: 0,
        pendingOffers: 0,
        joiningScheduled: 0,
        onboarded: 0,
        didNotJoin: 0,
      });
    }
    return buckets.get(monthKey)!;
  };

  for (const sub of submissions.filter((s) => s.is_valid !== false)) {
    const rec = getOrBuildOfferOnboardingRecord(sub, map);
    const hasOfferActivity =
      rec.offerStatus !== 'none' ||
      rec.onboardingStatus === 'onboarded' ||
      Boolean(rec.offerDate) ||
      Boolean(rec.actualDoj);
    if (!hasOfferActivity) continue;

    const anchorDate =
      rec.actualDoj ||
      rec.offerDate ||
      rec.expectedDoj ||
      (sub.updated_at ? sub.updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const monthKey = anchorDate.slice(0, 7);
    const b = ensureBucket(monthKey);

    if (rec.offerStatus !== 'none' || Boolean(rec.offerDate)) {
      b.offersIssued += 1;
    }
    if (rec.offerStatus === 'accepted') b.offersAccepted += 1;
    if (rec.offerStatus === 'declined') b.offersDeclined += 1;
    if (rec.offerStatus === 'issued') b.pendingOffers += 1;
    if (rec.onboardingStatus === 'joining_scheduled') b.joiningScheduled += 1;
    if (rec.onboardingStatus === 'onboarded' && Boolean(rec.actualDoj)) {
      b.onboarded += 1;
    }
    if (rec.onboardingStatus === 'did_not_join') {
      b.didNotJoin += 1;
    }
  }

  // Always include current month so the report table is never empty
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  ensureBucket(currentMonthKey);

  return Array.from(buckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, stats]) => {
      const [year, month] = monthKey.split('-');
      const d = new Date(Number(year), Number(month) - 1, 1);
      const monthLabel = d.toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      });
      const conversionRatePercent =
        stats.offersIssued > 0
          ? Math.round((stats.onboarded / stats.offersIssued) * 100)
          : 0;
      return {
        monthKey,
        monthLabel,
        ...stats,
        conversionRatePercent,
      };
    });
}
