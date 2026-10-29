import { formatRequirementBudgetWithSubtitle } from './format';
import { decomposeCompoundSkills } from './matchingEngine';
import type { Requirement, Submission } from '../types/db';

export type SharingAudienceType = 'vendor' | 'direct_candidate';
export type SharingMethodType = 'whatsapp' | 'copy_link' | 'in_app';
export type ShareResponseStatus =
  | 'shared'
  | 'acknowledged'
  | 'responded'
  | 'screening'
  | 'interview'
  | 'placement';

export interface RequirementShareActivity {
  id: string;
  requirementId: string;
  requirementTitle: string;
  audienceType: SharingAudienceType;
  recipientOrgId: string | null;
  recipientName: string;
  recipientContact: string | null;
  sharingMethod: SharingMethodType;
  shareToken: string;
  shareUrl: string;
  whatsappMessage: string;
  slaHours: number | null;
  sharedByName: string;
  sharedByRole: string;
  sharedAt: string;
  acknowledgedAt: string | null;
  respondedAt: string | null;
  responseCount: number;
  followUpCount: number;
  lastFollowUpAt: string | null;
  status: ShareResponseStatus;
  notes?: string | null;
}

const SHARING_LEDGER_STORAGE_KEY = 'hirenest_req_sharing_ledger_v1';
let memorySharingLedger: RequirementShareActivity[] = [];

function readBrowserSharingLedger(): RequirementShareActivity[] {
  if (typeof window === 'undefined' || !window.localStorage) return memorySharingLedger;
  try {
    const raw = window.localStorage.getItem(SHARING_LEDGER_STORAGE_KEY);
    if (!raw) return memorySharingLedger;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memorySharingLedger = parsed as RequirementShareActivity[];
      return memorySharingLedger;
    }
    return memorySharingLedger;
  } catch {
    return memorySharingLedger;
  }
}

function writeBrowserSharingLedger(items: RequirementShareActivity[]): void {
  memorySharingLedger = items;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SHARING_LEDGER_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Evaluates whether a requirement is eligible for Direct Candidate sharing
 * per the business rule: "Direct Candidates -> Eligible FTE / onsite roles".
 */
export function evaluateDirectCandidateShareEligibility(req: Requirement): {
  eligible: boolean;
  label: string;
  reason: string;
} {
  const isFte = req.employment_type === 'full_time';
  const isOnsiteContract =
    req.work_mode === 'onsite' &&
    (req.employment_type === 'contract' || req.employment_type === 'contract_to_hire');
  const isOnsiteOrHybridFte = isFte;

  if (isOnsiteOrHybridFte) {
    return {
      eligible: true,
      label: 'Eligible · FTE / Permanent Role',
      reason: 'Full-time permanent roles are eligible for Direct Candidate sharing and applications.',
    };
  }

  if (isOnsiteContract) {
    return {
      eligible: true,
      label: 'Eligible · Onsite Contract Role',
      reason: 'Onsite contract roles are eligible for Direct Candidates with confirmed availability.',
    };
  }

  return {
    eligible: false,
    label: 'Vendor-first Role (Remote Contract / C2H)',
    reason:
      'Direct Candidates primarily receive FTE or Onsite roles. You can share this with Approved Vendors or publish to Direct Candidates if approved.',
  };
}

/**
 * Builds a tracked HireNestOS link for a shared requirement so responses originate and are tracked in HireNestOS.
 */
export function buildTrackedRequirementShareUrl(params: {
  requirementId: string;
  audienceType: SharingAudienceType;
  shareToken: string;
}): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://hirenestos.app';

  const basePath =
    params.audienceType === 'vendor'
      ? `/vendor/requirements/${params.requirementId}`
      : `/candidate/browse`;

  const qs = new URLSearchParams({
    req: params.requirementId,
    audience: params.audienceType,
    share_ref: params.shareToken,
  });

  return `${origin}${basePath}?${qs.toString()}`;
}

/**
 * Builds a sanitized WhatsApp requirement message (never exposing confidential client identity)
 * formatted for either Vendor Partners or Direct Candidates.
 */
