import { supabase } from '../lib/supabase';
import type {
  AdminVendorPerformanceRow,
  CandidateQualityFeedback,
  FeedbackKind,
  Interview,
  InterviewDecision,
  InterviewFeedback,
  InterviewMode,
  InterviewRound,
  InterviewStatus,
  PendingFeedbackRow,
  RatingDispute,
  VendorPerformanceResult,
} from '../types/db';

const DEFAULT_PAGE_SIZE = 25;

export async function fetchInterviews(params: {
  page?: number;
  pageSize?: number;
  submissionId?: string;
  status?: InterviewStatus | '';
}): Promise<{ data: Interview[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('interviews')
    .select(
      '*, submissions:submission_id(*, candidates:candidate_id(id, full_name, current_title, skills, total_experience_years), requirements:requirement_id(id, title, description, skills)), interview_feedback(*)',
      { count: 'exact' }
    )
    .order('scheduled_at', { ascending: false })
    .range(from, to);

  if (params.submissionId) query = query.eq('submission_id', params.submissionId);
  if (params.status) query = query.eq('status', params.status);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Interview[], count: count || 0 };
}

export async function scheduleInterviewRpc(params: {
  p_submission_id: string;
  p_round_type: InterviewRound;
  p_scheduled_at: string;
  p_duration_minutes?: number;
  p_mode?: InterviewMode;
  p_meeting_link?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('schedule_interview', params);
  if (error) throw error;
  return String(data);
}

export async function updateInterviewStatusRpc(params: {
  p_interview_id: string;
  p_status: InterviewStatus;
}): Promise<void> {
  const { error } = await supabase.rpc('update_interview_status', params);
  if (error) throw error;
}

export async function fetchMyPendingFeedback(): Promise<PendingFeedbackRow[]> {
  const { data, error } = await supabase.rpc('my_pending_feedback');
  if (error) throw error;
  return (data || []) as PendingFeedbackRow[];
}

// Section 5.3 & 8.1: Direct insert into interview_feedback (never pass rated_by; DB sets it)
export async function createInterviewFeedback(payload: {
  interview_id: string;
  skill_rating: number;
  communication_rating: number;
  overall_rating: number;
  decision: InterviewDecision;
  feedback: string;
  evidence?: string | null;
}): Promise<InterviewFeedback> {
  const { data, error } = await supabase
    .from('interview_feedback')
    .insert({
      interview_id: payload.interview_id,
      skill_rating: payload.skill_rating,
      communication_rating: payload.communication_rating,
      overall_rating: payload.overall_rating,
      decision: payload.decision,
      feedback: payload.feedback,
      evidence: payload.evidence || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as InterviewFeedback;
}

// Section 5.3 & 8.2: Direct insert into candidate_quality_feedback
export async function createCandidateQualityFeedback(payload: {
  submission_id: string;
  jd_skill_alignment: number;
  relevant_experience: number;
  resume_accuracy: number;
  communication: number;
  interview_readiness: number;
  overall_suitability: number;
  comments?: string | null;
}): Promise<CandidateQualityFeedback> {
  const { data, error } = await supabase
    .from('candidate_quality_feedback')
    .insert({
      submission_id: payload.submission_id,
      jd_skill_alignment: payload.jd_skill_alignment,
      relevant_experience: payload.relevant_experience,
      resume_accuracy: payload.resume_accuracy,
      communication: payload.communication,
      interview_readiness: payload.interview_readiness,
      overall_suitability: payload.overall_suitability,
      comments: payload.comments || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CandidateQualityFeedback;
}

export async function fetchInterviewFeedbackList(params: {
  page?: number;
  pageSize?: number;
  interviewId?: string;
}): Promise<{ data: InterviewFeedback[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('interview_feedback')
    .select(
      '*, interviews:interview_id(*, submissions:submission_id(*, candidates:candidate_id(id, full_name), requirements:requirement_id(id, title), organizations:vendor_org_id(id, name)))',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.interviewId) query = query.eq('interview_id', params.interviewId);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as InterviewFeedback[], count: count || 0 };
}

export async function fetchQualityFeedbackList(params: {
  page?: number;
  pageSize?: number;
  submissionId?: string;
}): Promise<{ data: CandidateQualityFeedback[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('candidate_quality_feedback')
    .select(
      '*, submissions:submission_id(*, candidates:candidate_id(id, full_name), requirements:requirement_id(id, title), organizations:vendor_org_id(id, name))',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.submissionId) query = query.eq('submission_id', params.submissionId);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as CandidateQualityFeedback[], count: count || 0 };
}

// Section 5.4 Rating & Dispute RPCs
export async function setFeedbackVendorVisibilityRpc(params: {
  p_kind: FeedbackKind;
  p_feedback_id: string;
  p_visible: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('set_feedback_vendor_visibility', params);
  if (error) throw error;
}

export async function raiseRatingDisputeRpc(params: {
  p_kind: FeedbackKind;
  p_feedback_id: string;
  p_reason: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('raise_rating_dispute', params);
  if (error) throw error;
  return String(data);
}

export async function resolveRatingDisputeRpc(params: {
  p_dispute_id: string;
  p_upheld: boolean;
  p_note: string;
}): Promise<void> {
  const { error } = await supabase.rpc('resolve_rating_dispute', params);
  if (error) throw error;
}

export async function fetchRatingDisputes(params: {
  page?: number;
  pageSize?: number;
  status?: 'open' | 'upheld' | 'rejected' | '';
}): Promise<{ data: RatingDispute[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('rating_disputes')
    .select('*, organizations:vendor_org_id(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.status) query = query.eq('status', params.status);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as RatingDispute[], count: count || 0 };
}

export async function getVendorPerformanceRpc(
  vendorOrgId: string
): Promise<VendorPerformanceResult> {
  const { data, error } = await supabase.rpc('get_vendor_performance', {
    p_vendor_org_id: vendorOrgId,
  });
  if (error) throw error;
  return data as VendorPerformanceResult;
}

export async function fetchAdminVendorPerformanceRpc(params: {
  limit?: number;
  offset?: number;
}): Promise<AdminVendorPerformanceRow[]> {
  const { data, error } = await supabase.rpc('admin_vendor_performance', {
    p_limit: params.limit ?? DEFAULT_PAGE_SIZE,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  return (data || []) as AdminVendorPerformanceRow[];
}
