export type EarlyAccessStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'waitlisted'
  | 'rejected';

export type BusinessType =
  | 'staffing_agency'
  | 'it_recruitment'
  | 'independent_recruiter'
  | 'corporate_hiring'
  | 'consulting'
  | 'other';

export type CompanySize =
  | '1-10'
  | '11-50'
  | '51-200'
  | '201-500'
  | '500+';

export type HirenestModule =
  | 'requirement_management'
  | 'candidate_matching'
  | 'vendor_governance'
  | 'interview_scheduling'
  | 'ai_copilot'
  | 'compliance_nda'
  | 'analytics_reporting';

export const MODULE_LABELS: Record<HirenestModule, string> = {
  requirement_management: 'Requirement management',
  candidate_matching: 'Candidate matching engine',
  vendor_governance: 'Vendor governance & scorecards',
  interview_scheduling: 'Interview scheduling & feedback',
  ai_copilot: 'AI copilot (JD editor, skill extraction)',
  compliance_nda: 'Compliance & NDA verification',
  analytics_reporting: 'Analytics & reporting',
};

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  staffing_agency: 'Staffing agency',
  it_recruitment: 'IT recruitment firm',
  independent_recruiter: 'Independent recruiter',
  corporate_hiring: 'Corporate hiring team',
  consulting: 'Consulting / RPO',
  other: 'Other',
};

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  '1-10': '1-10 employees',
  '11-50': '11-50 employees',
  '51-200': '51-200 employees',
  '201-500': '201-500 employees',
  '500+': '500+ employees',
};

export interface EarlyAccessApplication {
  id: string;
  applicationId: string;
  contactName: string;
  designation: string;
  businessEmail: string;
  phone: string;
  companyName: string;
  companyWebsite: string;
  businessType: BusinessType;
  country: string;
  companySize: CompanySize;
  recruitmentTeamSize: string;
  businessRequirements: string;
  interestedModules: HirenestModule[];
  currentChallenges: string;
  linkedinUrl: string;
  comments: string;
  privacyConsent: boolean;
  status: EarlyAccessStatus;
  assignedTo: string | null;
  adminNotes: string;
  followUpDate: string | null;
  invitationSentAt: string | null;
  registeredAt: string | null;
  trialActivatedAt: string | null;
  paidConvertedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface EarlyAccessSubmitPayload {
  contactName: string;
  designation: string;
  businessEmail: string;
  phone: string;
  companyName: string;
  companyWebsite?: string;
  businessType: BusinessType;
  country: string;
  companySize: CompanySize;
  recruitmentTeamSize?: string;
  businessRequirements?: string;
  interestedModules: HirenestModule[];
  currentChallenges?: string;
  linkedinUrl?: string;
  comments?: string;
  privacyConsent: boolean;
}

export async function submitEarlyAccessApplication(
  payload: EarlyAccessSubmitPayload
): Promise<{ success: boolean; applicationId: string }> {
  const res = await fetch('/api/early-access/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Submission failed' }));
    throw new Error(err.error || 'Submission failed');
  }
  return res.json();
}

export async function fetchEarlyAccessApplications(params?: {
  status?: EarlyAccessStatus;
}): Promise<EarlyAccessApplication[]> {
  const url = new URL('/api/early-access/applications', window.location.origin);
  if (params?.status) url.searchParams.set('status', params.status);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch applications');
  return res.json();
}

export async function updateEarlyAccessApplication(params: {
  id: string;
  status?: EarlyAccessStatus;
  assignedTo?: string | null;
  adminNotes?: string;
  followUpDate?: string | null;
}): Promise<EarlyAccessApplication> {
  const res = await fetch(`/api/early-access/applications/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to update application');
  return res.json();
}

export async function sendEarlyAccessInvitation(id: string): Promise<void> {
  const res = await fetch(`/api/early-access/applications/${id}/invite`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to send invitation');
}