export function buildSanitizedWhatsAppMessage(params: {
  requirement: Requirement;
  audienceType: SharingAudienceType;
  recipientName?: string;
  shareUrl: string;
  slaHours?: number | null;
}): string {
  const { requirement, audienceType, recipientName, shareUrl, slaHours } = params;
  const shortCode = `HN-${requirement.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  const budgetInfo = formatRequirementBudgetWithSubtitle(requirement);
  const skillsList = decomposeCompoundSkills(requirement.skills || []);
  const topSkills = skillsList.length > 0 ? skillsList.slice(0, 8).join(', ') : 'See full JD in portal';
  const expRange = `${requirement.min_experience}–${requirement.max_experience} yrs`;
  const empLabel =
    requirement.employment_type === 'full_time'
      ? 'Full-Time (FTE)'
      : requirement.employment_type === 'contract_to_hire'
        ? 'Contract-to-Hire (C2H)'
        : 'Contract';
  const modeLabel =
    requirement.work_mode.charAt(0).toUpperCase() + requirement.work_mode.slice(1);
  const budgetLine =
    budgetInfo.formatted && budgetInfo.formatted !== '-'
      ? `${budgetInfo.formatted}${budgetInfo.subtitle ? ` (${budgetInfo.subtitle})` : ''}`
      : 'As per market standards';

  if (audienceType === 'vendor') {
    const greeting = recipientName?.trim()
      ? `Hello ${recipientName.trim()} Team,`
      : 'Hello Vendor Partner,';
    const effectiveSla = slaHours || requirement.submission_sla_hours || 48;

    return [
      `${greeting}`,
      ``,
      `📌 *New Requirement Shared on HireNestOS*`,
      `• *Role:* ${requirement.title}`,
      `• *Ref ID:* #${shortCode}`,
      `• *Client:* Verified Enterprise Client (Confidential · Managed by HireNestOS)`,
      `• *Engagement:* ${empLabel} · ${modeLabel}`,
      `• *Location:* ${requirement.location}`,
      `• *Experience:* ${expRange}`,
      `• *Openings:* ${requirement.openings}`,
      `• *Mandatory Skills:* ${topSkills}`,
      `• *Vendor Budget:* ${budgetLine}`,
      `• *Submission SLA:* Within ${effectiveSla} hours`,
      ``,
      `👉 *Acknowledge & Submit Candidate Profiles in HireNestOS:*`,
      `${shareUrl}`,
      ``,
      `_All candidate submissions and SLA statuses are tracked directly inside HireNestOS._`,
    ].join('\n');
  }

  const candGreeting = recipientName?.trim()
    ? `Hi ${recipientName.trim()},`
    : 'Hello,';

  return [
    `${candGreeting}`,
    ``,
    `🚀 *Hiring Opportunity via HireNestOS*`,
    `• *Role:* ${requirement.title} (#${shortCode})`,
    `• *Employment Type:* ${empLabel} (${modeLabel})`,
    `• *Location:* ${requirement.location}`,
    `• *Experience Required:* ${expRange}`,
    `• *Key Skills:* ${topSkills}`,
    `• *Compensation:* ${budgetLine}`,
    ``,
    `👉 *View Role Details & Apply Directly on HireNestOS:*`,
    `${shareUrl}`,
    ``,
    `_Apply via the link above to track your application, screening, and interview status in real time._`,
  ].join('\n');
}

/**
 * Builds a polite WhatsApp follow-up message for an already-shared requirement.
 */
export function buildWhatsAppFollowUpMessage(activity: RequirementShareActivity): string {
  const shortCode = `HN-${activity.requirementId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  if (activity.audienceType === 'vendor') {
    return [
      `Hello ${activity.recipientName},`,
      ``,
      `🔔 *Quick Follow-up on HireNestOS Requirement #${shortCode}*`,
      `• *Role:* ${activity.requirementTitle}`,
      ``,
      `Please acknowledge the requirement and submit matching candidate profiles via your tracked HireNestOS link:`,
      `${activity.shareUrl}`,
    ].join('\n');
  }

  return [
    `Hi ${activity.recipientName || 'there'},`,
    ``,
    `🔔 *Quick Follow-up: ${activity.requirementTitle} (#${shortCode})*`,
    `We wanted to check if you are available and interested in applying for this opportunity on HireNestOS:`,
    `${activity.shareUrl}`,
  ].join('\n');
}

/**
 * Formats a phone number for wa.me deep linking (strips non-digits; defaults 10-digit Indian numbers to +91).
 */
