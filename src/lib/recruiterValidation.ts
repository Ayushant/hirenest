import type { Submission } from '../types/db';
import type { BadgeTone } from '../components/ui/kit';
import { computeFineTunedCandidateMatch } from './matchingEngine';

export type SkillEvidenceStatus =
  | 'matched'
  | 'recruiter_verified'
  | 'candidate_confirmed'
  | 'unclear'
  | 'not_found';

export type ValidationDecisionStage =
  | 'matched'
  | 'recruiter_review'
  | 'validation_interview_scheduled'
  | 'interview_completed'
  | 'approved_for_submission'
  | 'hold_for_clarification'
  | 'rejected'
  | 'submitted_to_client';

export type RecruiterDecisionGate = ValidationDecisionStage;

export const SKILL_EVIDENCE_STATUS_LABELS: Record<SkillEvidenceStatus, string> = {
  matched: 'Matched in resume',
  recruiter_verified: 'Recruiter-verified',
  candidate_confirmed: 'Candidate-confirmed',
  unclear: 'Unclear evidence',
  not_found: 'Not found in resume',
};

export const VALIDATION_STAGE_LABELS: Record<ValidationDecisionStage, string> = {
  matched: 'Matched',
  recruiter_review: 'Recruiter Review',
  validation_interview_scheduled: 'Validation Interview Scheduled',
  interview_completed: 'Interview Completed',
  approved_for_submission: 'Approved for Submission',
  hold_for_clarification: 'Hold for Clarification',
  rejected: 'Rejected',
  submitted_to_client: 'Submitted to Client',
};

export const DECISION_GATE_LABELS = VALIDATION_STAGE_LABELS;

export const DECISION_GATE_TONES: Record<ValidationDecisionStage, BadgeTone> = {
  matched: 'neutral',
  recruiter_review: 'storm_blue',
  validation_interview_scheduled: 'sky',
  interview_completed: 'teal',
  approved_for_submission: 'emerald',
  hold_for_clarification: 'amber',
  rejected: 'red',
  submitted_to_client: 'rich_blue',
};

export const VALIDATION_STAGE_ORDER: ValidationDecisionStage[] = [
  'matched',
  'recruiter_review',
  'validation_interview_scheduled',
  'interview_completed',
  'approved_for_submission',
  'submitted_to_client',
];

export const RATING_CRITERIA_GUIDE = {
  communication: {
    1: '1 — Poor: Unclear expression; unable to explain work history',
    2: '2 — Below expectations: Hesitant or fragmented responses',
    3: '3 — Satisfactory: Clear explanation of role and responsibilities',
    4: '4 — Strong: Articulate, structured client-ready communication',
    5: '5 — Exceptional: Executive-grade clarity and stakeholder presence',
  },
  technical: {
    1: '1 — Poor: Cannot explain core JD concepts or listed project stack',
    2: '2 — Basic: Surface familiarity only; lacks hands-on depth',
    3: '3 — Competent: Solid hands-on execution on mandatory JD skills',
    4: '4 — Advanced: Production architecture & troubleshooting depth',
    5: '5 — Expert: Deep domain mastery across mandatory & preferred stack',
  },
  skillGap: {
    1: '1 — Unresolved: Missing mandatory skills confirmed absent',
    2: '2 — Partial: Significant gaps remain on mandatory JD skills',
    3: '3 — Acceptable: Unclear skills clarified with workable proficiency',
    4: '4 — Verified: Missing resume skills proven via live technical answers',
    5: '5 — Complete: All JD gaps resolved with strong project evidence',
  },
  overall: {
    1: '1 — Do Not Submit: Reject candidate for this requirement',
    2: '2 — Hold: Requires updated resume or vendor/candidate clarification',
    3: '3 — Conditional Approve: Proceed with disclosed skill limitations',
    4: '4 — Recommended: Strong validated fit for client submission',
    5: '5 — Top Priority Submit: Immediate client presentation recommended',
  },
};

