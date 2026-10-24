/**
 * Exact hand-written database contract matching HireNestOS Section 5.
 * Covers all 11 Enums, 21 Tables, and 25 RPCs.
 */

// 5.1 Enums
export type AppRole =
  | 'admin'
  | 'recruiter'
  | 'client_manager'
  | 'client_member'
  | 'vendor_admin'
  | 'vendor_recruiter'
  | 'candidate'
  | 'pending';

export type UserStatus = 'active' | 'pending_approval' | 'suspended';

export type OrgType = 'internal' | 'client' | 'vendor';

export type OrgStatus = 'pending_review' | 'approved' | 'suspended' | 'rejected';

export type SlaTier = 'standard' | 'premium' | 'enterprise';

export type RequirementStatus =
  | 'draft'
  | 'pending_approval'
  | 'open'
  | 'on_hold'
  | 'closed'
  | 'filled';

export type WorkMode = 'onsite' | 'hybrid' | 'remote';

export type EmploymentType =
  | 'full_time'
  | 'contract'
  | 'contract_to_hire'
  | 'part_time';

export type MarginType = 'fixed' | 'percentage';

export type CandidateSource = 'vendor' | 'direct' | 'internal';

export type SubmissionStage =
  | 'applied'
  | 'recruiter_review'
  | 'client_review'
  | 'interviewing'
  | 'offered'
  | 'offer_accepted'
  | 'offer_declined'
  | 'rejected'
  | 'withdrawn'
  | 'onboarded';

export type InterviewRound =
  | 'initial_screening'
  | 'technical'
  | 'managerial'
  | 'final'
  | 'ai_screening';

export type InterviewStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'no_show';

export type InterviewMode = 'video' | 'phone' | 'in_person' | 'ai_text';

export type InterviewDecision =
  | 'advance'
  | 'hold'
  | 'reject'
  | 'additional_assessment';

export type AiModality = 'text' | 'audio' | 'video';

export type DisputeStatus = 'open' | 'upheld' | 'rejected';

export type FeedbackKind = 'interview' | 'quality';

export type DuplicateKind = 'candidate' | 'submission';

export type DuplicateFlagStatus = 'open' | 'resolved';

// 5.2 Tables (All 21 tables in public schema)

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  status: OrgStatus;
  industry: string | null;
  domain: string | null;
  gst_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  sla_tier: SlaTier;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  org_id: string | null;
  role: AppRole;
  status: UserStatus;
  full_name: string;
  email: string;
  phone: string | null;
  requested_role: string | null;
  requested_company: string | null;
  created_at: string;
}

export interface Requirement {
  id: string;
  client_org_id: string;
  title: string;
  description: string;
  skills: string[];
  min_experience: number;
  max_experience: number;
  location: string;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  openings: number;
  vendor_visible_budget: number | null;
  currency: string;
  status: RequirementStatus;
  is_public: boolean;
  submission_sla_hours: number;
  created_by: string;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  organizations?: Pick<Organization, 'id' | 'name'> | null;
}

export interface RequirementFinancials {
  requirement_id: string;
  actual_client_budget: number | null;
  notes: string | null;
}

export interface RequirementMargins {
  requirement_id: string;
  platform_margin: number | null;
  margin_type: MarginType;
}

export interface RequirementVendorShare {
  id: string;
  requirement_id: string;
  vendor_org_id: string;
  shared_by: string;
  shared_at: string;
  due_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  revoked_at: string | null;
  organizations?: Pick<Organization, 'id' | 'name' | 'sla_tier'> | null;
  requirements?: Requirement | null;
}

