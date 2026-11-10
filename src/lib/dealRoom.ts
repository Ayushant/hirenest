import type { AppRole, SubmissionStage } from '../types/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealRoomStatus = 'active' | 'closed';
export type ParticipantType = 'admin' | 'recruiter' | 'client' | 'vendor';
export type ParticipantStatus = 'active' | 'removed';
export type MessageModerationStatus = 'clean' | 'flagged' | 'blocked';
export type ContactRequestStatus = 'pending' | 'approved' | 'rejected';
export type DealRoomAuditEventType =
  | 'room_created'
  | 'room_closed'
  | 'room_reopened'
  | 'participant_added'
  | 'participant_removed'
  | 'message_sent'
  | 'message_flagged'
  | 'message_blocked'
  | 'contact_request_submitted'
  | 'contact_request_approved'
  | 'contact_request_rejected'
  | 'admin_override';

export interface DealRoom {
  id: string;
  submissionId: string;
  requirementId: string;
  candidateId: string;
  candidateName: string;
  requirementTitle: string;
  clientOrgId: string;
  clientOrgName: string;
  vendorOrgId: string | null;
  vendorOrgName: string | null;
  assignedAdminId: string | null;
  assignedRecruiterId: string | null;
  status: DealRoomStatus;
  openedAt: string;
  closedAt: string | null;
  closureReason: string | null;
  createdBy: string;
  createdByName: string;
  currentStage: SubmissionStage;
}

export interface DealRoomParticipant {
  id: string;
  dealRoomId: string;
  userId: string;
  orgId: string | null;
  participantType: ParticipantType;
  displayLabel: string;
  status: ParticipantStatus;
  invitedAt: string;
  joinedAt: string | null;
  revokedAt: string | null;
}

export interface DealRoomMessage {
  id: string;
  dealRoomId: string;
  senderUserId: string;
  senderDisplayLabel: string;
  senderParticipantType: ParticipantType;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  moderationStatus: MessageModerationStatus;
  moderationNote: string | null;
  createdAt: string;
  editedAt: string | null;
}

