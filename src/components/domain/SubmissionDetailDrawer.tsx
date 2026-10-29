import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  Drawer,
  Button,
  Badge,
  Dialog,
  Input,
  Select,
  Tabs,
  Textarea,
  Skeleton,
   type BadgeTone,
} from '../ui/kit';
import {
  SourceBadge,
  StageBadge,
  VendorAssociationBadge,
  ScoreBar,
} from './DomainBadges';
import {
  ScheduleInterviewModal,
  InterviewFeedbackModal,
  CandidateQualityModal,
  ScreeningInterviewRunnerModal,
} from './InterviewModals';
import {
  fetchSubmissionById,
  fetchSubmissionStageHistory,
  getAllowedTransitions,
  transitionRequiresReason,
  transitionSubmissionRpc,
  markSubmissionInvalidRpc,
} from '../../api/submissions';
import {
  fetchInterviews,
  fetchQualityFeedbackList,
  updateInterviewStatusRpc,
} from '../../api/interviews';
import {
  RATING_CRITERIA_GUIDE,
  SKILL_EVIDENCE_STATUS_LABELS,
  VALIDATION_STAGE_LABELS,
  VALIDATION_STAGE_ORDER,
  buildSubmissionValidationRecord,
  fetchSubmissionValidationApi,
  saveSubmissionValidationApi,
  type SkillEvidenceStatus,
  type SubmissionValidationRecord,
  type ValidationDecisionStage,
  type ValidationQuestionItem,
} from '../../lib/recruiterValidation';
import {
  STAGE_LABELS,
  CANDIDATE_STAGE_LABELS,
  ROUND_LABELS,
  formatLocalDateTime,
} from '../../lib/format';
import {
  OFFER_LIFECYCLE_LABELS,
  OFFER_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  getContractContactPolicy,
  getOrBuildOfferOnboardingRecord,
} from '../../lib/offerOnboarding';
import { mapSupabaseError } from '../../lib/errors';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../ui/Toast';
import type { AppRole, Interview, SubmissionStage } from '../../types/db';

const SKILL_STATUS_TONES: Record<SkillEvidenceStatus, BadgeTone> = {
  matched: 'emerald',
  recruiter_verified: 'teal',
  candidate_confirmed: 'sky',
  unclear: 'amber',
  not_found: 'neutral',
};

const VALIDATION_STAGE_TONES: Record<ValidationDecisionStage, BadgeTone> = {
  matched: 'neutral',
  recruiter_review: 'storm_blue',
  validation_interview_scheduled: 'sky',
  interview_completed: 'teal',
  approved_for_submission: 'emerald',
  hold_for_clarification: 'amber',
  rejected: 'red',
  submitted_to_client: 'rich_blue',
};