export interface Candidate {
  id: string;
  user_id: string | null;
  full_name: string;
  current_title: string | null;
  location: string | null;
  total_experience_years: number | null;
  skills: string[];
  summary: string | null;
  resume_path: string | null;
  resume_hash: string | null;
  parsed_data: Record<string, unknown> | null;
  original_source: CandidateSource;
  source_vendor_org_id: string | null;
  owner_vendor_org_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_vendor?: Pick<Organization, 'id' | 'name'> | null;
  owner_vendor?: Pick<Organization, 'id' | 'name'> | null;
  candidate_contacts?: CandidateContacts | CandidateContacts[] | null;
}

export interface CandidateContacts {
  candidate_id: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

export interface DuplicateFlag {
  id: string;
  kind: DuplicateKind;
  match_type: string;
  existing_candidate_id: string;
  requirement_id: string | null;
  attempted_by: string;
  attempted_org_id: string | null;
  attempted_name: string | null;
  status: DuplicateFlagStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  candidates?: Pick<Candidate, 'id' | 'full_name' | 'original_source' | 'owner_vendor_org_id'> | null;
  organizations?: Pick<Organization, 'id' | 'name'> | null;
  requirements?: Pick<Requirement, 'id' | 'title'> | null;
}

export interface CandidateMatch {
  id: string;
  requirement_id: string;
  candidate_id: string;
  computed_score: number;
  skill_score: number;
  experience_score: number;
  domain_score?: number;
  seniority_score?: number;
  override_score: number | null;
  final_score: number;
  matched_skills: string[];
  unproven_skills: string[];
  experience_note: string | null;
  evidence: Record<string, unknown> | null;
  engine_version: string;
  calculated_at: string;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  candidates?: Candidate | null;
  requirements?: Requirement | null;
}

export interface Submission {
  id: string;
  requirement_id: string;
  candidate_id: string;
  source: CandidateSource;
  vendor_org_id: string | null;
  submitted_by: string;
  stage: SubmissionStage;
  stage_changed_at: string;
  shared_with_client_at: string | null;
  is_valid: boolean;
  invalid_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  candidates?: Candidate | null;
  requirements?: Requirement | null;
  organizations?: Pick<Organization, 'id' | 'name'> | null;
  submitter?: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
}

export interface SubmissionStageHistory {
  id: string;
  submission_id: string;
  from_stage: SubmissionStage | null;
  to_stage: SubmissionStage;
  actor_id: string;
  actor_role: AppRole;
  reason: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
}

export interface Interview {
  id: string;
  submission_id: string;
  round_type: InterviewRound;
  round_number: number;
  scheduled_at: string;
  duration_minutes: number;
  mode: InterviewMode;
  meeting_link: string | null;
  status: InterviewStatus;
  created_by: string;
  completed_at: string | null;
  submissions?: Submission | null;
  interview_feedback?: InterviewFeedback[];
}

export interface InterviewFeedback {
  id: string;
  interview_id: string;
  rated_by: string;
  rater_org_id: string | null;
  skill_rating: number;
  communication_rating: number;
  overall_rating: number;
  decision: InterviewDecision;
  feedback: string;
  evidence: string | null;
  visible_to_vendor: boolean;
  visibility_approved_by: string | null;
  excluded_from_score: boolean;
  created_at: string;
  interviews?: Interview | null;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
}

export interface CandidateQualityFeedback {
  id: string;
  submission_id: string;
  rated_by: string;
  rater_org_id: string | null;
  jd_skill_alignment: number;
  relevant_experience: number;
  resume_accuracy: number;
  communication: number;
  interview_readiness: number;
  overall_suitability: number;
  comments: string | null;
  visible_to_vendor: boolean;
  visibility_approved_by: string | null;
  excluded_from_score: boolean;
  created_at: string;
  submissions?: Submission | null;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
}

export interface RatingDispute {
  id: string;
  feedback_kind: FeedbackKind;
  feedback_id: string;
  vendor_org_id: string;
  raised_by: string;
  reason: string;
  status: DisputeStatus;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  organizations?: Pick<Organization, 'id' | 'name'> | null;
}

export interface AiScreeningSession {
  id: string;
  submission_id: string;
  modality: AiModality;
  status: string;
  transcript: Record<string, unknown> | null;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PlatformSettings {
  id: number;
  timing_weight: number;
  quality_weight: number;
  compliance_weight: number;
  weights_approved: boolean;
  weights_approved_by: string | null;
  min_sample_size: number;
  default_submission_sla_hours: number;
  share_vendor_summary_with_clients: boolean;
  ai_provider: 'ollama';
  ai_screening_enabled: boolean;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  actor_id: string | null;
  actor_role: AppRole | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export interface EventOutbox {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  recipient_user_id: string | null;
  recipient_email: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

// 8.4 Vendor Performance Result Shape
export interface VendorPerformanceResult {
  vendor_org_id: string;
  min_sample_size: number;
  timing: {
    status: 'ok' | 'not_enough_data';
    score: number | null;
    evaluable_shares: number;
    sla_met: number;
    sla_compliance_90d_pct: number | null;
    avg_response_hours: number | null;
    avg_turnaround_hours: number | null;
  };
  quality: {
    status: 'ok' | 'not_enough_data';
    score: number | null;
    rated_submissions: number;
    avg_rating_1_to_5: number | null;
    dimensions: {
      jd_skill_alignment: number | null;
      relevant_experience: number | null;
      resume_accuracy: number | null;
      communication: number | null;
      interview_readiness: number | null;
      overall_suitability: number | null;
    };
    avg_interview_overall_1_to_5: number | null;
  };
  compliance: {
    status: 'ok' | 'not_enough_data';
    score: number | null;
    submissions: number;
    compliant: number;
  };
  overall: {
    status: 'ok' | 'not_enough_data' | 'weights_not_approved';
    score: number | null;
    weights: {
      timing: number;
      quality: number;
      compliance: number;
      approved: boolean;
    };
  };
}

export interface AdminVendorPerformanceRow {
  vendor_org_id: string;
  vendor_name: string;
  metrics: VendorPerformanceResult;
}

export interface PendingFeedbackRow {
  interview_id: string;
  submission_id: string;
  requirement_title: string;
  candidate_name: string;
  round_type: InterviewRound;
  round_number: number;
  completed_at: string;
}

export interface DuplicateCheckResult {
  is_duplicate: boolean;
  match_type: string | null;
  can_access_existing: boolean;
  existing_candidate_id: string | null;
}

export type CreateCandidateResult =
  | { status: 'created'; candidate_id: string }
  | {
      status: 'duplicate';
      match_type: string;
      flag_id: string;
      existing_candidate_id: string;
    };

export type SubmitCandidateResult =
  | { status: 'created'; submission_id: string }
  | { status: 'duplicate'; reason: string };

export type ApplyToRequirementResult =
  | { status: 'created' | 'applied'; submission_id?: string; reason?: string }
  | { status: 'duplicate'; submission_id?: string; reason?: string };

export interface AdminDashboardSummary {
  clients?: number;
  vendors?: number;
  pending_users?: number;
  open_duplicate_flags?: number;
  open_disputes?: number;
  interviews_pending_feedback?: number;
  candidates_by_source?: Partial<Record<CandidateSource, number>>;
  requirements_by_status?: Partial<Record<RequirementStatus, number>>;
  submissions_by_stage?: Partial<Record<SubmissionStage, number>>;
  [key: string]: unknown;
}

// 5.4 All 25 RPCs Contract
export interface DatabaseRpcContract {
  admin_assign_user: {
    Args: {
      p_user_id: string;
      p_role: AppRole;
      p_org_id?: string | null;
      p_status?: UserStatus;
    };
    Returns: void;
  };
  set_requirement_status: {
    Args: {
      p_requirement_id: string;
      p_status: RequirementStatus;
      p_reason?: string;
    };
    Returns: void;
  };
  set_requirement_public: {
    Args: {
      p_requirement_id: string;
      p_is_public: boolean;
    };
    Returns: void;
  };
  share_requirement_with_vendors: {
    Args: {
      p_requirement_id: string;
      p_vendor_org_ids: string[];
      p_sla_hours?: number;
    };
    Returns: number;
  };
  revoke_requirement_share: {
    Args: {
      p_requirement_id: string;
      p_vendor_org_id: string;
    };
    Returns: void;
  };
  acknowledge_requirement: {
    Args: {
      p_requirement_id: string;
    };
    Returns: void;
  };
  check_candidate_duplicate: {
    Args: {
      p_email?: string | null;
      p_phone?: string | null;
      p_resume_hash?: string | null;
    };
    Returns: DuplicateCheckResult;
  };
  create_candidate: {
    Args: {
      p_full_name: string;
      p_email?: string | null;
      p_phone?: string | null;
      p_linkedin_url?: string | null;
      p_current_title?: string | null;
      p_location?: string | null;
      p_total_experience_years?: number | null;
      p_skills?: string[];
      p_summary?: string | null;
      p_resume_hash?: string | null;
    };
    Returns: CreateCandidateResult;
  };
  submit_candidate: {
    Args: {
      p_requirement_id: string;
      p_candidate_id: string;
      p_notes?: string | null;
    };
    Returns: SubmitCandidateResult;
  };
  apply_to_requirement: {
    Args: {
      p_requirement_id: string;
    };
    Returns: ApplyToRequirementResult;
  };
  transition_submission: {
    Args: {
      p_submission_id: string;
      p_to: SubmissionStage;
      p_reason?: string | null;
    };
    Returns: void;
  };
  mark_submission_invalid: {
    Args: {
      p_submission_id: string;
      p_reason: string;
    };
    Returns: void;
  };
  schedule_interview: {
    Args: {
      p_submission_id: string;
      p_round_type: InterviewRound;
      p_scheduled_at: string;
      p_duration_minutes?: number;
      p_mode?: InterviewMode;
      p_meeting_link?: string | null;
    };
    Returns: string;
  };
  update_interview_status: {
    Args: {
      p_interview_id: string;
      p_status: InterviewStatus;
    };
    Returns: void;
  };
  my_pending_feedback: {
    Args: Record<string, never>;
    Returns: PendingFeedbackRow[];
  };
  set_feedback_vendor_visibility: {
    Args: {
      p_kind: FeedbackKind;
      p_feedback_id: string;
      p_visible: boolean;
    };
    Returns: void;
  };
  raise_rating_dispute: {
    Args: {
      p_kind: FeedbackKind;
      p_feedback_id: string;
      p_reason: string;
    };
    Returns: string;
  };
  resolve_rating_dispute: {
    Args: {
      p_dispute_id: string;
      p_upheld: boolean;
      p_note: string;
    };
    Returns: void;
  };
  override_match: {
    Args: {
      p_requirement_id: string;
      p_candidate_id: string;
      p_score: number | null;
      p_reason: string;
    };
    Returns: void;
  };
  recompute_matches: {
    Args: {
      p_requirement_id: string;
    };
    Returns: void;
  };
  resolve_duplicate_flag: {
    Args: {
      p_flag_id: string;
      p_note: string;
      p_new_owner_vendor_org_id?: string | null;
    };
    Returns: void;
  };
  admin_link_candidate_account: {
    Args: {
      p_candidate_id: string;
      p_user_id: string;
    };
    Returns: void;
  };
  get_vendor_performance: {
    Args: {
      p_vendor_org_id: string;
    };
    Returns: VendorPerformanceResult;
  };
  admin_vendor_performance: {
    Args: {
      p_limit?: number;
      p_offset?: number;
    };
    Returns: AdminVendorPerformanceRow[];
  };
  admin_dashboard_summary: {
    Args: Record<string, never>;
    Returns: AdminDashboardSummary;
  };
}