export interface ContactDetailRequest {
  id: string;
  dealRoomId: string;
  requestedBy: string;
  requestedByName: string;
  requestedByType: ParticipantType;
  contactType: 'candidate_phone' | 'candidate_email' | 'client_contact' | 'vendor_contact';
  reason: string;
  status: ContactRequestStatus;
  approvedBy: string | null;
  approvedByName: string | null;
  disclosureChannel: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface DealRoomAuditEvent {
  id: string;
  dealRoomId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  eventType: DealRoomAuditEventType;
  metadata: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Masking display labels
// ---------------------------------------------------------------------------

export function getDisplayLabel(
  participantType: ParticipantType,
  _actualName?: string
): string {
  switch (participantType) {
    case 'admin':
      return 'HireNest Admin';
    case 'recruiter':
      return 'HireNest Recruiter';
    case 'client':
      return 'Client Representative';
    case 'vendor':
      return 'Vendor Representative';
  }
}

export function getParticipantTypeFromRole(role: AppRole): ParticipantType | null {
  switch (role) {
    case 'admin':
      return 'admin';
    case 'recruiter':
      return 'recruiter';
    case 'client_manager':
    case 'client_member':
      return 'client';
    case 'vendor_admin':
    case 'vendor_recruiter':
      return 'vendor';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Contact leakage detection
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const WHATSAPP_PATTERN = /whatsapp|wa\.me|chat\.whatsapp/gi;
const MEETING_LINK_PATTERN = /(?:zoom\.us|teams\.microsoft|meet\.google|webex|gotomeeting|calendly)\b/gi;

export interface LeakCheckResult {
  clean: boolean;
  blocked: boolean;
  flagged: boolean;
  detections: string[];
}

export function checkContactLeakage(text: string): LeakCheckResult {
  const detections: string[] = [];

  if (EMAIL_PATTERN.test(text)) {
    detections.push('email_address');
  }
  EMAIL_PATTERN.lastIndex = 0;

  if (PHONE_PATTERN.test(text)) {
    detections.push('phone_number');
  }
  PHONE_PATTERN.lastIndex = 0;

  if (WHATSAPP_PATTERN.test(text)) {
    detections.push('whatsapp_reference');
  }
  WHATSAPP_PATTERN.lastIndex = 0;

  if (MEETING_LINK_PATTERN.test(text)) {
    detections.push('external_meeting_link');
  }
  MEETING_LINK_PATTERN.lastIndex = 0;

  const hasHardBlock = detections.includes('email_address') || detections.includes('phone_number');
  const hasSoftFlag = detections.length > 0 && !hasHardBlock;

  return {
    clean: detections.length === 0,
    blocked: hasHardBlock,
    flagged: hasSoftFlag,
    detections,
  };
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

export function canAccessDealRoom(
  room: DealRoom,
  role: AppRole,
  orgId: string | null
): boolean {
  const isHq = role === 'admin' || role === 'recruiter';
  if (isHq) return true;

  const isClient = role === 'client_manager' || role === 'client_member';
  if (isClient && orgId === room.clientOrgId) return true;

  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';
  if (isVendor && orgId === room.vendorOrgId) return true;

  return false;
}

export function canModerate(role: AppRole): boolean {
  return role === 'admin';
}

export function canManageParticipants(role: AppRole): boolean {
  return role === 'admin';
}

export function canCloseRoom(role: AppRole): boolean {
  return role === 'admin';
}

export function canApproveContactRequest(role: AppRole): boolean {
  return role === 'admin';
}

// ---------------------------------------------------------------------------
// Deal Room auto-open trigger condition check
// ---------------------------------------------------------------------------

export function shouldAutoOpenDealRoom(
  currentStage: SubmissionStage,
  newStage: SubmissionStage,
  hasCompletedInterview: boolean
): boolean {
  const clientSelectedForNextRound =
    currentStage === 'interviewing' && newStage === 'interviewing';
  const advancedPastInterview =
    currentStage === 'interviewing' &&
    (newStage === 'offered' || newStage === 'offer_accepted' || newStage === 'onboarded');

  return hasCompletedInterview && (clientSelectedForNextRound || advancedPastInterview);
}

// ---------------------------------------------------------------------------
// Mask room data for external participants
// ---------------------------------------------------------------------------

export function maskRoomForRole(
  room: DealRoom,
  role: AppRole,
  _orgId: string | null
): Omit<DealRoom, 'clientOrgName' | 'vendorOrgName'> & {
  clientOrgName: string;
  vendorOrgName: string | null;
} {
  const isHq = role === 'admin' || role === 'recruiter';
  if (isHq) return room;

  const isClient = role === 'client_manager' || role === 'client_member';
  return {
    ...room,
    vendorOrgName: isClient ? null : room.vendorOrgName,
    clientOrgName: isClient ? room.clientOrgName : 'Client Organization',
    vendorOrgId: isClient ? '' : room.vendorOrgId,
    clientOrgId: isClient ? room.clientOrgId : '',
  };
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const DEAL_ROOM_STATUS_LABELS: Record<DealRoomStatus, string> = {
  active: 'Active',
  closed: 'Closed',
};

export const CONTACT_REQUEST_STATUS_LABELS: Record<ContactRequestStatus, string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const PARTICIPANT_TYPE_LABELS: Record<ParticipantType, string> = {
  admin: 'HireNest Admin',
  recruiter: 'HireNest Recruiter',
  client: 'Client Representative',
  vendor: 'Vendor Representative',
};

export const AUDIT_EVENT_LABELS: Record<DealRoomAuditEventType, string> = {
  room_created: 'Deal Room opened',
  room_closed: 'Deal Room closed',
  room_reopened: 'Deal Room reopened',
  participant_added: 'Participant added',
  participant_removed: 'Participant removed',
  message_sent: 'Message sent',
  message_flagged: 'Message flagged for review',
  message_blocked: 'Message blocked',
  contact_request_submitted: 'Contact detail request submitted',
  contact_request_approved: 'Contact detail request approved',
  contact_request_rejected: 'Contact detail request rejected',
  admin_override: 'Admin override action',
};