export const SubmissionDetailDrawer: React.FC<{
  submissionId: string | null;
  onClose: () => void;
  role?: AppRole;
  onUpdated?: () => void;
}> = ({ submissionId, onClose, role: propRole, onUpdated }) => {
  const { profile } = useAuth();
  const role: AppRole = propRole || profile?.role || 'recruiter';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';
  const isCandidate = role === 'candidate';

  const [activeTab, setActiveTab] = useState<
    'match_summary' | 'validation_interview' | 'followup' | 'decision_gate' | 'pipeline_history'
  >('match_summary');

  const [targetStage, setTargetStage] = useState<SubmissionStage | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [transitionLoading, setTransitionLoading] = useState(false);

  const [markInvalidOpen, setMarkInvalidOpen] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  const [invalidLoading, setInvalidLoading] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackInterview, setFeedbackInterview] = useState<Interview | null>(null);
  const [screeningInterview, setScreeningInterview] = useState<Interview | null>(null);
  const [qualityModalOpen, setQualityModalOpen] = useState(false);

  // Recruiter Validation State
  const [valRecord, setValRecord] = useState<SubmissionValidationRecord | null>(null);
  const [savingVal, setSavingVal] = useState(false);
  const [generatingAiQuestions, setGeneratingAiQuestions] = useState(false);
  const [newCustomSkill, setNewCustomSkill] = useState('');
  const [newCustomQuestion, setNewCustomQuestion] = useState('');

  // Decision Gate Transition & Override state
  const [pendingDecisionStage, setPendingDecisionStage] =
    useState<ValidationDecisionStage | null>(null);
  const [decisionReasonInput, setDecisionReasonInput] = useState('');

  // Follow-up response state (for Vendor / Direct Candidate / Recruiter)
  const [followUpResponseNotes, setFollowUpResponseNotes] = useState('');
  const [followUpNewVersion, setFollowUpNewVersion] = useState('v2.0');

  const { data: submission, isLoading } = useQuery({
    queryKey: ['submission_detail', submissionId],
    queryFn: () => fetchSubmissionById(submissionId!),
    enabled: Boolean(submissionId),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['submission_history', submissionId],
    queryFn: () => fetchSubmissionStageHistory(submissionId!),
    enabled: Boolean(submissionId),
  });

  const { data: interviewsData } = useQuery({
    queryKey: ['submission_interviews', submissionId],
    queryFn: () => fetchInterviews({ submissionId: submissionId! }),
    enabled: Boolean(submissionId),
  });

  const { data: qualityData } = useQuery({
    queryKey: ['submission_quality_feedback', submissionId],
    queryFn: () => fetchQualityFeedbackList({ submissionId: submissionId! }),
    enabled: Boolean(submissionId),
  });

  useEffect(() => {
    if (!submission) {
      setValRecord(null);
      return;
    }
    let cancelled = false;
    fetchSubmissionValidationApi(submission).then((loaded) => {
      if (!cancelled) {
        setValRecord(loaded);
        setFollowUpResponseNotes(loaded.followUp.responseNotes || '');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [submission]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['submission_detail', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_history', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_interviews', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_quality_feedback', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submissions'] });
    queryClient.invalidateQueries({ queryKey: ['submission_validations_map'] });
    queryClient.invalidateQueries({ queryKey: ['offers-onboarding-workspace'] });
    queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
    onUpdated?.();
  };

  const persistValidation = async (
    nextRecord: SubmissionValidationRecord,
    actionLabel: string,
    toastTitle?: string
  ) => {
    setSavingVal(true);
    try {
      const saved = await saveSubmissionValidationApi(nextRecord, {
        name: profile?.full_name || profile?.email || role,
        role,
        action: actionLabel,
      });
      setValRecord(saved);
      queryClient.invalidateQueries({ queryKey: ['submission_validations_map'] });
      if (toastTitle) {
        toast({ title: toastTitle, tone: 'success' });
      }
    } finally {
      setSavingVal(false);
    }
  };

  // Recalculate JD match incorporating verified/confirmed skills
  const recomputeMatchSummary = (
    baseRecord: SubmissionValidationRecord,
    bumpVersion?: string
  ): SubmissionValidationRecord => {
    if (!submission) return baseRecord;
    const skills = baseRecord.matchSummary.skills;
    const verifiedCount = skills.filter(
      (s) =>
        s.status === 'matched' ||
        s.status === 'recruiter_verified' ||
        s.status === 'candidate_confirmed'
    ).length;
    const nextSkillScore =
      skills.length > 0
        ? Math.round((verifiedCount / skills.length) * 100)
        : baseRecord.matchSummary.skillScore;
    const nextJdMatch = Math.min(
      100,
      Math.round(
        0.4 * nextSkillScore +
          0.25 * baseRecord.matchSummary.experienceScore +
          0.2 * baseRecord.matchSummary.domainScore +
          0.15 * baseRecord.matchSummary.seniorityScore
      )
    );
    const missingNow = skills
      .filter((s) => s.status === 'not_found' || s.status === 'unclear')
      .map((s) => s.skill);
    const nextWarnings =
      missingNow.length > 0
        ? [
            `${missingNow.length} JD skill(s) (${missingNow.slice(0, 4).join(', ')}) remain unverified - use validation interview or source follow-up.`,
          ]
        : ['All JD skills verified or confirmed with evidence.'];

    const nextVersion = bumpVersion || baseRecord.matchSummary.resumeVersion;
    const nextVersions = bumpVersion
      ? [
          {
            version: bumpVersion,
            uploadedAt: new Date().toISOString(),
            uploadedBy: profile?.full_name || role,
            resumeHash: `sha256-${Math.random().toString(36).slice(2, 10)}`,
            matchScoreAtVersion: nextJdMatch,
            notes: `Updated evidence / resume version (${bumpVersion}) analyzed.`,
          },
          ...baseRecord.resumeVersions,
        ]
      : baseRecord.resumeVersions;

    return {
      ...baseRecord,
      matchSummary: {
        ...baseRecord.matchSummary,
        jdMatchPercentage: nextJdMatch,
        skillScore: nextSkillScore,
        parsingWarnings: nextWarnings,
        lastAnalysisAt: new Date().toISOString(),
        resumeVersion: nextVersion,
      },
      resumeVersions: nextVersions,
    };
  };

  const handleUpdateSkillStatus = async (
    skillName: string,
    newStatus: SkillEvidenceStatus,
    newSnippet?: string
  ) => {
    if (!valRecord) return;
    const nextSkills = valRecord.matchSummary.skills.map((item) =>
      item.skill === skillName
        ? {
            ...item,
            status: newStatus,
            evidenceSnippet:
              newSnippet !== undefined
                ? newSnippet
                : newStatus === 'recruiter_verified'
                  ? `Verified by ${profile?.full_name || 'Recruiter'} during validation review.`
                  : newStatus === 'candidate_confirmed'
                    ? `Confirmed via candidate/vendor follow-up evidence.`
                    : item.evidenceSnippet,
            verifiedBy: profile?.full_name || profile?.email || role,
            verifiedAt: new Date().toISOString(),
          }
        : item
    );
    const updated = recomputeMatchSummary({
      ...valRecord,
      matchSummary: {
        ...valRecord.matchSummary,
        skills: nextSkills,
      },
    });
    await persistValidation(
      updated,
      'verify_skill_evidence',
      `Updated "${skillName}" to ${SKILL_EVIDENCE_STATUS_LABELS[newStatus]}`
    );
  };

  const handleScheduleValidationInterview = async () => {
    if (!valRecord) return;
    const nextStage: ValidationDecisionStage =
      valRecord.validationStage === 'matched' || valRecord.validationStage === 'recruiter_review'
        ? 'validation_interview_scheduled'
        : valRecord.validationStage;

    const logEntry = {
      id: `log_${Date.now()}`,
      fromStage: valRecord.validationStage,
      toStage: nextStage,
      actorName: profile?.full_name || 'Recruiter',
      actorRole: role,
      reason: `Scheduled ${valRecord.validationInterview.durationMinutes}-min validation interview for ${valRecord.validationInterview.scheduledAt}.`,
      isOverride: false,
      timestamp: new Date().toISOString(),
    };

    const next: SubmissionValidationRecord = {
      ...valRecord,
      validationStage: nextStage,
      validationInterview: {
        ...valRecord.validationInterview,
        status: 'scheduled',
      },
      decisionHistory: [logEntry, ...valRecord.decisionHistory],
    };
    await persistValidation(
      next,
      'schedule_validation_interview',
      'Validation interview scheduled (10–15 min technical & gap screen)'
    );
  };

  const handleCompleteValidationInterview = async () => {
    if (!valRecord) return;
    const r = valRecord.validationInterview.ratings;
    if (
      !r.communicationRating ||
      !r.technicalRating ||
      !r.skillGapValidationRating ||
      !r.overallRecommendationRating
    ) {
      toast({
        title: 'Complete all 1–5 ratings first',
        description:
          'Communication, Technical, Skill-Gap, and Overall Recommendation ratings (1–5) are required to complete the validation interview.',
        tone: 'error',
      });
      return;
    }

    // Automatically mark any question where skillVerified=true as recruiter_verified in matchSummary
    const verifiedFromQuestions = new Map<string, string>();
    for (const q of valRecord.validationInterview.questions) {
      if (q.skillVerified && q.targetSkill) {
        verifiedFromQuestions.set(
          q.targetSkill.toLowerCase().trim(),
          q.evidenceRecorded || q.candidateAnswer || 'Verified during validation interview.'
        );
      }
    }

    const updatedSkills = valRecord.matchSummary.skills.map((sk) => {
      const key = sk.skill.toLowerCase().trim();
      if (verifiedFromQuestions.has(key)) {
        return {
          ...sk,
          status: 'recruiter_verified' as SkillEvidenceStatus,
          evidenceSnippet: `Validation Interview Evidence: ${verifiedFromQuestions.get(key)}`,
          verifiedBy: profile?.full_name || 'Recruiter',
          verifiedAt: new Date().toISOString(),
        };
      }
      return sk;
    });

    const nextStage: ValidationDecisionStage = 'interview_completed';
    const logEntry = {
      id: `log_${Date.now()}`,
      fromStage: valRecord.validationStage,
      toStage: nextStage,
      actorName: profile?.full_name || 'Recruiter',
      actorRole: role,
      reason: `Validation interview completed · Comm ${r.communicationRating}/5 · Tech ${r.technicalRating}/5 · Gap ${r.skillGapValidationRating}/5 · Rec ${r.overallRecommendationRating}/5.`,
      isOverride: false,
      timestamp: new Date().toISOString(),
    };

    const next = recomputeMatchSummary({
      ...valRecord,
      validationStage: nextStage,
      matchSummary: {
        ...valRecord.matchSummary,
        skills: updatedSkills,
      },
      validationInterview: {
        ...valRecord.validationInterview,
        status: 'completed',
        ratings: {
          ...r,
          assessedBy: profile?.full_name || profile?.email || 'Recruiter',
          assessedAt: new Date().toISOString(),
        },
      },
      decisionHistory: [logEntry, ...valRecord.decisionHistory],
    });

    await persistValidation(
      next,
      'complete_validation_interview',
      'Validation interview completed & recruiter ratings saved'
    );
  };

  const handleGenerateAiValidationQuestions = async () => {
    if (!valRecord || !submission) return;
    setGeneratingAiQuestions(true);
    try {
      const missingSkills = valRecord.matchSummary.skills
        .filter((s) => s.status === 'not_found' || s.status === 'unclear')
        .map((s) => s.skill);
      const matchedSkills = valRecord.matchSummary.skills
        .filter((s) => s.status === 'matched')
        .map((s) => s.skill);

      const res = await fetch('/api/submissions/validation-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missingSkills,
          matchedSkills,
          requirementTitle: submission.requirements?.title || 'Target Role',
          candidateName: submission.candidates?.full_name || 'Candidate',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.questions) && data.questions.length > 0) {
          const next: SubmissionValidationRecord = {
            ...valRecord,
            validationInterview: {
              ...valRecord.validationInterview,
              questions: data.questions as ValidationQuestionItem[],
            },
          };
          await persistValidation(
            next,
            'generate_validation_questions',
            `Generated ${data.questions.length} targeted validation questions`
          );
        }
      }
    } catch {
      toast({ title: 'Could not generate questions', tone: 'error' });
    } finally {
      setGeneratingAiQuestions(false);
    }
  };

  const handleAddCustomQuestion = async () => {
    if (!valRecord || !newCustomQuestion.trim()) return;
    const item: ValidationQuestionItem = {
      id: `vq_custom_${Date.now()}`,
      targetSkill: newCustomSkill.trim() || 'Technical Validation',
      question: newCustomQuestion.trim(),
      candidateAnswer: '',
      recruiterNotes: '',
      evidenceRecorded: '',
      skillVerified: false,
    };
    const next: SubmissionValidationRecord = {
      ...valRecord,
      validationInterview: {
        ...valRecord.validationInterview,
        questions: [...valRecord.validationInterview.questions, item],
      },
    };
    setNewCustomSkill('');
    setNewCustomQuestion('');
    await persistValidation(next, 'add_custom_question', 'Custom validation question added');
  };

  const handleDecisionGateTransition = async () => {
    if (!valRecord || !pendingDecisionStage || !submission) return;

    const r = valRecord.validationInterview.ratings;
    const isLowScoreApproval =
      pendingDecisionStage === 'approved_for_submission' &&
      (valRecord.matchSummary.jdMatchPercentage < 60 ||
        (r.technicalRating > 0 && r.technicalRating < 3) ||
        valRecord.validationInterview.status !== 'completed');

    const requiresReason =
      isLowScoreApproval ||
      pendingDecisionStage === 'rejected' ||
      pendingDecisionStage === 'hold_for_clarification';

    if (requiresReason && !decisionReasonInput.trim()) {
      toast({
        title: isLowScoreApproval ? 'Override reason required' : 'Decision reason required',
        description: isLowScoreApproval
          ? 'Approving before interview completion or with a low match/technical score requires a documented recruiter override reason.'
          : 'Please document the reason for this decision.',
        tone: 'error',
      });
      return;
    }

    const logEntry = {
      id: `log_${Date.now()}`,
      fromStage: valRecord.validationStage,
      toStage: pendingDecisionStage,
      actorName: profile?.full_name || profile?.email || 'Recruiter',
      actorRole: role,
      reason:
        decisionReasonInput.trim() ||
        `Recruiter moved submission to ${VALIDATION_STAGE_LABELS[pendingDecisionStage]}.`,
      isOverride: isLowScoreApproval,
      timestamp: new Date().toISOString(),
    };

    const verifiedSkillsList = valRecord.matchSummary.skills
      .filter((s) => s.status === 'matched' || s.status === 'recruiter_verified' || s.status === 'candidate_confirmed')
      .map((s) => s.skill);
    const gapSkillsList = valRecord.matchSummary.skills
      .filter((s) => s.status === 'not_found' || s.status === 'unclear')
      .map((s) => s.skill);

    const autoSummary = `${submission.candidates?.full_name || 'Candidate'} (${
      submission.candidates?.total_experience_years ?? 0
    } yrs exp) validated for ${submission.requirements?.title || 'Requirement'}. JD Match: ${
      valRecord.matchSummary.jdMatchPercentage
    }% (${valRecord.matchSummary.resumeVersion}). Verified skills: ${
      verifiedSkillsList.join(', ') || 'Core stack'
    }. Recruiter ratings: Comm ${r.communicationRating || '-'}/5, Tech ${
      r.technicalRating || '-'
    }/5, Skill-Gap ${r.skillGapValidationRating || '-'}/5, Overall ${
      r.overallRecommendationRating || '-'
    }/5.`;

    const next: SubmissionValidationRecord = {
      ...valRecord,
      validationStage: pendingDecisionStage,
      approvedBy:
        pendingDecisionStage === 'approved_for_submission'
          ? profile?.full_name || profile?.email || 'Recruiter'
          : valRecord.approvedBy,
      approvedAt:
        pendingDecisionStage === 'approved_for_submission'
          ? new Date().toISOString()
          : valRecord.approvedAt,
      overrideReason: isLowScoreApproval
        ? decisionReasonInput.trim()
        : valRecord.overrideReason,
      overriddenBy: isLowScoreApproval
        ? profile?.full_name || profile?.email || 'Recruiter'
        : valRecord.overriddenBy,
      overriddenAt: isLowScoreApproval ? new Date().toISOString() : valRecord.overriddenAt,
      clientPackage: {
        ...valRecord.clientPackage,
        packageId: valRecord.clientPackage.packageId || `pkg_${submission.id.slice(0, 8)}`,
        generatedAt: new Date().toISOString(),
        executiveSummary: valRecord.clientPackage.executiveSummary || autoSummary,
        disclosedGapsAndLimitations:
          gapSkillsList.length > 0
            ? `Accurate Client Disclosure: ${gapSkillsList.join(', ')} not explicitly detailed on resume; evaluate during client technical round.`
            : 'All mandatory JD skills verified with evidence during recruiter validation.',
        status:
          pendingDecisionStage === 'approved_for_submission'
            ? 'ready'
            : valRecord.clientPackage.status,
      },
      decisionHistory: [logEntry, ...valRecord.decisionHistory],
    };

    if (pendingDecisionStage === 'rejected' && submission.stage !== 'rejected') {
      await transitionSubmissionRpc({
        p_submission_id: submission.id,
        p_to: 'rejected',
        p_reason: decisionReasonInput.trim() || 'Rejected at Recruiter Validation Gate',
      }).catch(() => undefined);
    }

    setPendingDecisionStage(null);
    setDecisionReasonInput('');
    await persistValidation(
      next,
      'decision_gate_transition',
      `Decision gate updated to ${VALIDATION_STAGE_LABELS[pendingDecisionStage]}`
    );
    refreshAll();
  };

  const handleSendFollowUpRequest = async () => {
    if (!valRecord) return;
    const isVendorRoute = valRecord.followUp.routeType === 'vendor';
    const nextStatus = isVendorRoute ? 'pending_vendor' : 'pending_candidate';

    const logEntry = {
      id: `log_${Date.now()}`,
      fromStage: valRecord.validationStage,
      toStage: 'hold_for_clarification' as ValidationDecisionStage,
      actorName: profile?.full_name || 'Recruiter',
      actorRole: role,
      reason: isVendorRoute
        ? `Sent Vendor Gap Report (${valRecord.followUp.requestType}) to ${valRecord.followUp.vendorOrgName || 'Vendor Agency'}.`
        : `Routed Direct Candidate Clarification Request to candidate's authenticated portal.`,
      isOverride: false,
      timestamp: new Date().toISOString(),
    };

    const next: SubmissionValidationRecord = {
      ...valRecord,
      validationStage: 'hold_for_clarification',
      followUp: {
        ...valRecord.followUp,
        status: nextStatus,
        requestedAt: new Date().toISOString(),
        requestedBy: profile?.full_name || profile?.email || 'Recruiter',
      },
      decisionHistory: [logEntry, ...valRecord.decisionHistory],
    };

    await persistValidation(
      next,
      isVendorRoute ? 'vendor_followup' : 'direct_candidate_followup',
      isVendorRoute
        ? `Gap report & follow-up sent to ${valRecord.followUp.vendorOrgName || 'Vendor'}`
        : 'Clarification request routed to Direct Candidate portal'
    );
  };

  const handleRecordFollowUpResponseAndRecalculate = async () => {
    if (!valRecord || !followUpResponseNotes.trim()) {
      toast({
        title: 'Provide clarification / evidence response',
        description: 'Enter the skill evidence or updated resume summary before recalculating.',
        tone: 'error',
      });
      return;
    }

    // Mark target skills in followUp as candidate_confirmed
    const targetSet = new Set(
      valRecord.followUp.targetSkills.map((s) => s.toLowerCase().trim())
    );
    const updatedSkills = valRecord.matchSummary.skills.map((sk) => {
      if (targetSet.has(sk.skill.toLowerCase().trim()) && sk.status !== 'recruiter_verified') {
        return {
          ...sk,
          status: 'candidate_confirmed' as SkillEvidenceStatus,
          evidenceSnippet: `Follow-up Clarification (${followUpNewVersion}): ${followUpResponseNotes.trim()}`,
          verifiedBy: profile?.full_name || role,
          verifiedAt: new Date().toISOString(),
        };
      }
      return sk;
    });

    const nextWithSkills: SubmissionValidationRecord = {
      ...valRecord,
      validationStage: 'recruiter_review',
      matchSummary: {
        ...valRecord.matchSummary,
        skills: updatedSkills,
      },
      followUp: {
        ...valRecord.followUp,
        status: 'recalculated',
        responseNotes: followUpResponseNotes.trim(),
        respondedAt: new Date().toISOString(),
        respondedBy: profile?.full_name || role,
        updatedResumeVersion: followUpNewVersion,
      },
      decisionHistory: [
        {
          id: `log_${Date.now()}`,
          fromStage: valRecord.validationStage,
          toStage: 'recruiter_review',
          actorName: profile?.full_name || role,
          actorRole: role,
          reason: `Follow-up response received & match recalculated against resume ${followUpNewVersion}.`,
          isOverride: false,
          timestamp: new Date().toISOString(),
        },
        ...valRecord.decisionHistory,
      ],
    };

    const recalculated = recomputeMatchSummary(nextWithSkills, followUpNewVersion);
    await persistValidation(
      recalculated,
      'followup_response_recalculate',
      `Follow-up recorded & match recalculated (${recalculated.matchSummary.jdMatchPercentage}% on ${followUpNewVersion})`
    );
  };

  const handleFinalSubmitToClient = async () => {
    if (!valRecord || !submission) return;
    if (
      valRecord.validationStage !== 'approved_for_submission' &&
      valRecord.validationStage !== 'submitted_to_client'
    ) {
      toast({
        title: 'Recruiter approval required first',
        description:
          'A candidate must be explicitly Approved for Submission by an authorised recruiter before client submission.',
        tone: 'error',
      });
      return;
    }
    if (!submission.is_valid) {
      toast({
        title: 'Compliance check failed',
        description: 'Invalid submissions cannot be shared with the client.',
        tone: 'error',
      });
      return;
    }

    setSavingVal(true);
    try {
      if (submission.stage === 'applied') {
        await transitionSubmissionRpc({
          p_submission_id: submission.id,
          p_to: 'recruiter_review',
          p_reason: 'Recruiter validation completed',
        }).catch(() => undefined);
      }
      if (submission.stage === 'applied' || submission.stage === 'recruiter_review') {
        await transitionSubmissionRpc({
          p_submission_id: submission.id,
          p_to: 'client_review',
          p_reason: `Approved & submitted to client with validated evidence package (${valRecord.matchSummary.jdMatchPercentage}% JD match, ${valRecord.matchSummary.resumeVersion})`,
        }).catch(() => undefined);
      }

      const nowIso = new Date().toISOString();
      const next: SubmissionValidationRecord = {
        ...valRecord,
        validationStage: 'submitted_to_client',
        clientPackage: {
          ...valRecord.clientPackage,
          packageId: valRecord.clientPackage.packageId || `pkg_${submission.id.slice(0, 8)}`,
          generatedAt: valRecord.clientPackage.generatedAt || nowIso,
          submittedToClientAt: nowIso,
          submittedBy: profile?.full_name || profile?.email || 'Recruiter',
          status: 'submitted_to_client',
        },
        decisionHistory: [
          {
            id: `log_client_${Date.now()}`,
            fromStage: valRecord.validationStage,
            toStage: 'submitted_to_client',
            actorName: profile?.full_name || 'Recruiter',
            actorRole: role,
            reason: `Final evidence-backed submission sent to ${valRecord.clientPackage.recipientClientOrgName}.`,
            isOverride: false,
            timestamp: nowIso,
          },
          ...valRecord.decisionHistory,
        ],
      };

      await persistValidation(
        next,
        'submit_to_client',
        `Submitted ${submission.candidates?.full_name || 'Candidate'} to ${valRecord.clientPackage.recipientClientOrgName}`
      );
      refreshAll();
    } catch (err) {
      toast({
        title: 'Client submission failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSavingVal(false);
    }
  };

  const handleConfirmTransition = async () => {
    if (!submission || !targetStage) return;
    if (
      targetStage === 'client_review' &&
      valRecord &&
      valRecord.validationStage !== 'approved_for_submission' &&
      valRecord.validationStage !== 'submitted_to_client'
    ) {
      toast({
        title: 'Recruiter Decision Gate required',
        description:
          'Please approve the candidate in the Decision Gate & Client Submission tab before sharing with the client.',
        tone: 'error',
      });
      setTargetStage(null);
      setActiveTab('decision_gate');
      return;
    }

    const needsReason = transitionRequiresReason(targetStage);
    if (needsReason && !transitionReason.trim()) {
      toast({
        title: 'Reason required',
        description: `Provide a reason to move to ${STAGE_LABELS[targetStage]}.`,
        tone: 'error',
      });
      return;
    }

    setTransitionLoading(true);
    try {
      await transitionSubmissionRpc({
        p_submission_id: submission.id,
        p_to: targetStage,
        p_reason: transitionReason.trim() || null,
      });
      toast({
        title: 'Stage updated',
        description: `Moved to ${STAGE_LABELS[targetStage]}.`,
        tone: 'success',
      });
      setTargetStage(null);
      setTransitionReason('');
      refreshAll();
    } catch (err) {
      toast({
        title: 'Transition failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setTransitionLoading(false);
    }
  };

  const handleMarkInvalid = async () => {
    if (!submission || !invalidReason.trim()) return;
    setInvalidLoading(true);
    try {
      await markSubmissionInvalidRpc({
        p_submission_id: submission.id,
        p_reason: invalidReason.trim(),
      });
      toast({
        title: 'Submission marked invalid',
        tone: 'info',
      });
      setMarkInvalidOpen(false);
      setInvalidReason('');
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not mark invalid',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setInvalidLoading(false);
    }
  };

  const handleUpdateInterviewStatus = async (
    interviewId: string,
    status: 'completed' | 'cancelled' | 'no_show'
  ) => {
    try {
      await updateInterviewStatusRpc({ p_interview_id: interviewId, p_status: status });
      toast({ title: `Interview marked ${status.replace('_', ' ')}`, tone: 'success' });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not update interview status',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const allowedTransitions = submission
    ? getAllowedTransitions(submission.stage, role)
    : [];

  const avgRecruiterScore =
    valRecord && valRecord.validationInterview.ratings.overallRecommendationRating > 0
      ? (
          (valRecord.validationInterview.ratings.communicationRating +
            valRecord.validationInterview.ratings.technicalRating +
            valRecord.validationInterview.ratings.skillGapValidationRating +
            valRecord.validationInterview.ratings.overallRecommendationRating) /
          4
        ).toFixed(1)
      : null;

  return (
    <Drawer
      open={Boolean(submissionId)}
      onClose={onClose}
      title={submission?.candidates?.full_name || 'Submission detail'}
      subtitle={
        submission?.requirements?.title
          ? `${submission.requirements.title} · ${submission.requirements.organizations?.name || 'Client'}`
          : ''
      }
      widthClass="max-w-[780px]"
    >
      {isLoading || !submission || !valRecord ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Top Attribution & Dual-Score Summary Banner */}
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stage={submission.stage} candidateView={isCandidate} />
                <Badge tone={VALIDATION_STAGE_TONES[valRecord.validationStage]}>
                  Gate: {VALIDATION_STAGE_LABELS[valRecord.validationStage]}
                </Badge>
                {!isCandidate && (
                  <SourceBadge
                    source={submission.source}
                    vendorName={submission.organizations?.name}
                  />
                )}
                {!submission.is_valid && (
                  <Badge tone="red">Invalid: {submission.invalid_reason}</Badge>
                )}
              </div>
              <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
                {formatLocalDateTime(submission.created_at)}
              </span>
            </div>

            {/* Dual Score Strip: AI JD Match vs Recruiter Assessment Score (Kept Strictly Separate) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[var(--border)]">
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  AI JD Match Score
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-[18px] font-semibold text-[var(--text-primary)]">
                    {valRecord.matchSummary.jdMatchPercentage}%
                  </span>
                  <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                    {valRecord.matchSummary.resumeVersion}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                  {valRecord.matchSummary.scoreCalculationVersion}
                </div>
              </div>

              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  Recruiter Validation Score
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-[18px] font-semibold text-[var(--text-primary)]">
                    {avgRecruiterScore ? `${avgRecruiterScore} / 5.0` : 'Not rated'}
                  </span>
                  <Badge
                    tone={
                      valRecord.validationInterview.status === 'completed'
                        ? 'emerald'
                        : valRecord.validationInterview.status === 'scheduled'
                          ? 'sky'
                          : 'neutral'
                    }
                  >
                    {valRecord.validationInterview.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Separate human assessment (1–5 scale)
                </div>
              </div>

              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  Source &amp; Ownership
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <VendorAssociationBadge
                    vendorName={
                      submission.organizations?.name ||
                      submission.candidates?.owner_vendor?.name
                    }
                    originalSource={submission.candidates?.original_source}
                  />
                  {submission.is_valid ? (
                    <Badge tone="emerald">Compliant</Badge>
                  ) : (
                    <Badge tone="red">Hold</Badge>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                  Original:{' '}
                  {submission.candidates?.original_source === 'internal'
                    ? 'Admin'
                    : submission.candidates?.original_source || 'Admin'}
                </div>
              </div>
            </div>
          </div>

          {/* Workflow Navigation Tabs */}
          <Tabs
            tabs={[
              {
                id: 'match_summary',
                label: '1. Match & Evidence',
                count: valRecord.matchSummary.skills.length,
              },
              ...(!isCandidate
                ? [
                    {
                      id: 'validation_interview',
                      label: '2. Validation Interview',
                    },
                  ]
                : []),
              {
                id: 'followup',
                label:
                  valRecord.followUp.routeType === 'vendor'
                    ? '3. Vendor Follow-up'
                    : '3. Candidate Follow-up',
              },
              ...(!isCandidate && !isVendor
                ? [
                    {
                      id: 'decision_gate',
                      label: '4. Decision Gate & Client Submit',
                    },
                  ]
                : []),
              {
                id: 'pipeline_history',
                label: '5. Pipeline & History',
                count: (interviewsData?.data?.length || 0) + history.length,
              },
            ]}
            activeTab={activeTab}
            onChange={(t) =>
              setActiveTab(
                t as
                  | 'match_summary'
                  | 'validation_interview'
                  | 'followup'
                  | 'decision_gate'
                  | 'pipeline_history'
              )
            }
          />

          {/* TAB 1: CANDIDATE MATCH SUMMARY & SKILL EVIDENCE */}
          {activeTab === 'match_summary' && (
            <div className="space-y-5">
              {/* Metadata & Recalculate Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[var(--border)] px-3 py-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-3 text-[var(--text-secondary)]">
                  <span>
                    Last analyzed:{' '}
                    <strong className="font-mono text-[var(--text-primary)]">
                      {formatLocalDateTime(valRecord.matchSummary.lastAnalysisAt)}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Resume:{' '}
                    <strong className="font-mono text-[var(--text-primary)]">
                      {valRecord.matchSummary.resumeVersion} ({valRecord.matchSummary.resumeHashPrefix})
                    </strong>
                  </span>
                </div>
                {isHq && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={savingVal}
                    onClick={() => {
                      const fresh = buildSubmissionValidationRecord(submission, valRecord);
                      const recalc = recomputeMatchSummary(fresh);
                      void persistValidation(
                        recalc,
                        'recalculate_match',
                        'Match analysis recalculated against current resume & verified evidence'
                      );
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Recalculate match
                  </Button>
                )}
              </div>

              {/* Requirement Alignment Checks (Experience, Location, Compliance) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px]">
                <div className="rounded-[6px] border border-[var(--border)] p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--text-secondary)]">Experience check</span>
                    <Badge tone={valRecord.matchSummary.experienceCheck.passed ? 'emerald' : 'amber'}>
                      {valRecord.matchSummary.experienceCheck.passed ? 'Aligned' : 'Gap'}
                    </Badge>
                  </div>
                  <p className="text-[var(--text-primary)]">
                    {valRecord.matchSummary.experienceCheck.summary}
                  </p>
                </div>

                <div className="rounded-[6px] border border-[var(--border)] p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--text-secondary)]">Location &amp; Mode</span>
                    <Badge tone={valRecord.matchSummary.locationCheck.passed ? 'emerald' : 'amber'}>
                      {valRecord.matchSummary.locationCheck.passed ? 'Aligned' : 'Review'}
                    </Badge>
                  </div>
                  <p className="text-[var(--text-primary)]">
                    {valRecord.matchSummary.locationCheck.summary}
                  </p>
                </div>

                <div className="rounded-[6px] border border-[var(--border)] p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--text-secondary)]">Compliance &amp; DPDP</span>
                    <Badge tone={valRecord.matchSummary.complianceCheck.passed ? 'emerald' : 'red'}>
                      {valRecord.matchSummary.complianceCheck.passed ? 'Verified' : 'Hold'}
                    </Badge>
                  </div>
                  <p className="text-[var(--text-primary)]">
                    {valRecord.matchSummary.complianceCheck.summary}
                  </p>
                </div>
              </div>

              {/* Parsing & Analysis Warnings */}
              {valRecord.matchSummary.parsingWarnings.length > 0 && (
                <div className="rounded-[6px] border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5 text-[12px]">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span>Resume Analysis Notes &amp; Non-Definitive Evidence Policy</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[var(--text-secondary)]">
                    {valRecord.matchSummary.parsingWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    <li>
                      Missing resume text is <strong>not definitive proof</strong> that a candidate lacks a skill. Use the status selector below or schedule a 10–15 min validation interview to verify.
                    </li>
                  </ul>
                </div>
              )}

              {/* Skill-by-Skill Evidence Matrix */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    JD Skill-by-Skill Evidence Breakdown ({valRecord.matchSummary.skills.length})
                  </h3>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                    <span>Mandatory &amp; Preferred</span>
                  </div>
                </div>

                <div className="divide-y divide-[var(--border)] rounded-[8px] border border-[var(--border)] overflow-hidden">
                  {valRecord.matchSummary.skills.map((item) => (
                    <div key={item.skill} className="p-3 bg-[var(--surface)] space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[13px] text-[var(--text-primary)]">
                            {item.skill}
                          </span>
                          <Badge tone={item.category === 'mandatory' ? 'rich_blue' : 'neutral'}>
                            {item.category}
                          </Badge>
                          <Badge tone={SKILL_STATUS_TONES[item.status]}>
                            {SKILL_EVIDENCE_STATUS_LABELS[item.status]}
                          </Badge>
                        </div>

                        {isHq && (
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Evidence status for ${item.skill}`}
                              value={item.status}
                              onChange={(e) =>
                                void handleUpdateSkillStatus(
                                  item.skill,
                                  e.target.value as SkillEvidenceStatus
                                )
                              }
                              className="h-7 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-primary)]"
                            >
                              <option value="matched">Matched in resume</option>
                              <option value="recruiter_verified">Recruiter-verified</option>
                              <option value="candidate_confirmed">Candidate-confirmed</option>
                              <option value="unclear">Unclear evidence</option>
                              <option value="not_found">Not found in resume</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="text-[12px] text-[var(--text-secondary)] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span>
                          <strong className="text-[var(--text-tertiary)]">{item.resumeSection}:</strong>{' '}
                          {item.evidenceSnippet}
                        </span>
                        {item.verifiedBy && (
                          <span className="text-[11px] font-mono text-[var(--text-tertiary)] shrink-0">
                            Updated by {item.verifiedBy}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RECRUITER VALIDATION INTERVIEW (10-15 MIN SCREENING) */}
          {activeTab === 'validation_interview' && !isCandidate && (
            <div className="space-y-5">
              {/* Schedule Short Validation Interview Box */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-[var(--accent)]" />
                      <span>Schedule Recruiter Validation Interview</span>
                    </h3>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Short 10–15 minute structured screen to validate missing/unclear JD skills and communication.
                    </p>
                  </div>
                  <Badge
                    tone={
                      valRecord.validationInterview.status === 'completed'
                        ? 'emerald'
                        : valRecord.validationInterview.status === 'scheduled'
                          ? 'sky'
                          : 'neutral'
                    }
                  >
                    Status: {valRecord.validationInterview.status.replace('_', ' ')}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Date & time"
                    type="datetime-local"
                    disabled={!isHq}
                    value={valRecord.validationInterview.scheduledAt.slice(0, 16)}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          scheduledAt: e.target.value,
                        },
                      })
                    }
                  />
                  <Select
                    label="Duration (configurable, default 10–15 min)"
                    disabled={!isHq}
                    value={String(valRecord.validationInterview.durationMinutes)}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          durationMinutes: Number(e.target.value),
                        },
                      })
                    }
                    options={[
                      { value: '10', label: '10 minutes (Quick gap check)' },
                      { value: '15', label: '15 minutes (Standard validation)' },
                      { value: '20', label: '20 minutes (Extended screen)' },
                      { value: '30', label: '30 minutes (Deep technical validation)' },
                    ]}
                  />
                  <Input
                    label="Meeting link"
                    disabled={!isHq}
                    value={valRecord.validationInterview.meetingLink}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          meetingLink: e.target.value,
                        },
                      })
                    }
                  />
                  <Input
                    label="Assigned interviewer"
                    disabled={!isHq}
                    value={valRecord.validationInterview.interviewerName}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          interviewerName: e.target.value,
                        },
                      })
                    }
                  />
                </div>

                {isHq && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleScheduleValidationInterview}
                        loading={savingVal}
                      >
                        <Clock className="h-3.5 w-3.5 mr-1" />
                        {valRecord.validationInterview.status === 'scheduled'
                          ? 'Update Scheduled Slot'
                          : 'Schedule Validation Interview'}
                      </Button>
                      {valRecord.validationInterview.meetingLink && (
                        <a
                          href={valRecord.validationInterview.meetingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] text-[var(--accent)] underline px-2"
                        >
                          Join link ↗
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void persistValidation(
                            {
                              ...valRecord,
                              validationInterview: {
                                ...valRecord.validationInterview,
                                status: 'no_show',
                              },
                            },
                            'interview_no_show',
                            'Validation interview marked No-Show'
                          )
                        }
                      >
                        Mark No-Show
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Validation Questions Generated from Missing/Unclear JD Skills */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Skill-Gap Validation Questions ({valRecord.validationInterview.questions.length})
                    </h3>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Generated from missing or unclear JD skills. Edit questions and record candidate answers &amp; evidence.
                    </p>
                  </div>
                  {isHq && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={generatingAiQuestions}
                      onClick={handleGenerateAiValidationQuestions}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Regenerate Gap Questions
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                  {valRecord.validationInterview.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                            Q{idx + 1}
                          </span>
                          <Badge tone="rich_blue">Target Skill: {q.targetSkill}</Badge>
                        </div>
                        {isHq && (
                          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={q.skillVerified}
                              onChange={(e) => {
                                const nextQuestions =
                                  valRecord.validationInterview.questions.map((item) =>
                                    item.id === q.id
                                      ? { ...item, skillVerified: e.target.checked }
                                      : item
                                  );
                                setValRecord({
                                  ...valRecord,
                                  validationInterview: {
                                    ...valRecord.validationInterview,
                                    questions: nextQuestions,
                                  },
                                });
                              }}
                            />
                            <span>Verify skill as Recruiter-Verified</span>
                          </label>
                        )}
                      </div>

                      <Input
                        label="Validation question (editable)"
                        disabled={!isHq}
                        value={q.question}
                        onChange={(e) => {
                          const nextQuestions =
                            valRecord.validationInterview.questions.map((item) =>
                              item.id === q.id ? { ...item, question: e.target.value } : item
                            );
                          setValRecord({
                            ...valRecord,
                            validationInterview: {
                              ...valRecord.validationInterview,
                              questions: nextQuestions,
                            },
                          });
                        }}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <Textarea
                          label="Candidate answer summary"
                          rows={2}
                          disabled={!isHq}
                          placeholder="Record candidate's explanation of hands-on implementation..."
                          value={q.candidateAnswer}
                          onChange={(e) => {
                            const nextQuestions =
                              valRecord.validationInterview.questions.map((item) =>
                                item.id === q.id
                                  ? { ...item, candidateAnswer: e.target.value }
                                  : item
                              );
                            setValRecord({
                              ...valRecord,
                              validationInterview: {
                                ...valRecord.validationInterview,
                                questions: nextQuestions,
                              },
                            });
                          }}
                        />
                        <Textarea
                          label="Recruiter notes & verified evidence"
                          rows={2}
                          disabled={!isHq}
                          placeholder="Document specific project, scale, or tool evidence..."
                          value={q.evidenceRecorded}
                          onChange={(e) => {
                            const nextQuestions =
                              valRecord.validationInterview.questions.map((item) =>
                                item.id === q.id
                                  ? { ...item, evidenceRecorded: e.target.value }
                                  : item
                              );
                            setValRecord({
                              ...valRecord,
                              validationInterview: {
                                ...valRecord.validationInterview,
                                questions: nextQuestions,
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {isHq && (
                  <div className="pt-2 border-t border-[var(--border)] flex flex-col sm:flex-row gap-2">
                    <div className="w-full sm:w-44">
                      <Input
                        placeholder="Skill name..."
                        value={newCustomSkill}
                        onChange={(e) => setNewCustomSkill(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="Add custom validation question..."
                        value={newCustomQuestion}
                        onChange={(e) => setNewCustomQuestion(e.target.value)}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddCustomQuestion}
                      disabled={!newCustomQuestion.trim()}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Question
                    </Button>
                  </div>
                )}
              </div>

              {/* Structured 1-5 Recruiter Assessment (Separate from AI Match Score) */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    Recruiter Assessment Ratings (1–5 Scale with Documented Criteria)
                  </h3>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Saved separately from the AI JD Match score. All 4 dimensions are required to mark the validation interview completed.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Select
                    label="Communication Rating (1–5)"
                    disabled={!isHq}
                    value={String(valRecord.validationInterview.ratings.communicationRating)}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          ratings: {
                            ...valRecord.validationInterview.ratings,
                            communicationRating: Number(e.target.value),
                          },
                        },
                      })
                    }
                    options={[
                      { value: '0', label: 'Select rating (1–5)...' },
                      ...Object.entries(RATING_CRITERIA_GUIDE.communication).map(([k, v]) => ({
                        value: k,
                        label: v,
                      })),
                    ]}
                  />

                  <Select
                    label="Technical Assessment Rating (1–5)"
                    disabled={!isHq}
                    value={String(valRecord.validationInterview.ratings.technicalRating)}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          ratings: {
                            ...valRecord.validationInterview.ratings,
                            technicalRating: Number(e.target.value),
                          },
                        },
                      })
                    }
                    options={[
                      { value: '0', label: 'Select rating (1–5)...' },
                      ...Object.entries(RATING_CRITERIA_GUIDE.technical).map(([k, v]) => ({
                        value: k,
                        label: v,
                      })),
                    ]}
                  />

                  <Select
                    label="Skill-Gap Validation Rating (1–5)"
                    disabled={!isHq}
                    value={String(valRecord.validationInterview.ratings.skillGapValidationRating)}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          ratings: {
                            ...valRecord.validationInterview.ratings,
                            skillGapValidationRating: Number(e.target.value),
                          },
                        },
                      })
                    }
                    options={[
                      { value: '0', label: 'Select rating (1–5)...' },
                      ...Object.entries(RATING_CRITERIA_GUIDE.skillGap).map(([k, v]) => ({
                        value: k,
                        label: v,
                      })),
                    ]}
                  />

                  <Select
                    label="Overall Recruiter Recommendation (1–5)"
                    disabled={!isHq}
                    value={String(
                      valRecord.validationInterview.ratings.overallRecommendationRating
                    )}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        validationInterview: {
                          ...valRecord.validationInterview,
                          ratings: {
                            ...valRecord.validationInterview.ratings,
                            overallRecommendationRating: Number(e.target.value),
                          },
                        },
                      })
                    }
                    options={[
                      { value: '0', label: 'Select recommendation (1–5)...' },
                      ...Object.entries(RATING_CRITERIA_GUIDE.overall).map(([k, v]) => ({
                        value: k,
                        label: v,
                      })),
                    ]}
                  />
                </div>

                <Textarea
                  label="Recruiter Assessment Summary & Evidence Notes"
                  rows={3}
                  disabled={!isHq}
                  placeholder="Summarize candidate's communication, hands-on technical depth, notice period, and readiness for client submission..."
                  value={valRecord.validationInterview.ratings.summaryNotes}
                  onChange={(e) =>
                    setValRecord({
                      ...valRecord,
                      validationInterview: {
                        ...valRecord.validationInterview,
                        ratings: {
                          ...valRecord.validationInterview.ratings,
                          summaryNotes: e.target.value,
                        },
                      },
                    })
                  }
                />

                {isHq && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={savingVal}
                      onClick={() =>
                        void persistValidation(
                          valRecord,
                          'save_interview_draft',
                          'Validation interview notes & ratings saved'
                        )
                      }
                    >
                      Save Draft Notes
                    </Button>
                    <Button
                      size="sm"
                      loading={savingVal}
                      onClick={handleCompleteValidationInterview}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Complete Validation Interview &amp; Verify Skills
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SOURCE-SPECIFIC FOLLOW-UP (VENDOR ROUTE VS DIRECT CANDIDATE ROUTE) */}
          {activeTab === 'followup' && (
            <div className="space-y-5">
              {/* Source & Ownership Routing Header */}
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                      {valRecord.followUp.routeType === 'vendor'
                        ? `Vendor Candidate Follow-Up Route · ${valRecord.followUp.vendorOrgName || 'Partner Agency'}`
                        : 'Direct Candidate Portal Follow-Up Route'}
                    </span>
                  </div>
                  <Badge
                    tone={
                      valRecord.followUp.status === 'recalculated'
                        ? 'emerald'
                        : valRecord.followUp.status === 'none'
                          ? 'neutral'
                          : 'amber'
                    }
                  >
                    Status: {valRecord.followUp.status.replace(/_/g, ' ')}
                  </Badge>
                </div>

                <p className="text-[12px] text-[var(--text-secondary)]">
                  {valRecord.followUp.routeType === 'vendor'
                    ? `Ownership verified via candidate owner_vendor_org_id. Only gap details for ${submission.candidates?.full_name || 'this candidate'} are shared with ${valRecord.followUp.vendorOrgName || 'the owning vendor'}.`
                    : `Routed directly to ${submission.candidates?.full_name || 'the candidate'}'s authenticated candidate portal via candidate_id ownership.`}
                </p>

                {valRecord.followUp.requestedAt && (
                  <div className="text-[11px] font-mono text-[var(--text-tertiary)]">
                    Requested {formatLocalDateTime(valRecord.followUp.requestedAt)} by{' '}
                    {valRecord.followUp.requestedBy}
                    {valRecord.followUp.respondedAt
                      ? ` · Responded ${formatLocalDateTime(valRecord.followUp.respondedAt)} (${valRecord.followUp.updatedResumeVersion || 'v2.0'})`
                      : ''}
                  </div>
                )}
              </div>

              {/* Recruiter Request Generator (For HQ Admin / Recruiter) */}
              {isHq && (
                <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3.5">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {valRecord.followUp.routeType === 'vendor'
                      ? 'Generate Vendor-Facing Gap Report & Request Updated Evidence'
                      : 'Send Direct Candidate Clarification & Resume Update Request'}
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select
                      label="Follow-up request type"
                      value={valRecord.followUp.requestType}
                      onChange={(e) =>
                        setValRecord({
                          ...valRecord,
                          followUp: {
                            ...valRecord.followUp,
                            requestType: e.target.value as
                              | 'updated_resume'
                              | 'skill_clarification'
                              | 'project_evidence',
                          },
                        })
                      }
                      options={[
                        {
                          value: 'project_evidence',
                          label: 'Updated Resume + Missing Skill Evidence',
                        },
                        { value: 'updated_resume', label: 'Request Updated Resume Version' },
                        { value: 'skill_clarification', label: 'Request Skill Clarification' },
                        {
                          value: 'additional_evidence',
                          label: 'Request Project / Architecture Evidence',
                        },
                      ]}
                    />

                    <div>
                      <span className="text-[12px] font-medium text-[var(--text-secondary)] block mb-1.5">
                        Skills requiring clarification ({valRecord.followUp.targetSkills.length})
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {valRecord.followUp.targetSkills.length === 0 ? (
                          <span className="text-[12px] text-[var(--text-tertiary)]">
                            All skills matched - general availability check
                          </span>
                        ) : (
                          valRecord.followUp.targetSkills.map((sk) => (
                            <Badge key={sk} tone="amber">
                              {sk}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <Textarea
                    label={
                      valRecord.followUp.routeType === 'vendor'
                        ? 'Vendor-facing gap report & instructions'
                        : 'Candidate portal clarification instructions'
                    }
                    rows={3}
                    value={valRecord.followUp.recruiterInstructions}
                    onChange={(e) =>
                      setValRecord({
                        ...valRecord,
                        followUp: {
                          ...valRecord.followUp,
                          recruiterInstructions: e.target.value,
                        },
                      })
                    }
                  />

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      loading={savingVal}
                      onClick={handleSendFollowUpRequest}
                    >
                      <MessageSquare className="h-3.5 w-3.5 mr-1" />
                      {valRecord.followUp.routeType === 'vendor'
                        ? `Send Gap Report to ${valRecord.followUp.vendorOrgName || 'Vendor'}`
                        : 'Send Clarification Request to Candidate Portal'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Response & Match Recalculation Panel (Accessible to Vendor for own candidate, Direct Candidate for own profile, or Recruiter) */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {valRecord.followUp.routeType === 'vendor'
                      ? 'Vendor Response, Skill Evidence & Updated Resume Version'
                      : 'Candidate Clarification Response & Updated Resume Evidence'}
                  </h3>
                  <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                    Current version: {valRecord.matchSummary.resumeVersion}
                  </span>
                </div>

                {!isHq && valRecord.followUp.recruiterInstructions && (
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] space-y-1">
                    <span className="font-medium text-[var(--text-primary)] block">
                      HireNest Recruiter Gap Clarification Request:
                    </span>
                    <p className="text-[var(--text-secondary)]">
                      {valRecord.followUp.recruiterInstructions}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <Textarea
                      label="Clarification response & project evidence for missing skills"
                      rows={3}
                      placeholder="Provide specific project experience, duration, and technical evidence for the requested skills..."
                      value={followUpResponseNotes}
                      onChange={(e) => setFollowUpResponseNotes(e.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <Select
                      label="Updated resume version"
                      value={followUpNewVersion}
                      onChange={(e) => setFollowUpNewVersion(e.target.value)}
                      options={[
                        { value: 'v1.1', label: 'v1.1 (Skill evidence addendum)' },
                        { value: 'v2.0', label: 'v2.0 (Updated resume uploaded)' },
                        { value: 'v2.1', label: 'v2.1 (Verified portfolio revision)' },
                      ]}
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      loading={savingVal}
                      onClick={handleRecordFollowUpResponseAndRecalculate}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Submit Evidence &amp; Recalculate Match
                    </Button>
                  </div>
                </div>
              </div>

              {/* Resume Version & Score History */}
              <div className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  Preserved Resume Versions &amp; Match History ({valRecord.resumeVersions.length})
                </h3>
                <div className="divide-y divide-[var(--border)] rounded-[8px] border border-[var(--border)]">
                  {valRecord.resumeVersions.map((ver, i) => (
                    <div
                      key={`${ver.version}_${i}`}
                      className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]"
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium text-[var(--text-primary)]">
                          <span className="font-mono mr-2">{ver.version}</span>· {ver.notes}
                        </div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Uploaded by {ver.uploadedBy} · Digest: {ver.resumeHash}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge tone="rich_blue">Match: {ver.matchScoreAtVersion}%</Badge>
                        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          {formatLocalDateTime(ver.uploadedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RECRUITER DECISION GATE & FINAL CLIENT SUBMISSION */}
          {activeTab === 'decision_gate' && isHq && (
            <div className="space-y-5">
              {/* Visual Decision Gate Stepper */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Governed Recruiter Decision Gate
                  </h3>
                  <Badge tone={VALIDATION_STAGE_TONES[valRecord.validationStage]}>
                    Current: {VALIDATION_STAGE_LABELS[valRecord.validationStage]}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {VALIDATION_STAGE_ORDER.map((st, i) => {
                    const isCurrent = valRecord.validationStage === st;
                    return (
                      <React.Fragment key={st}>
                        <span
                          className={`px-2 py-1 rounded-[4px] border font-medium ${
                            isCurrent
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                              : 'border-[var(--border)] text-[var(--text-tertiary)]'
                          }`}
                        >
                          {VALIDATION_STAGE_LABELS[st]}
                        </span>
                        {i < VALIDATION_STAGE_ORDER.length - 1 && (
                          <span className="text-[var(--text-tertiary)]">→</span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {valRecord.overrideReason && (
                  <div className="rounded-[6px] border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">
                      Documented Recruiter Override ({valRecord.overriddenBy}):
                    </strong>{' '}
                    {valRecord.overrideReason}
                  </div>
                )}

                {/* Decision Gate Action Buttons */}
                <div className="pt-2 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setPendingDecisionStage('approved_for_submission');
                      setDecisionReasonInput('');
                    }}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Approve for Client Submission
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPendingDecisionStage('hold_for_clarification');
                      setDecisionReasonInput('');
                    }}
                  >
                    Hold for Clarification
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPendingDecisionStage('rejected');
                      setDecisionReasonInput('');
                    }}
                  >
                    Reject Candidate
                  </Button>
                </div>
              </div>

              {/* Final Client Submission Review & Dispatch Panel */}
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <ClipboardCheck className="h-4 w-4 text-[var(--accent)]" />
                      <span>Final Client Submission Review Package</span>
                    </h3>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Client submission requires explicit recruiter approval and accurate gap disclosure. AI score alone can never approve a candidate.
                    </p>
                  </div>
                  <Badge
                    tone={
                      valRecord.clientPackage.status === 'submitted_to_client'
                        ? 'emerald'
                        : valRecord.validationStage === 'approved_for_submission'
                          ? 'teal'
                          : 'amber'
                    }
                  >
                    {valRecord.clientPackage.status === 'submitted_to_client'
                      ? 'Submitted to Client'
                      : valRecord.validationStage === 'approved_for_submission'
                        ? 'Approved · Ready for Client'
                        : 'Awaiting Recruiter Approval'}
                  </Badge>
                </div>

                {/* Final Review Fact Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px]">
                  <div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block">
                      Recipient Client
                    </span>
                    <strong className="text-[var(--text-primary)]">
                      {valRecord.clientPackage.recipientClientOrgName}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block">
                      Resume Version
                    </span>
                    <strong className="font-mono text-[var(--text-primary)]">
                      {valRecord.matchSummary.resumeVersion} ({valRecord.matchSummary.resumeHashPrefix})
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block">
                      Explainable JD Match
                    </span>
                    <strong className="font-mono text-[var(--text-primary)]">
                      {valRecord.matchSummary.jdMatchPercentage}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block">
                      Recruiter Approval
                    </span>
                    <strong className="text-[var(--text-primary)]">
                      {valRecord.approvedBy || 'Pending'}
                    </strong>
                  </div>
                </div>

                <Textarea
                  label="Client Executive Summary (Candidate fit, verified skills & recruiter assessment)"
                  rows={3}
                  value={valRecord.clientPackage.executiveSummary}
                  onChange={(e) =>
                    setValRecord({
                      ...valRecord,
                      clientPackage: {
                        ...valRecord.clientPackage,
                        executiveSummary: e.target.value,
                      },
                    })
                  }
                  placeholder="Click 'Approve for Client Submission' above or type executive summary for the client hiring manager..."
                />

                <Textarea
                  label="Relevant Gaps or Limitations for Accurate Client Disclosure"
                  rows={2}
                  value={valRecord.clientPackage.disclosedGapsAndLimitations}
                  onChange={(e) =>
                    setValRecord({
                      ...valRecord,
                      clientPackage: {
                        ...valRecord.clientPackage,
                        disclosedGapsAndLimitations: e.target.value,
                      },
                    })
                  }
                />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border)]">
                  <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={valRecord.clientPackage.complianceAndConsentConfirmed}
                      onChange={(e) =>
                        setValRecord({
                          ...valRecord,
                          clientPackage: {
                            ...valRecord.clientPackage,
                            complianceAndConsentConfirmed: e.target.checked,
                          },
                        })
                      }
                    />
                    <span>
                      Confirm DPDP consent, candidate ownership, and accurate skill-gap disclosure
                    </span>
                  </label>

                  <Button
                    size="sm"
                    loading={savingVal}
                    disabled={
                      (valRecord.validationStage !== 'approved_for_submission' &&
                        valRecord.validationStage !== 'submitted_to_client') ||
                      !valRecord.clientPackage.complianceAndConsentConfirmed ||
                      !submission.is_valid
                    }
                    onClick={handleFinalSubmitToClient}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {valRecord.clientPackage.status === 'submitted_to_client'
                      ? 'Update Client Submission Package'
                      : 'Send Approved Profile to Client'}
                  </Button>
                </div>

                {valRecord.clientPackage.submittedToClientAt && (
                  <div className="rounded-[6px] border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-3 py-2 text-[12px] text-[var(--text-primary)]">
                    Submitted to <strong>{valRecord.clientPackage.recipientClientOrgName}</strong> by{' '}
                    <strong>{valRecord.clientPackage.submittedBy}</strong> on{' '}
                    <span className="font-mono">
                      {formatLocalDateTime(valRecord.clientPackage.submittedToClientAt)}
                    </span>
                    .
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: EXISTING PIPELINE, INTERVIEWS, QUALITY & STAGE HISTORY */}
          {activeTab === 'pipeline_history' && (
            <div className="space-y-6">
              {/* Attribution & Contract Contact Policy Details */}
              {!isCandidate && (
                <div className="space-y-1.5 text-[13px] leading-[20px] pb-4 border-b border-[var(--border)]">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-secondary)]">Submission source</span>
                    <SourceBadge
                      source={submission.source}
                      vendorName={submission.organizations?.name}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-secondary)]">Original candidate source</span>
                    <span className="text-[var(--text-primary)] capitalize">
                      {submission.candidates?.original_source === 'internal'
                        ? 'Admin'
                        : submission.candidates?.original_source || 'Admin'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-secondary)]">Vendor association</span>
                    <VendorAssociationBadge
                      vendorName={submission.candidates?.owner_vendor?.name}
                      originalSource={submission.candidates?.original_source}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-secondary)]">Engagement &amp; Contact Policy</span>
                    <Badge
                      tone={
                        getContractContactPolicy(submission.requirements?.employment_type)
                          .isContractEngagement
                          ? 'amber'
                          : 'slate'
                      }
                    >
                      {
                        getContractContactPolicy(submission.requirements?.employment_type)
                          .engagementLabel
                      }{' '}
                      ·{' '}
                      {getContractContactPolicy(submission.requirements?.employment_type)
                        .hideAndOmitContactFieldsByDefault
                        ? 'Email/Phone Omitted by Default'
                        : 'Direct Contact Governed by RBAC'}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Shared Offer & Onboarding Lifecycle Snapshot */}
              {(() => {
                const offerRec = getOrBuildOfferOnboardingRecord(submission);
                return (
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        Shared Offer &amp; Onboarding Lifecycle
                      </span>
                      <Badge
                        tone={
                          offerRec.lifecycleStage === 'onboarded'
                            ? 'emerald'
                            : offerRec.lifecycleStage === 'offer_declined' ||
                                offerRec.lifecycleStage === 'did_not_join'
                              ? 'red'
                              : 'sky'
                        }
                      >
                        {OFFER_LIFECYCLE_LABELS[offerRec.lifecycleStage]}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2">
                        <span className="text-[11px] text-[var(--text-tertiary)] block">
                          Offer Date &amp; Status
                        </span>
                        <strong className="font-mono text-[var(--text-primary)]">
                          {offerRec.offerDate || '-'}
                        </strong>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {OFFER_STATUS_LABELS[offerRec.offerStatus]}
                        </div>
                      </div>
                      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2">
                        <span className="text-[11px] text-[var(--text-tertiary)] block">
                          Response Date
                        </span>
                        <strong className="font-mono text-[var(--text-primary)]">
                          {offerRec.offerResponseDate || '-'}
                        </strong>
                      </div>
                      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2">
                        <span className="text-[11px] text-[var(--text-tertiary)] block">
                          Expected DOJ
                        </span>
                        <strong className="font-mono text-[var(--text-primary)]">
                          {offerRec.expectedDoj || 'Not scheduled'}
                        </strong>
                      </div>
                      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2">
                        <span className="text-[11px] text-[var(--text-tertiary)] block">
                          Confirmed Actual DOJ
                        </span>
                        <strong className="font-mono text-emerald-700 dark:text-emerald-300">
                          {offerRec.actualDoj || 'Not yet joined'}
                        </strong>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {ONBOARDING_STATUS_LABELS[offerRec.onboardingStatus]}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Classic Stage Actions */}
              <div className="space-y-3 pb-4 border-b border-[var(--border)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                    Pipeline Stage Actions
                  </h3>
                  {isHq && submission.is_valid && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMarkInvalidOpen(true)}
                      className="text-[var(--status-danger)]"
                    >
                      Mark invalid
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {allowedTransitions.map((nextStage) => {
                    const label =
                      nextStage === 'client_review'
                        ? 'Share with client'
                        : isCandidate && nextStage === 'withdrawn'
                          ? 'Withdraw application'
                          : `Move to ${STAGE_LABELS[nextStage]}`;
                    const variant =
                      nextStage === 'rejected' ||
                      nextStage === 'withdrawn' ||
                      nextStage === 'offer_declined'
                        ? 'danger'
                        : nextStage === 'client_review' ||
                            nextStage === 'offered' ||
                            nextStage === 'onboarded'
                          ? 'primary'
                          : 'outline';
                    return (
                      <Button
                        key={nextStage}
                        size="sm"
                        variant={variant}
                        onClick={() => {
                          setTargetStage(nextStage);
                          setTransitionReason('');
                        }}
                      >
                        {label}
                      </Button>
                    );
                  })}

                  {(isHq || isClient) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScheduleOpen(true)}
                    >
                      Schedule formal interview round
                    </Button>
                  )}

                  {(isHq || isClient) && submission.shared_with_client_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQualityModalOpen(true)}
                    >
                      Rate quality
                    </Button>
                  )}
                </div>
              </div>

              {/* Formal Interviews */}
              <div className="space-y-3 pb-4 border-b border-[var(--border)]">
                <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                  Formal Interview Rounds ({interviewsData?.data?.length || 0})
                </h3>
                {!interviewsData?.data?.length ? (
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    No formal interview rounds scheduled.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {interviewsData.data.map((iv) => {
                      const feedbacks = iv.interview_feedback || [];
                      return (
                        <div
                          key={iv.id}
                          className="rounded-[6px] border border-[var(--border)] p-3 space-y-2 text-[13px] leading-[20px]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-[var(--text-primary)]">
                              <span className="font-mono tabular-nums mr-1.5 text-[var(--text-tertiary)]">
                                #{iv.round_number}
                              </span>
                              {ROUND_LABELS[iv.round_type]} · {iv.mode}
                            </div>
                            <Badge
                              tone={
                                iv.status === 'completed'
                                  ? 'emerald'
                                  : iv.status === 'scheduled'
                                    ? 'slate'
                                    : 'red'
                              }
                            >
                              {iv.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
                            <span>{formatLocalDateTime(iv.scheduled_at)}</span>
                            <span>{iv.duration_minutes}m</span>
                            {iv.meeting_link && (
                              <a
                                href={iv.meeting_link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[var(--accent)] underline font-sans"
                              >
                                Meeting link
                              </a>
                            )}
                          </div>

                          {(isHq || isClient) && iv.status === 'scheduled' && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setScreeningInterview(iv)}
                              >
                                Run screening session
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdateInterviewStatus(iv.id, 'completed')}
                              >
                                Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdateInterviewStatus(iv.id, 'no_show')}
                              >
                                No-show
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleUpdateInterviewStatus(iv.id, 'cancelled')}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}

                          {(isHq || isClient) && iv.status === 'completed' && (
                            <div className="pt-1">
                              <Button size="sm" onClick={() => setFeedbackInterview(iv)}>
                                Submit feedback
                              </Button>
                            </div>
                          )}

                          {feedbacks.length > 0 && !isCandidate && (
                            <div className="pt-2 border-t border-[var(--border)] space-y-2">
                              {feedbacks.map((fb) => (
                                <div
                                  key={fb.id}
                                  className="rounded-[6px] bg-[var(--bg-subtle)] p-2.5 space-y-1 text-[12px] leading-[16px]"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono tabular-nums text-[var(--text-primary)]">
                                      Overall {fb.overall_rating}/5 · Skill {fb.skill_rating}/5 · Comm{' '}
                                      {fb.communication_rating}/5
                                    </span>
                                    <Badge
                                      tone={
                                        fb.decision === 'advance'
                                          ? 'emerald'
                                          : fb.decision === 'reject'
                                            ? 'red'
                                            : 'amber'
                                      }
                                    >
                                      {fb.decision}
                                    </Badge>
                                  </div>
                                  <p className="text-[13px] leading-[20px] text-[var(--text-primary)]">
                                    {fb.feedback}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Validation Gate Audit Trail */}
              <div className="space-y-2.5 pb-4 border-b border-[var(--border)]">
                <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                  Recruiter Validation Gate Audit Trail ({valRecord.decisionHistory.length})
                </h3>
                <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {valRecord.decisionHistory.map((item) => (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-start justify-between gap-4 text-[12px]"
                    >
                      <div className="space-y-0.5">
                        <div className="text-[var(--text-primary)]">
                          {VALIDATION_STAGE_LABELS[item.fromStage]} →{' '}
                          <strong className="font-semibold">
                            {VALIDATION_STAGE_LABELS[item.toStage]}
                          </strong>
                          {item.isOverride && (
                            <Badge tone="amber" className="ml-2">
                              Recruiter Override
                            </Badge>
                          )}
                        </div>
                        <div className="text-[var(--text-secondary)]">{item.reason}</div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          {item.actorName} ({item.actorRole})
                        </div>
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-tertiary)] shrink-0">
                        {formatLocalDateTime(item.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Classic Stage Timeline */}
              <div className="space-y-3">
                <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                  Database Stage History
                </h3>
                {history.length === 0 ? (
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    No transitions logged.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="py-2.5 flex items-start justify-between gap-4 text-[13px] leading-[20px]"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-[var(--text-primary)]">
                            {item.from_stage
                              ? `${
                                  isCandidate
                                    ? CANDIDATE_STAGE_LABELS[item.from_stage]
                                    : STAGE_LABELS[item.from_stage]
                                } → `
                              : ''}
                            <span className="font-medium">
                              {isCandidate
                                ? CANDIDATE_STAGE_LABELS[item.to_stage]
                                : STAGE_LABELS[item.to_stage]}
                            </span>
                          </div>
                          {!isCandidate && (
                            <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                              {item.profiles?.full_name || item.actor_role} · {item.actor_role}
                            </div>
                          )}
                          {item.reason && (
                            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                              {item.reason}
                            </p>
                          )}
                        </div>
                        <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)] shrink-0">
                          {formatLocalDateTime(item.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision Gate Confirmation & Override Modal */}
      <Dialog
        open={Boolean(pendingDecisionStage)}
        onClose={() => setPendingDecisionStage(null)}
        title={
          pendingDecisionStage
            ? `Move Decision Gate to ${VALIDATION_STAGE_LABELS[pendingDecisionStage]}?`
            : 'Update Decision Gate'
        }
        description="Recorded in the Recruiter Validation audit trail with actor attribution."
      >
        <div className="space-y-4">
          {pendingDecisionStage === 'approved_for_submission' &&
            valRecord &&
            (valRecord.matchSummary.jdMatchPercentage < 60 ||
              valRecord.validationInterview.status !== 'completed') && (
              <div className="rounded-[6px] border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-[var(--text-primary)]">
                <strong>Recruiter Override Notice:</strong> Either the validation interview is not yet marked completed or the AI JD match is below 60%. Document your override reason below to approve.
              </div>
            )}
          <Textarea
            label="Decision / Override Reason (required for overrides, holds, or rejections)"
            rows={3}
            value={decisionReasonInput}
            onChange={(e) => setDecisionReasonInput(e.target.value)}
            placeholder="Document evidence, validation outcome, or override justification..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingDecisionStage(null)}>
              Cancel
            </Button>
            <Button onClick={handleDecisionGateTransition} loading={savingVal}>
              Confirm Decision
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirmation Dialog for Stage Transition */}
      <Dialog
        open={Boolean(targetStage)}
        onClose={() => setTargetStage(null)}
        title={
          targetStage === 'client_review'
            ? `Share ${submission?.candidates?.full_name || 'candidate'} with client?`
            : targetStage
              ? `Move ${submission?.candidates?.full_name || 'candidate'} to ${STAGE_LABELS[targetStage]}?`
              : 'Confirm transition'
        }
        description="Logged in submission_stage_history."
      >
        <div className="space-y-4">
          <Textarea
            label={
              targetStage && transitionRequiresReason(targetStage)
                ? 'Reason (required)'
                : 'Note / reason (optional)'
            }
            rows={3}
            value={transitionReason}
            onChange={(e) => setTransitionReason(e.target.value)}
            placeholder="Context for audit history..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTargetStage(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmTransition} loading={transitionLoading}>
              Confirm
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Mark Invalid Dialog */}
      <Dialog
        open={markInvalidOpen}
        onClose={() => setMarkInvalidOpen(false)}
        title={`Mark submission for ${submission?.candidates?.full_name || 'candidate'} invalid?`}
        description="Flags this submission non-compliant for vendor process compliance metrics."
      >
        <div className="space-y-4">
          <Textarea
            label="Reason (required)"
            rows={3}
            value={invalidReason}
            onChange={(e) => setInvalidReason(e.target.value)}
            placeholder="e.g. Candidate did not consent to submission."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMarkInvalidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={invalidLoading}
              disabled={!invalidReason.trim()}
              onClick={handleMarkInvalid}
            >
              Mark invalid
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Schedule Interview Modal */}
      {submission && (
        <ScheduleInterviewModal
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          submissionId={submission.id}
          requirementTitle={submission.requirements?.title}
          requirementDescription={submission.requirements?.description}
          requirementSkills={submission.requirements?.skills}
          candidateSkills={submission.candidates?.skills}
          candidateExperienceYears={submission.candidates?.total_experience_years}
          candidateCurrentTitle={submission.candidates?.current_title}
          onScheduled={refreshAll}
        />
      )}

      {/* Submit Interview Feedback Modal */}
      {feedbackInterview && submission && (
        <InterviewFeedbackModal
          open={Boolean(feedbackInterview)}
          onClose={() => setFeedbackInterview(null)}
          interviewId={feedbackInterview.id}
          submissionId={submission.id}
          roundType={feedbackInterview.round_type}
          candidateName={submission.candidates?.full_name}
          onSubmitted={refreshAll}
        />
      )}

      {/* Candidate Quality Modal */}
      {submission && (
        <CandidateQualityModal
          open={qualityModalOpen}
          onClose={() => setQualityModalOpen(false)}
          submissionId={submission.id}
          candidateName={submission.candidates?.full_name}
          onSubmitted={refreshAll}
        />
      )}

      {/* Screening Interview Runner Modal */}
      {screeningInterview && submission && (
        <ScreeningInterviewRunnerModal
          open={Boolean(screeningInterview)}
          onClose={() => setScreeningInterview(null)}
          interviewId={screeningInterview.id}
          submissionId={submission.id}
          mode={screeningInterview.mode}
          candidateName={submission.candidates?.full_name}
          requirementTitle={submission.requirements?.title}
          requirementDescription={submission.requirements?.description}
          requirementSkills={submission.requirements?.skills}
          candidateSkills={submission.candidates?.skills}
          candidateExperienceYears={submission.candidates?.total_experience_years}
          candidateCurrentTitle={submission.candidates?.current_title}
          onCompleted={refreshAll}
        />
      )}
    </Drawer>
  );
};
