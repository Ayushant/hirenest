import { supabase } from '../lib/supabase';
import { isSubmissionApprovedForClientVisibility } from '../lib/offerOnboarding';
import type {
  AppRole,
  ApplyToRequirementResult,
  CandidateSource,
  Submission,
  SubmissionAssessment,
  SubmissionClarification,
  SubmissionStage,
  SubmissionStageHistory,
  SubmitCandidateResult,
  ValidationInterview,
} from '../types/db';

const DEFAULT_PAGE_SIZE = 25;

export async function fetchSubmissions(params: {
  page?: number;
  pageSize?: number;
  requirementId?: string;
  candidateId?: string;
  vendorOrgId?: string;
  clientOrgId?: string | null;
  enforceClientGate?: boolean;
  stage?: SubmissionStage | '';
  source?: CandidateSource | '';
  isValid?: boolean;
}): Promise<{ data: Submission[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('submissions')
    .select(
      '*, candidates:candidate_id(*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name)), requirements:requirement_id(*, organizations:client_org_id(id, name)), organizations:vendor_org_id(id, name)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.requirementId) query = query.eq('requirement_id', params.requirementId);
  if (params.candidateId) query = query.eq('candidate_id', params.candidateId);
  if (params.vendorOrgId) query = query.eq('vendor_org_id', params.vendorOrgId);
  if (params.stage) query = query.eq('stage', params.stage);
  if (params.source) query = query.eq('source', params.source);
  if (params.isValid !== undefined) query = query.eq('is_valid', params.isValid);

  const { data, error, count } = await query;
  if (error) throw error;
  const rawList = (data || []) as Submission[];

  if (params.enforceClientGate || params.clientOrgId) {
    const filtered = rawList.filter((sub) =>
      isSubmissionApprovedForClientVisibility(sub, params.clientOrgId)
    );
    return { data: filtered, count: filtered.length };
  }

  return { data: rawList, count: count || 0 };
}

export async function fetchSubmissionById(id: string): Promise<Submission | null> {
  const { data, error } = await supabase
    .from('submissions')
    .select(
      '*, candidates:candidate_id(*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name)), requirements:requirement_id(*, organizations:client_org_id(id, name)), organizations:vendor_org_id(id, name)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Submission | null;
}

export async function fetchSubmissionStageHistory(
  submissionId: string
): Promise<SubmissionStageHistory[]> {
  const { data, error } = await supabase
    .from('submission_stage_history')
    .select('*, profiles:actor_id(id, full_name, role)')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as SubmissionStageHistory[];
}

// Section 5.4 Pipeline RPCs
export async function submitCandidateRpc(params: {
  p_requirement_id: string;
  p_candidate_id: string;
  p_notes?: string | null;
}): Promise<SubmitCandidateResult> {
  const { data, error } = await supabase.rpc('submit_candidate', params);
  if (error) throw error;
  return data as SubmitCandidateResult;
}

export async function applyToRequirementRpc(
  requirementId: string
): Promise<ApplyToRequirementResult> {
  const { data, error } = await supabase.rpc('apply_to_requirement', {
    p_requirement_id: requirementId,
  });
  if (error) throw error;
  return data as ApplyToRequirementResult;
}

export async function transitionSubmissionRpc(params: {
  p_submission_id: string;
  p_to: SubmissionStage;
  p_reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('transition_submission', params);
  if (error) throw error;
}

export async function markSubmissionInvalidRpc(params: {
  p_submission_id: string;
  p_reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc('mark_submission_invalid', params);
  if (error) throw error;
}

// Section 5.5: Submission stage rules (enforced by DB; mirrored in UI)
const ALLOWED_STAGE_GRAPH: Record<SubmissionStage, SubmissionStage[]> = {
  applied: ['recruiter_review', 'rejected', 'withdrawn'],
  recruiter_review: ['client_review', 'rejected', 'withdrawn'],
  client_review: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['offer_accepted', 'offer_declined', 'withdrawn'],
  offer_accepted: ['onboarded', 'withdrawn'],
  offer_declined: [],
  rejected: [],
  withdrawn: [],
  onboarded: [],
};

export function getAllowedTransitions(
  currentStage: SubmissionStage,
  role: AppRole
): SubmissionStage[] {
  const nextStages = ALLOWED_STAGE_GRAPH[currentStage] || [];
  if (role === 'admin' || role === 'recruiter') {
    return nextStages;
  }
  if (role === 'client_manager' || role === 'client_member') {
    if (currentStage === 'client_review') {
      return nextStages.filter((s) => s === 'interviewing' || s === 'rejected');
    }
    if (currentStage === 'interviewing') {
      return nextStages.filter((s) => s === 'offered' || s === 'rejected');
    }
    if (currentStage === 'offered') {
      return nextStages.filter((s) => s === 'offer_accepted' || s === 'offer_declined');
    }
    if (currentStage === 'offer_accepted') {
      return nextStages.filter((s) => s === 'onboarded');
    }
    return [];
  }
  if (role === 'vendor_admin' || role === 'vendor_recruiter' || role === 'candidate') {
    return nextStages.filter((s) => s === 'withdrawn');
  }
  return [];
}

export function transitionRequiresReason(targetStage: SubmissionStage): boolean {
  return (
    targetStage === 'rejected' ||
    targetStage === 'withdrawn' ||
    targetStage === 'offer_declined'
  );
}

// ------------------------------------------------------------------
// Admin-recruiter validation gate (04_admin_review_gate.sql)
// ------------------------------------------------------------------

export async function fetchSubmissionAssessment(
  submissionId: string
): Promise<SubmissionAssessment | null> {
  const { data, error } = await supabase
    .from('submission_assessments')
    .select('*')
    .eq('submission_id', submissionId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as SubmissionAssessment | null;
}

export async function fetchValidationInterview(
  submissionId: string
): Promise<ValidationInterview | null> {
  const { data, error } = await supabase
    .from('validation_interviews')
    .select('*')
    .eq('submission_id', submissionId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as ValidationInterview | null;
}

export async function fetchSubmissionClarifications(
  submissionId: string
): Promise<SubmissionClarification[]> {
  const { data, error } = await supabase
    .from('submission_clarifications')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as SubmissionClarification[];
}

export async function reviewSubmissionAssessmentRpc(params: {
  p_submission_id: string;
  p_patch: Record<string, unknown>;
  p_reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('review_submission_assessment', params);
  if (error) throw error;
}

export async function recordValidationInterviewRpc(params: {
  p_submission_id: string;
  p_scheduled_at: string;
  p_duration_minutes: number;
  p_mode: string;
  p_attendance: 'attended' | 'no_show' | 'rescheduled';
  p_communication_score: number | null;
  p_technical_score: number | null;
  p_verified_skills: string[];
  p_missing_skills: string[];
  p_notes: string | null;
  p_recommendation: 'approve' | 'reject' | 'needs_clarification';
}): Promise<string> {
  const { data, error } = await supabase.rpc('record_validation_interview', params);
  if (error) throw error;
  return data as string;
}

export async function approveSubmissionRpc(submissionId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_submission', {
    p_submission_id: submissionId,
  });
  if (error) throw error;
}

export async function requestClarificationRpc(params: {
  p_submission_id: string;
  p_missing_skills: string[];
  p_questions: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_clarification', params);
  if (error) throw error;
  return data as string;
}

export async function resolveClarificationRpc(params: {
  p_clarification_id: string;
  p_mark_resolved?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('resolve_clarification', params);
  if (error) throw error;
}

export const VALIDATION_STATE_LABELS: Record<string, string> = {
  pending_assessment: 'Pending Assessment Review',
  pending_interview: 'Pending Validation Interview',
  pending_clarification: 'Awaiting Clarification',
  approved: 'Approved by Admin Recruiter',
  rejected_by_recruiter: 'Rejected by Admin Recruiter',
};