export function formatPhoneForWhatsAppUrl(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export async function fetchRequirementShareActivities(
  requirementId?: string
): Promise<RequirementShareActivity[]> {
  const local = readBrowserSharingLedger();

  try {
    const qs = requirementId ? `?requirementId=${encodeURIComponent(requirementId)}` : '';
    const res = await fetch(`/api/requirements/shares-ledger${qs}`);
    if (res.ok) {
      const data = await res.json();
      const serverItems: RequirementShareActivity[] = Array.isArray(data.activities)
        ? data.activities
        : [];
      const mergedMap = new Map<string, RequirementShareActivity>();
      for (const item of local) {
        mergedMap.set(item.id, item);
      }
      for (const sItem of serverItems) {
        const existing = mergedMap.get(sItem.id);
        if (!existing || sItem.followUpCount >= existing.followUpCount) {
          mergedMap.set(sItem.id, sItem);
        }
      }
      const allMerged = Array.from(mergedMap.values()).sort((a, b) =>
        b.sharedAt.localeCompare(a.sharedAt)
      );
      writeBrowserSharingLedger(allMerged);
      return requirementId
        ? allMerged.filter((a) => a.requirementId === requirementId)
        : allMerged;
    }
  } catch {
    // Fallback to local ledger
  }

  const sorted = [...local].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  return requirementId
    ? sorted.filter((a) => a.requirementId === requirementId)
    : sorted;
}

export async function recordRequirementShareActivity(input: {
  requirementId: string;
  requirementTitle: string;
  audienceType: SharingAudienceType;
  recipientOrgId?: string | null;
  recipientName: string;
  recipientContact?: string | null;
  sharingMethod: SharingMethodType;
  shareToken?: string;
  shareUrl: string;
  whatsappMessage: string;
  slaHours?: number | null;
  sharedByName?: string;
  sharedByRole?: string;
  notes?: string | null;
}): Promise<RequirementShareActivity> {
  const nowIso = new Date().toISOString();
  const token =
    input.shareToken ||
    `shr_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-4)}`;

  const record: RequirementShareActivity = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    requirementId: input.requirementId,
    requirementTitle: input.requirementTitle,
    audienceType: input.audienceType,
    recipientOrgId: input.recipientOrgId || null,
    recipientName: input.recipientName.trim() || (input.audienceType === 'vendor' ? 'Approved Vendor' : 'Direct Candidate Pool'),
    recipientContact: input.recipientContact?.trim() || null,
    sharingMethod: input.sharingMethod,
    shareToken: token,
    shareUrl: input.shareUrl,
    whatsappMessage: input.whatsappMessage,
    slaHours: input.slaHours ?? null,
    sharedByName: input.sharedByName || 'HireNest HQ',
    sharedByRole: input.sharedByRole || 'admin',
    sharedAt: nowIso,
    acknowledgedAt: null,
    respondedAt: null,
    responseCount: 0,
    followUpCount: 0,
    lastFollowUpAt: null,
    status: 'shared',
    notes: input.notes || null,
  };

  const current = readBrowserSharingLedger();
  const next = [record, ...current];
  writeBrowserSharingLedger(next);

  try {
    await fetch('/api/requirements/shares-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity: record }),
    });
  } catch {
    // Non-blocking server persistence
  }

  return record;
}

export async function recordShareFollowUp(activityId: string): Promise<RequirementShareActivity | null> {
  const nowIso = new Date().toISOString();
  const current = readBrowserSharingLedger();
  let updatedItem: RequirementShareActivity | null = null;

  const next = current.map((item) => {
    if (item.id === activityId) {
      updatedItem = {
        ...item,
        followUpCount: (item.followUpCount || 0) + 1,
        lastFollowUpAt: nowIso,
      };
      return updatedItem;
    }
    return item;
  });

  writeBrowserSharingLedger(next);

  if (updatedItem) {
    try {
      await fetch('/api/requirements/shares-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity: updatedItem }),
      });
    } catch {
      // Non-blocking
    }
  }

  return updatedItem;
}