export interface SkillEvidenceItem {
  skill: string;
  category: 'mandatory' | 'preferred';
  status: SkillEvidenceStatus;
  resumeSection: string;
  evidenceSnippet: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface ValidationQuestionItem {
  id: string;
  targetSkill: string;
  question: string;
  candidateAnswer: string;
  recruiterNotes: string;
  evidenceRecorded: string;
  skillVerified: boolean;
}

export interface ValidationInterviewRatings {
  communicationRating: number;
  technicalRating: number;
  skillGapValidationRating: number;
  overallRecommendationRating: number;
  summaryNotes: string;
  assessedBy?: string;
  assessedAt?: string;
  communication: number;
  technical_assessment: number;
  skill_gap_validation: number;
  overall_recommendation: number;
}

export interface SubmissionValidationRecord {
  submissionId: string;
  candidateId: string;
  requirementId: string;
  validationStage: ValidationDecisionStage;
  approvedBy?: string;
  approvedAt?: string;
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: string;
  matchSummary: {
    jdMatchPercentage: number;
    scoreCalculationVersion: string;
    skillScore: number;
    experienceScore: number;
    domainScore: number;
    seniorityScore: number;
    skills: SkillEvidenceItem[];
    experienceCheck: {
      passed: boolean;
      summary: string;
    };
    locationCheck: {
      passed: boolean;
      summary: string;
    };
    complianceCheck: {
      passed: boolean;
      summary: string;
    };
    parsingWarnings: string[];
    lastAnalysisAt: string;
    resumeVersion: string;
    resumeHashPrefix: string;
  };
  validationInterview: {
    scheduledAt: string;
    durationMinutes: number;
    meetingLink: string;
    status: 'not_scheduled' | 'scheduled' | 'completed' | 'cancelled' | 'no_show';
    interviewerName: string;
    questions: ValidationQuestionItem[];
    ratings: ValidationInterviewRatings;
  };
  followUp: {
    routeType: 'vendor' | 'direct_candidate';
    vendorOrgId?: string | null;
    vendorOrgName?: string | null;
    requestType: 'updated_resume' | 'skill_clarification' | 'project_evidence';
    status: 'none' | 'pending_vendor' | 'pending_candidate' | 'responded' | 'recalculated';
    targetSkills: string[];
    recruiterInstructions: string;
    requestedAt?: string;
    requestedBy?: string;
    responseNotes?: string;
    respondedAt?: string;
    respondedBy?: string;
    updatedResumeVersion?: string;
  };
  clientPackage: {
    packageId: string;
    recipientClientOrgName: string;
    executiveSummary: string;
    disclosedGapsAndLimitations: string;
    complianceAndConsentConfirmed: boolean;
    generatedAt?: string;
    submittedToClientAt?: string;
    submittedBy?: string;
    status: 'draft' | 'ready' | 'submitted_to_client';
  };
  resumeVersions: Array<{
    version: string;
    uploadedAt: string;
    uploadedBy: string;
    resumeHash: string;
    matchScoreAtVersion: number;
    notes: string;
  }>;
  decisionHistory: Array<{
    id: string;
    fromStage: ValidationDecisionStage;
    toStage: ValidationDecisionStage;
    actorName: string;
    actorRole: string;
    reason: string;
    isOverride: boolean;
    timestamp: string;
  }>;
  decision_gate: ValidationDecisionStage;
  jd_match_percentage: number;
  resume_version_used: string;
  skill_evidence: Array<{
    skill: string;
    status: 'matched_in_resume' | 'not_found_in_resume' | 'unclear' | 'candidate_confirmed' | 'recruiter_verified';
  }>;
  validation_interview: {
    status: string;
    ratings: {
      communication: number;
      technical_assessment: number;
      skill_gap_validation: number;
      overall_recommendation: number;
    } | null;
  } | null;
  follow_up_requests: Array<{
    id: string;
    target: 'vendor' | 'direct_candidate';
    status: 'requested' | 'responded' | 'verified';
    missing_skills: string[];
  }>;
}

const VALIDATION_STORAGE_KEY = 'hirenest_submission_validations_v2';

function loadLocalValidationMap(): Record<string, SubmissionValidationRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VALIDATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalValidationMap(map: Record<string, SubmissionValidationRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function hydrateCompatFields(record: SubmissionValidationRecord): SubmissionValidationRecord {
  const r = record.validationInterview?.ratings || {
    communicationRating: 0,
    technicalRating: 0,
    skillGapValidationRating: 0,
    overallRecommendationRating: 0,
    summaryNotes: '',
    communication: 0,
    technical_assessment: 0,
    skill_gap_validation: 0,
    overall_recommendation: 0,
  };

  const normalizedRatings: ValidationInterviewRatings = {
    ...r,
    communication: r.communicationRating || r.communication || 0,
    technical_assessment: r.technicalRating || r.technical_assessment || 0,
    skill_gap_validation: r.skillGapValidationRating || r.skill_gap_validation || 0,
    overall_recommendation:
      r.overallRecommendationRating || r.overall_recommendation || 0,
  };

  const hasRatings =
    normalizedRatings.communication > 0 ||
    normalizedRatings.technical_assessment > 0 ||
    normalizedRatings.skill_gap_validation > 0 ||
    normalizedRatings.overall_recommendation > 0;

  const mappedSkillEvidence = (record.matchSummary?.skills || []).map((s) => ({
    skill: s.skill,
    status: (s.status === 'matched'
      ? 'matched_in_resume'
      : s.status === 'not_found'
        ? 'not_found_in_resume'
        : s.status) as
      | 'matched_in_resume'
      | 'not_found_in_resume'
      | 'unclear'
      | 'candidate_confirmed'
      | 'recruiter_verified',
  }));

  const followUpStatus = record.followUp?.status || 'none';
  const followUpList =
    followUpStatus === 'none'
      ? []
      : [
          {
            id: `fu_${record.submissionId}`,
            target: record.followUp.routeType,
            status: (followUpStatus === 'recalculated'
              ? 'verified'
              : followUpStatus === 'responded'
                ? 'responded'
                : 'requested') as 'requested' | 'responded' | 'verified',
            missing_skills: record.followUp.targetSkills || [],
          },
        ];

  return {
    ...record,
    validationInterview: {
      ...record.validationInterview,
      ratings: normalizedRatings,
    },
    decision_gate: record.validationStage,
    jd_match_percentage: record.matchSummary?.jdMatchPercentage ?? 0,
    resume_version_used: record.matchSummary?.resumeVersion || 'v1.0',
    skill_evidence: mappedSkillEvidence,
    validation_interview:
      record.validationInterview?.status && record.validationInterview.status !== 'not_scheduled'
        ? {
            status: record.validationInterview.status,
            ratings: hasRatings ? normalizedRatings : null,
          }
        : hasRatings
          ? {
              status: 'completed',
              ratings: normalizedRatings,
            }
          : null,
    follow_up_requests: followUpList,
  };
}

function buildDefaultQuestionsForSkills(
  missingOrUnclearSkills: string[],
  matchedSkills: string[],
  requirementTitle: string
): ValidationQuestionItem[] {
  const targets =
    missingOrUnclearSkills.length > 0
      ? missingOrUnclearSkills.slice(0, 4)
      : matchedSkills.slice(0, 3);

  if (targets.length === 0) {
    return [
      {
        id: 'vq_default_1',
        targetSkill: 'Core Technical Architecture',
        question: `Walk through your most recent production project relevant to ${requirementTitle} and your direct technical ownership.`,
        candidateAnswer: '',
        recruiterNotes: '',
        evidenceRecorded: '',
        skillVerified: false,
      },
    ];
  }

  return targets.map((sk, idx) => {
    const isGap = missingOrUnclearSkills.includes(sk);
    return {
      id: `vq_${idx + 1}_${sk.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      targetSkill: sk,
      question: isGap
        ? `"${sk}" is required for ${requirementTitle} but is not explicitly detailed on your resume. Have you used ${sk} in production, and can you describe a specific implementation or workflow you built?`
        : `Your resume lists "${sk}". Can you describe the scale, architecture, and toughest production issue you resolved using ${sk}?`,
      candidateAnswer: '',
      recruiterNotes: '',
      evidenceRecorded: '',
      skillVerified: false,
    };
  });
}

export function buildSubmissionValidationRecord(
  submission: Submission,
  existing?: SubmissionValidationRecord | null
): SubmissionValidationRecord {
  const req = submission.requirements;
  const cand = submission.candidates;

  const reqSkills = req?.skills || [];
  const candSkills = cand?.skills || [];
  const candSummary = cand?.summary || '';

  const fineTuned = computeFineTunedCandidateMatch(
    {
      id: req?.id || submission.requirement_id,
      title: req?.title || '',
      description: req?.description || '',
      skills: reqSkills,
      min_experience: req?.min_experience ?? 0,
      max_experience: req?.max_experience ?? 10,
    },
    {
      ...(cand || {}),
      id: cand?.id || submission.candidate_id,
      user_id: cand?.user_id || null,
      full_name: cand?.full_name || 'Candidate',
      current_title: cand?.current_title || '',
      summary: candSummary,
      skills: candSkills,
      total_experience_years: cand?.total_experience_years ?? 0,
      location: cand?.location || null,
      resume_path: cand?.resume_path || null,
      resume_hash: cand?.resume_hash || null,
      parsed_data: cand?.parsed_data ?? null,
      original_source: cand?.original_source || 'internal',
      source_vendor_org_id: cand?.source_vendor_org_id || null,
      owner_vendor_org_id: cand?.owner_vendor_org_id || null,
      created_by: cand?.created_by || null,
      created_at: cand?.created_at || submission.created_at,
      updated_at: cand?.updated_at || submission.updated_at,
    }
  );
  const matchCalc = {
    finalScore: fineTuned.final_score,
    skillScore: fineTuned.skill_score,
    experienceScore: fineTuned.experience_score,
    domainScore: fineTuned.domain_score,
    seniorityScore: fineTuned.seniority_score,
    matchedSkills: fineTuned.matched_skills,
    experienceNote: fineTuned.experience_note,
  };

  const existingSkillsMap = new Map<string, SkillEvidenceItem>();
  if (existing?.matchSummary?.skills) {
    for (const item of existing.matchSummary.skills) {
      existingSkillsMap.set(item.skill.toLowerCase().trim(), item);
    }
  }

  const matchedLower = new Set(matchCalc.matchedSkills.map((s) => s.toLowerCase().trim()));

  const skillsMatrix: SkillEvidenceItem[] = reqSkills.map((sk, idx) => {
    const key = sk.toLowerCase().trim();
    const prev = existingSkillsMap.get(key);
    const category: 'mandatory' | 'preferred' =
      idx < Math.max(1, Math.ceil(reqSkills.length * 0.7)) ? 'mandatory' : 'preferred';

    if (prev && (prev.status === 'recruiter_verified' || prev.status === 'candidate_confirmed')) {
      return { ...prev, category };
    }

    if (matchedLower.has(key)) {
      const inSummary = candSummary.toLowerCase().includes(key);
      return {
        skill: sk,
        category,
        status: 'matched',
        resumeSection: inSummary ? 'Professional Summary & Project History' : 'Extracted Skills & Experience',
        evidenceSnippet: inSummary
          ? `Resume summary explicitly references "${sk}" in project context.`
          : `Verified in parsed candidate skill inventory (${cand?.total_experience_years ?? 0} yrs total experience).`,
      };
    }

    const partialInSummary =
      candSummary.toLowerCase().includes(key.split(' ')[0]) && key.split(' ').length > 1;

    return {
      skill: sk,
      category,
      status: partialInSummary ? 'unclear' : 'not_found',
      resumeSection: partialInSummary ? 'Work History (Partial Mention)' : 'Not Found in Resume',
      evidenceSnippet: partialInSummary
        ? `Adjacent terminology detected in summary, but direct hands-on proficiency in "${sk}" is unclear.`
        : `No explicit mention of "${sk}" in resume text. Not definitive proof of absence — validate in interview or follow-up.`,
    };
  });

  const expYears = Number(cand?.total_experience_years ?? 0);
  const minExp = Number(req?.min_experience ?? 0);
  const maxExp = Number(req?.max_experience ?? 20);
  const expPassed = expYears >= minExp;

  const candLoc = (cand?.location || '').toLowerCase();
  const reqLoc = (req?.location || '').toLowerCase();
  const isRemote = req?.work_mode === 'remote' || reqLoc.includes('remote');
  const locPassed =
    isRemote || !reqLoc || !candLoc || candLoc.includes(reqLoc.split(',')[0].trim());

  const missingOrUnclear = skillsMatrix
    .filter((s) => s.status === 'not_found' || s.status === 'unclear')
    .map((s) => s.skill);

  const warnings: string[] = [];
  if (missingOrUnclear.length > 0) {
    warnings.push(
      `${missingOrUnclear.length} JD skill(s) (${missingOrUnclear.slice(0, 4).join(', ')}) not explicitly proven in resume text.`
    );
  }
  if (!cand?.resume_path && !cand?.resume_hash) {
    warnings.push('Structured profile parsed without attached PDF/DOCX binary digest.');
  }
  if (!expPassed) {
    warnings.push(`Candidate experience (${expYears}y) is below requirement minimum (${minExp}y).`);
  }

  let initialStage: ValidationDecisionStage = existing?.validationStage || 'recruiter_review';
  if (!existing) {
    if (
      submission.stage === 'client_review' ||
      submission.stage === 'interviewing' ||
      submission.stage === 'offered' ||
      submission.stage === 'offer_accepted' ||
      submission.stage === 'onboarded'
    ) {
      initialStage = 'submitted_to_client';
    } else if (submission.stage === 'rejected') {
      initialStage = 'rejected';
    } else if (submission.stage === 'applied') {
      initialStage = 'matched';
    } else {
      initialStage = 'recruiter_review';
    }
  }

  const isVendorOwned =
    submission.source === 'vendor' ||
    cand?.original_source === 'vendor' ||
    Boolean(submission.vendor_org_id || cand?.owner_vendor_org_id);

  const vendorOrgName =
    submission.organizations?.name ||
    cand?.owner_vendor?.name ||
    cand?.source_vendor?.name ||
    null;

  const hashPrefix = cand?.resume_hash ? cand.resume_hash.slice(0, 10) : 'sha256-v1';
  const defaultScheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  const built: SubmissionValidationRecord = {
    submissionId: submission.id,
    candidateId: submission.candidate_id,
    requirementId: submission.requirement_id,
    validationStage: initialStage,
    approvedBy: existing?.approvedBy,
    approvedAt: existing?.approvedAt,
    overrideReason: existing?.overrideReason,
    overriddenBy: existing?.overriddenBy,
    overriddenAt: existing?.overriddenAt,
    matchSummary: {
      jdMatchPercentage: existing?.matchSummary?.jdMatchPercentage ?? matchCalc.finalScore,
      scoreCalculationVersion: 'HireNest-Deterministic-v2.4 + Gemini-Evidence',
      skillScore: matchCalc.skillScore,
      experienceScore: matchCalc.experienceScore,
      domainScore: matchCalc.domainScore,
      seniorityScore: matchCalc.seniorityScore,
      skills: skillsMatrix,
      experienceCheck: {
        passed: expPassed,
        summary: `${expYears} yrs candidate experience vs ${minExp}–${maxExp} yrs required (${matchCalc.experienceNote}).`,
      },
      locationCheck: {
        passed: locPassed,
        summary: `${cand?.location || 'Unspecified'} vs ${req?.location || 'Any'} (${req?.work_mode || 'hybrid'}).`,
      },
      complianceCheck: {
        passed: Boolean(submission.is_valid),
        summary: submission.is_valid
          ? 'Submission valid · DPDP Notice v2.4.0 & ownership verified'
          : `Invalid flag: ${submission.invalid_reason || 'Compliance hold'}`,
      },
      parsingWarnings: warnings,
      lastAnalysisAt: existing?.matchSummary?.lastAnalysisAt || new Date().toISOString(),
      resumeVersion: existing?.matchSummary?.resumeVersion || 'v1.0',
      resumeHashPrefix: hashPrefix,
    },
    validationInterview: existing?.validationInterview || {
      scheduledAt: defaultScheduledAt,
      durationMinutes: 15,
      meetingLink: `https://meet.google.com/hn-${submission.id.slice(0, 4)}-${submission.candidate_id.slice(0, 4)}`,
      status: 'not_scheduled',
      interviewerName: 'HireNest Lead Technical Recruiter',
      questions: buildDefaultQuestionsForSkills(
        missingOrUnclear,
        matchCalc.matchedSkills,
        req?.title || 'Requirement'
      ),
      ratings: {
        communicationRating: 0,
        technicalRating: 0,
        skillGapValidationRating: 0,
        overallRecommendationRating: 0,
        summaryNotes: '',
        communication: 0,
        technical_assessment: 0,
        skill_gap_validation: 0,
        overall_recommendation: 0,
      },
    },
    followUp: existing?.followUp || {
      routeType: isVendorOwned ? 'vendor' : 'direct_candidate',
      vendorOrgId: submission.vendor_org_id || cand?.owner_vendor_org_id || null,
      vendorOrgName,
      requestType: 'skill_clarification',
      status: 'none',
      targetSkills: missingOrUnclear,
      recruiterInstructions:
        missingOrUnclear.length > 0
          ? `Please provide updated resume evidence or written project clarification for: ${missingOrUnclear.join(', ')}.`
          : 'Please confirm candidate availability, notice period, and project evidence for client submission.',
    },
    clientPackage: existing?.clientPackage || {
      packageId: `pkg_${submission.id.slice(0, 8)}`,
      recipientClientOrgName: req?.organizations?.name || 'Client Hiring Team',
      executiveSummary: `${cand?.full_name || 'Candidate'} (${expYears} yrs exp) matched at ${matchCalc.finalScore}% for ${req?.title || 'Requirement'}. Core matched skills: ${matchCalc.matchedSkills.join(', ') || 'See skill matrix'}.`,
      disclosedGapsAndLimitations:
        missingOrUnclear.length > 0
          ? `Skills requiring client interview probing or clarification: ${missingOrUnclear.join(', ')}.`
          : 'All mandatory JD skills verified with supporting evidence.',
      complianceAndConsentConfirmed: true,
      status: initialStage === 'submitted_to_client' ? 'submitted_to_client' : 'draft',
    },
    resumeVersions: existing?.resumeVersions || [
      {
        version: 'v1.0',
        uploadedAt: cand?.created_at || submission.created_at,
        uploadedBy: isVendorOwned ? vendorOrgName || 'Vendor Partner' : 'Admin / Candidate',
        resumeHash: hashPrefix,
        matchScoreAtVersion: matchCalc.finalScore,
        notes: 'Initial resume parsed & indexed against requirement JD.',
      },
    ],
    decisionHistory: existing?.decisionHistory || [
      {
        id: `log_init_${submission.id.slice(0, 6)}`,
        fromStage: 'matched',
        toStage: initialStage,
        actorName: 'HireNest Validation Engine',
        actorRole: 'system',
        reason: `Initial explainable JD match (${matchCalc.finalScore}%) computed across ${reqSkills.length} requirement skills.`,
        isOverride: false,
        timestamp: submission.created_at,
      },
    ],
    decision_gate: initialStage,
    jd_match_percentage: existing?.matchSummary?.jdMatchPercentage ?? matchCalc.finalScore,
    resume_version_used: existing?.matchSummary?.resumeVersion || 'v1.0',
    skill_evidence: [],
    validation_interview: null,
    follow_up_requests: [],
  };

  return hydrateCompatFields(built);
}

export function getSubmissionValidationLocal(
  submissionId?: string | null
): SubmissionValidationRecord | null {
  if (!submissionId) return null;
  const map = loadLocalValidationMap();
  const rec = map[submissionId];
  return rec ? hydrateCompatFields(rec) : null;
}

export function getOrBuildValidationRecord(
  submission: Submission,
  _match?: unknown
): SubmissionValidationRecord {
  const map = loadLocalValidationMap();
  const cached = map[submission.id];
  const record = buildSubmissionValidationRecord(submission, cached);
  if (!cached) {
    map[submission.id] = record;
    saveLocalValidationMap(map);
  }
  return record;
}

export async function fetchSubmissionValidationApi(
  submission: Submission
): Promise<SubmissionValidationRecord> {
  const localMap = loadLocalValidationMap();
  const localCached = localMap[submission.id];

  try {
    const res = await fetch(`/api/submissions/validation/${encodeURIComponent(submission.id)}`);
    if (res.ok) {
      const json = await res.json();
      if (json?.validation) {
        const merged = buildSubmissionValidationRecord(
          submission,
          json.validation as SubmissionValidationRecord
        );
        localMap[submission.id] = merged;
        saveLocalValidationMap(localMap);
        return merged;
      }
    }
  } catch {
    // Fallback to local record when offline
  }

  const built = buildSubmissionValidationRecord(submission, localCached);
  localMap[submission.id] = built;
  saveLocalValidationMap(localMap);
  return built;
}

export async function saveSubmissionValidationApi(
  record: SubmissionValidationRecord,
  actor?: { name: string; role: string; action: string }
): Promise<SubmissionValidationRecord> {
  const normalized = hydrateCompatFields(record);
  const localMap = loadLocalValidationMap();
  localMap[normalized.submissionId] = normalized;
  saveLocalValidationMap(localMap);

  try {
    await fetch('/api/submissions/validation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: normalized.submissionId,
        validation: normalized,
        actor,
      }),
    });
  } catch {
    // Saved in localStorage as immediate resilient store
  }

  return normalized;
}

export async function fetchAllValidationRecordsFromBackend(): Promise<
  Record<string, SubmissionValidationRecord>
> {
  const localMap = loadLocalValidationMap();
  try {
    const res = await fetch('/api/submissions/validation');
    if (res.ok) {
      const json = await res.json();
      if (json?.validations && typeof json.validations === 'object') {
        for (const [subId, val] of Object.entries(json.validations)) {
          if (val && typeof val === 'object') {
            localMap[subId] = hydrateCompatFields(val as SubmissionValidationRecord);
          }
        }
        saveLocalValidationMap(localMap);
      }
    }
  } catch {
    // Ignore network errors and use localMap
  }
  return localMap;
}