export async function updateShareActivityResponseStatus(params: {
  activityId: string;
  status: ShareResponseStatus;
  incrementResponse?: boolean;
}): Promise<RequirementShareActivity | null> {
  const nowIso = new Date().toISOString();
  const current = readBrowserSharingLedger();
  let updatedItem: RequirementShareActivity | null = null;

  const next = current.map((item) => {
    if (item.id === params.activityId) {
      updatedItem = {
        ...item,
        status: params.status,
        acknowledgedAt:
          params.status === 'acknowledged' && !item.acknowledgedAt
            ? nowIso
            : item.acknowledgedAt,
        respondedAt:
          (params.status === 'responded' ||
            params.status === 'screening' ||
            params.status === 'interview' ||
            params.status === 'placement') &&
          !item.respondedAt
            ? nowIso
            : item.respondedAt,
        responseCount: params.incrementResponse
          ? (item.responseCount || 0) + 1
          : item.responseCount,
      };
      return updatedItem;
    }
    return item;
  });

  writeBrowserSharingLedger(next);

  if (updatedItem) {
    try {
      await fetch('/api/requirements/shares-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity: updatedItem }),
      });
    } catch {
      // Non-blocking
    }
  }

  return updatedItem;
}

/**
 * Computes the live 7-step sharing & response summary for a requirement by combining
 * recorded share activities, vendor shares, and live pipeline submissions.
 */
export function computeRequirementSharingFunnelSummary(params: {
  requirement: Requirement;
  activities: RequirementShareActivity[];
  vendorSharesCount: number;
  acknowledgedVendorsCount: number;
  submissions: Submission[];
}): {
  step1Received: boolean;
  step2Approved: boolean;
  step3AudienceSelected: boolean;
  step4MethodChosen: boolean;
  step5SharedCount: number;
  vendorShareCount: number;
  directCandidateShareCount: number;
  whatsappShareCount: number;
  copyLinkShareCount: number;
  inAppShareCount: number;
  vendorResponsesCount: number;
  candidateResponsesCount: number;
  totalFollowUpsCount: number;
  screeningCount: number;
  interviewCount: number;
  placementCount: number;
} {
  const { requirement, activities, vendorSharesCount, submissions } = params;
  const validSubs = submissions.filter((s) => s.is_valid !== false);

  const vendorSubs = validSubs.filter((s) => s.source === 'vendor');
  const directSubs = validSubs.filter((s) => s.source === 'direct' || s.source === 'internal');

  const screeningSubs = validSubs.filter(
    (s) =>
      s.stage === 'applied' ||
      s.stage === 'recruiter_review' ||
      s.stage === 'client_review'
  );
  const interviewSubs = validSubs.filter((s) => s.stage === 'interviewing');
  const placementSubs = validSubs.filter(
    (s) =>
      s.stage === 'offered' ||
      s.stage === 'offer_accepted' ||
      s.stage === 'onboarded'
  );

  const vendorActivities = activities.filter((a) => a.audienceType === 'vendor');
  const dcActivities = activities.filter((a) => a.audienceType === 'direct_candidate');

  const whatsappCount = activities.filter((a) => a.sharingMethod === 'whatsapp').length;
  const copyLinkCount = activities.filter((a) => a.sharingMethod === 'copy_link').length;
  const inAppCount =
    activities.filter((a) => a.sharingMethod === 'in_app').length +
    (activities.length === 0 ? vendorSharesCount : 0);

  const loggedVendorResponses = vendorActivities.reduce((acc, a) => acc + (a.responseCount || 0), 0);
  const loggedDcResponses = dcActivities.reduce((acc, a) => acc + (a.responseCount || 0), 0);

  const totalShared = Math.max(activities.length, vendorSharesCount + (requirement.is_public ? 1 : 0));

  return {
    step1Received: Boolean(requirement.id),
    step2Approved: requirement.status === 'open' || requirement.status === 'filled',
    step3AudienceSelected: totalShared > 0,
    step4MethodChosen: totalShared > 0,
    step5SharedCount: totalShared,
    vendorShareCount: Math.max(vendorActivities.length, vendorSharesCount),
    directCandidateShareCount: dcActivities.length + (requirement.is_public && dcActivities.length === 0 ? 1 : 0),
    whatsappShareCount: whatsappCount,
    copyLinkShareCount: copyLinkCount,
    inAppShareCount: inAppCount,
    vendorResponsesCount: Math.max(vendorSubs.length, loggedVendorResponses),
    candidateResponsesCount: Math.max(directSubs.length, loggedDcResponses),
    totalFollowUpsCount: activities.reduce((acc, a) => acc + (a.followUpCount || 0), 0),
    screeningCount: screeningSubs.length,
    interviewCount: interviewSubs.length,
    placementCount: placementSubs.length,
  };
}
