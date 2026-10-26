import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  Button,
  Input,
  Select,
  Textarea,
  RatingInput,
} from '../ui/kit';
import { AiSuggestionBanner } from './DomainBadges';
import {
  scheduleInterviewRpc,
  updateInterviewStatusRpc,
  createInterviewFeedback,
  createCandidateQualityFeedback,
} from '../../api/interviews';
import { transitionSubmissionRpc } from '../../api/submissions';
import {
  suggestInterviewQuestions,
  tidyInterviewNotes,
  evaluateScreeningResponses,
} from '../../api/ai';
import { mapSupabaseError } from '../../lib/errors';
import { ROUND_LABELS } from '../../lib/format';
import { useToast } from '../ui/Toast';
import type {
  InterviewDecision,
  InterviewMode,
  InterviewRound,
} from '../../types/db';

// 1. Schedule Interview Modal
const scheduleSchema = z.object({
  round_type: z.enum([
    'initial_screening',
    'technical',
    'managerial',
    'final',
    'ai_screening',
  ]),
  scheduled_at: z.string().min(1, 'Date and time are required'),
  duration_minutes: z.coerce.number().int().min(15).max(240),
  mode: z.enum(['video', 'phone', 'in_person', 'ai_text']),
  meeting_link: z.string().optional(),
});

type ScheduleValues = z.infer<typeof scheduleSchema>;

export const ScheduleInterviewModal: React.FC<{
  open: boolean;
  onClose: () => void;
  submissionId: string;
  requirementTitle?: string;
  requirementDescription?: string;
  requirementSkills?: string[];
  candidateSkills?: string[];
  candidateExperienceYears?: number | null;
  candidateCurrentTitle?: string | null;
  onScheduled: () => void;
}> = ({
  open,
  onClose,
  submissionId,
  requirementTitle = '',
  requirementDescription = '',
  requirementSkills = [],
  candidateSkills = [],
  candidateExperienceYears = null,
  candidateCurrentTitle = null,
  onScheduled,
}) => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiQuestions, setAiQuestions] = useState<
    Array<{ topic: string; question: string; whatToLookFor: string }>
  >([]);
  const [aiLabel, setAiLabel] = useState('Suggestion: review before use');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema) as never,
    defaultValues: {
      round_type: 'technical',
      scheduled_at: '',
      duration_minutes: 45,
      mode: 'video',
      meeting_link: '',
    },
  });

  const roundType = watch('round_type');

  const handleSuggestQuestions = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await suggestInterviewQuestions({
        requirement_title: requirementTitle,
        requirement_description: requirementDescription,
        requirement_skills: requirementSkills,
        candidate_skills: candidateSkills,
        total_experience_years: candidateExperienceYears,
        current_title: candidateCurrentTitle,
        round_type: roundType,
      });
      setAiLabel(res.label);
      setAiQuestions(res.questions);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiLoading(false);
    }
  };

  const onSubmit = async (values: ScheduleValues) => {
    setSubmitting(true);
    try {
      const utcIso = new Date(values.scheduled_at).toISOString();
      await scheduleInterviewRpc({
        p_submission_id: submissionId,
        p_round_type: values.round_type as InterviewRound,
        p_scheduled_at: utcIso,
        p_duration_minutes: values.duration_minutes,
        p_mode: values.mode as InterviewMode,
        p_meeting_link: values.meeting_link?.trim() || null,
      });
      toast({
        title: 'Interview scheduled',
        description: `${ROUND_LABELS[values.round_type as InterviewRound]} scheduled.`,
        tone: 'success',
      });
      onScheduled();
      onClose();
    } catch (err) {
      toast({
        title: 'Could not schedule interview',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Schedule interview"
      description="Scheduling a round moves a client_review submission into interviewing."
      maxWidth="max-w-[640px]"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Round"
            {...register('round_type')}
            error={errors.round_type?.message}
            options={[
              { value: 'initial_screening', label: 'Initial screening' },
              { value: 'ai_screening', label: 'First-round screening (Q&A)' },
              { value: 'technical', label: 'Technical round' },
              { value: 'managerial', label: 'Managerial round' },
              { value: 'final', label: 'Final round' },
            ]}
          />
          <Select
            label="Mode"
            {...register('mode')}
            error={errors.mode?.message}
            options={[
              { value: 'video', label: 'Video call' },
              { value: 'phone', label: 'Phone call' },
              { value: 'in_person', label: 'In person' },
              { value: 'ai_text', label: 'Structured text capture (ai_text)' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Date & time (local)"
            type="datetime-local"
            {...register('scheduled_at')}
            error={errors.scheduled_at?.message}
          />
          <Input
            label="Duration (minutes)"
            type="number"
            {...register('duration_minutes')}
            error={errors.duration_minutes?.message}
          />
        </div>

        <Input
          label="Meeting link"
          placeholder="https://meet.google.com/..."
          {...register('meeting_link')}
          error={errors.meeting_link?.message}
        />

        {/* Inline Suggestion Block: Suggest interview questions */}
        <div className="pt-2 border-t border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Interview preparation questions
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={aiLoading}
              onClick={handleSuggestQuestions}
            >
              Suggest interview questions
            </Button>
          </div>

          {aiError && (
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">{aiError}</p>
          )}

          {aiQuestions.length > 0 && (
            <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onDismiss={() => setAiQuestions([])}
              />
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {aiQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px] leading-[20px] space-y-1"
                  >
                    <div className="font-medium text-[var(--text-primary)]">
                      <span className="font-mono tabular-nums mr-1.5 text-[var(--text-tertiary)]">
                        {idx + 1}.
                      </span>
                      {q.topic}
                    </div>
                    <p className="text-[var(--text-primary)]">{q.question}</p>
                    <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                      Look for: {q.whatToLookFor}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Schedule interview
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 2. Interview Feedback Modal (with "Tidy my notes")
export const InterviewFeedbackModal: React.FC<{
  open: boolean;
  onClose: () => void;
  interviewId: string;
  submissionId: string;
  roundType: InterviewRound;
  candidateName?: string;
  onSubmitted: () => void;
}> = ({
  open,
  onClose,
  interviewId,
  submissionId,
  roundType,
  candidateName,
  onSubmitted,
}) => {
  const { toast } = useToast();
  const [skillRating, setSkillRating] = useState(0);
  const [commRating, setCommRating] = useState(0);
  const [overallRating, setOverallRating] = useState(0);
  const [decision, setDecision] = useState<InterviewDecision>('advance');
  const [feedback, setFeedback] = useState('');
  const [evidence, setEvidence] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [offerRejectPrompt, setOfferRejectPrompt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingSubmission, setRejectingSubmission] = useState(false);

  const [aiTidying, setAiTidying] = useState(false);
  const [aiSuggestedNotes, setAiSuggestedNotes] = useState<string | null>(null);
  const [aiLabel, setAiLabel] = useState('Suggestion: review before use');
  const [aiError, setAiError] = useState<string | null>(null);

  const handleTidyNotes = async () => {
    setAiTidying(true);
    setAiError(null);
    try {
      const res = await tidyInterviewNotes(feedback);
      setAiLabel(res.label);
      setAiSuggestedNotes(res.text);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiTidying(false);
    }
  };

  const handleSaveFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillRating || !commRating || !overallRating) {
      setFormError('Select a 1–5 rating for all three criteria.');
      return;
    }
    if (feedback.trim().length < 10) {
      setFormError('Feedback must be at least 10 characters.');
      return;
    }
    setFormError(null);
    setSubmitting(true);

    try {
      await createInterviewFeedback({
        interview_id: interviewId,
        skill_rating: skillRating,
        communication_rating: commRating,
        overall_rating: overallRating,
        decision,
        feedback: feedback.trim(),
        evidence: evidence.trim() || null,
      });

      toast({
        title: 'Interview feedback recorded',
        tone: 'success',
      });

      onSubmitted();

      if (decision === 'reject') {
        setRejectReason(feedback.trim());
        setOfferRejectPrompt(true);
      } else {
        onClose();
      }
    } catch (err) {
      setFormError(mapSupabaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmRejectSubmission = async () => {
    if (!rejectReason.trim()) return;
    setRejectingSubmission(true);
    try {
      await transitionSubmissionRpc({
        p_submission_id: submissionId,
        p_to: 'rejected',
        p_reason: rejectReason.trim(),
      });
      toast({
        title: 'Submission moved to Rejected',
        tone: 'info',
      });
      onSubmitted();
      setOfferRejectPrompt(false);
      onClose();
    } catch (err) {
      toast({
        title: 'Could not transition submission',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setRejectingSubmission(false);
    }
  };

  if (offerRejectPrompt) {
    return (
      <Dialog
        open={open}
        onClose={() => {
          setOfferRejectPrompt(false);
          onClose();
        }}
        title={`Move ${candidateName || 'submission'} to Rejected?`}
        description="Your interview decision was Reject. Would you also like to move the pipeline submission to Rejected?"
      >
        <div className="space-y-4">
          <Textarea
            label="Rejection reason"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOfferRejectPrompt(false);
                onClose();
              }}
            >
              Keep current stage
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={rejectingSubmission}
              disabled={!rejectReason.trim()}
              onClick={handleConfirmRejectSubmission}
            >
              Reject submission
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Submit interview feedback"
      description={`${ROUND_LABELS[roundType]}${candidateName ? ` · ${candidateName}` : ''}`}
      maxWidth="max-w-[640px]"
    >
      <form onSubmit={handleSaveFeedback} className="space-y-4">
        <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
          Feedback is final once saved and visible to HireNest. It is shared with the vendor only if HireNest approves.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <RatingInput
            label="Skill assessment"
            value={skillRating}
            onChange={setSkillRating}
          />
          <RatingInput
            label="Communication"
            value={commRating}
            onChange={setCommRating}
          />
          <RatingInput
            label="Overall rating"
            value={overallRating}
            onChange={setOverallRating}
          />
        </div>

        <Select
          label="Decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value as InterviewDecision)}
          options={[
            { value: 'advance', label: 'Advance to next round' },
            { value: 'hold', label: 'Hold for review' },
            { value: 'reject', label: 'Reject' },
            { value: 'additional_assessment', label: 'Additional assessment required' },
          ]}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Feedback summary (min 10 chars)
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={aiTidying}
              onClick={handleTidyNotes}
            >
              Tidy my notes
            </Button>
          </div>
          <Textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Strong grasp of distributed transactions; struggled with concurrency debugging scenario."
          />

          {aiError && (
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">{aiError}</p>
          )}

          {aiSuggestedNotes && (
            <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onUse={() => {
                  setFeedback(aiSuggestedNotes);
                  setAiSuggestedNotes(null);
                }}
                onDismiss={() => setAiSuggestedNotes(null)}
              />
              <textarea
                rows={3}
                value={aiSuggestedNotes}
                onChange={(e) => setAiSuggestedNotes(e.target.value)}
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px] leading-[20px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)]"
              />
            </div>
          )}
        </div>

        <Textarea
          label="Evidence / observations (optional)"
          rows={2}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Coding exercise outcomes, system design trade-offs..."
        />

        {formError && (
          <p className="text-[12px] leading-[16px] text-[var(--status-danger)]">{formError}</p>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Submit feedback
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 3. Candidate Quality Rating Modal (6 dimensions 1–5)
export const CandidateQualityModal: React.FC<{
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName?: string;
  onSubmitted: () => void;
}> = ({ open, onClose, submissionId, candidateName, onSubmitted }) => {
  const { toast } = useToast();
  const [jdSkillAlignment, setJdSkillAlignment] = useState(0);
  const [relevantExperience, setRelevantExperience] = useState(0);
  const [resumeAccuracy, setResumeAccuracy] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [interviewReadiness, setInterviewReadiness] = useState(0);
  const [overallSuitability, setOverallSuitability] = useState(0);
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !jdSkillAlignment ||
      !relevantExperience ||
      !resumeAccuracy ||
      !communication ||
      !interviewReadiness ||
      !overallSuitability
    ) {
      setError('All six quality dimensions require a 1–5 rating.');
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      await createCandidateQualityFeedback({
        submission_id: submissionId,
        jd_skill_alignment: jdSkillAlignment,
        relevant_experience: relevantExperience,
        resume_accuracy: resumeAccuracy,
        communication,
        interview_readiness: interviewReadiness,
        overall_suitability: overallSuitability,
        comments: comments.trim() || null,
      });

      toast({
        title: 'Candidate quality rating saved',
        tone: 'success',
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(mapSupabaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rate candidate quality"
      description={`Evaluate submission across 6 dimensions${candidateName ? ` · ${candidateName}` : ''}.`}
      maxWidth="max-w-[640px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RatingInput
            label="1. JD skill alignment"
            value={jdSkillAlignment}
            onChange={setJdSkillAlignment}
          />
          <RatingInput
            label="2. Relevant experience"
            value={relevantExperience}
            onChange={setRelevantExperience}
          />
          <RatingInput
            label="3. Resume accuracy"
            value={resumeAccuracy}
            onChange={setResumeAccuracy}
          />
          <RatingInput
            label="4. Communication"
            value={communication}
            onChange={setCommunication}
          />
          <RatingInput
            label="5. Interview readiness"
            value={interviewReadiness}
            onChange={setInterviewReadiness}
          />
          <RatingInput
            label="6. Overall suitability"
            value={overallSuitability}
            onChange={setOverallSuitability}
          />
        </div>

        <Textarea
          label="Comments (optional)"
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Notes on profile accuracy or shortlist calibration..."
        />

        {error && (
          <p className="text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save rating
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 4. First-Round Screening Session Runner Modal
export const ScreeningInterviewRunnerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  interviewId: string;
  submissionId: string;
  mode: InterviewMode;
  candidateName?: string;
  requirementTitle?: string;
  requirementDescription?: string;
  requirementSkills?: string[];
  candidateSkills?: string[];
  candidateExperienceYears?: number | null;
  candidateCurrentTitle?: string | null;
  onCompleted: () => void;
}> = ({
  open,
  onClose,
  interviewId,
  mode,
  candidateName = 'Candidate',
  requirementTitle = 'Requirement',
  requirementDescription = '',
  requirementSkills = [],
  candidateSkills = [],
  candidateExperienceYears = null,
  candidateCurrentTitle = null,
  onCompleted,
}) => {
  const { toast } = useToast();

  const buildBaselineQuestions = () => {
    const primarySkills =
      requirementSkills.length > 0
        ? requirementSkills.slice(0, 3)
        : candidateSkills.slice(0, 3);
    const items = primarySkills.map((sk) => ({
      topic: `Core skill: ${sk}`,
      question: `Describe a production system or project where you applied ${sk}, including architecture decisions and measurable outcomes.`,
      whatToLookFor: `Concrete hands-on ownership, trade-offs, and debugging depth in ${sk}.`,
      response: '',
    }));
    items.push({
      topic: 'Role alignment & problem solving',
      question: `For ${requirementTitle}, walk through how you approach ambiguous requirements, stakeholder communication, and delivery under tight SLAs.`,
      whatToLookFor: 'Structured communication, prioritization, and realistic risk management.',
      response: '',
    });
    return items;
  };

  const [consentVerified, setConsentVerified] = useState(false);
  const [qaList, setQaList] = useState<
    Array<{ topic: string; question: string; whatToLookFor: string; response: string }>
  >(buildBaselineQuestions);

  const [strengths, setStrengths] = useState('');
  const [gaps, setGaps] = useState('');
  const [followUps, setFollowUps] = useState('');
  const [summaryNotes, setSummaryNotes] = useState('');

  const [skillRating, setSkillRating] = useState(0);
  const [commRating, setCommRating] = useState(0);
  const [overallRating, setOverallRating] = useState(0);
  const [decision, setDecision] = useState<InterviewDecision>('advance');

  const [aiLoading, setAiLoading] = useState(false);
  const [aiEvaluating, setAiEvaluating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLoadSuggestedQuestions = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await suggestInterviewQuestions({
        requirement_title: requirementTitle,
        requirement_description: requirementDescription,
        requirement_skills: requirementSkills,
        candidate_skills: candidateSkills,
        total_experience_years: candidateExperienceYears,
        current_title: candidateCurrentTitle,
        round_type: 'initial_screening',
      });
      setAiLabel(res.label);
      if (res.questions.length > 0) {
        setQaList(
          res.questions.map((q) => ({
            topic: q.topic,
            question: q.question,
            whatToLookFor: q.whatToLookFor,
            response: '',
          }))
        );
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiLoading(false);
    }
  };

  const handleEvaluateWithAi = async () => {
    const answeredCount = qaList.filter((q) => q.response.trim().length > 0).length;
    if (answeredCount === 0) {
      setAiError('Record at least one candidate response before running AI screening evaluation.');
      return;
    }
    setAiEvaluating(true);
    setAiError(null);
    try {
      const res = await evaluateScreeningResponses({
        requirement_title: requirementTitle,
        requirement_skills: requirementSkills,
        mode,
        qa_pairs: qaList.map((q) => ({
          topic: q.topic,
          question: q.question,
          response: q.response,
        })),
      });
      setAiLabel(res.label);
      if (res.evaluation) {
        setStrengths(res.evaluation.strengths || strengths);
        setGaps(res.evaluation.gaps || gaps);
        setFollowUps(res.evaluation.followUps || followUps);
        setSummaryNotes(res.evaluation.summary || summaryNotes);
        if (res.evaluation.skill_rating) setSkillRating(res.evaluation.skill_rating);
        if (res.evaluation.communication_rating) {
          setCommRating(res.evaluation.communication_rating);
        }
        if (res.evaluation.overall_rating) setOverallRating(res.evaluation.overall_rating);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI evaluation unavailable right now');
    } finally {
      setAiEvaluating(false);
    }
  };

  const handleCompleteScreening = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentVerified) {
      setFormError('Confirm candidate consent and modality verification before saving.');
      return;
    }
    const answeredCount = qaList.filter((q) => q.response.trim().length > 0).length;
    if (answeredCount === 0) {
      setFormError('Capture at least one candidate response before completing the screening.');
      return;
    }
    if (!skillRating || !commRating || !overallRating) {
      setFormError('Provide separate ratings (1–5) for Skill, Communication, and Overall.');
      return;
    }
    if (summaryNotes.trim().length < 10) {
      setFormError('Evaluation summary must be at least 10 characters.');
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const modalityNote =
        mode === 'ai_text'
          ? 'MODALITY: ai_text (Structured Text Capture — Written communication evaluated; speech/voice prosody not claimed).'
          : `MODALITY: ${mode} (Live Screening Capture).`;

      const qaTranscript = qaList
        .map(
          (q, idx) =>
            `Q${idx + 1} [${q.topic}]: ${q.question}\nCaptured Response: ${
              q.response.trim() || '(Not answered)'
            }`
        )
        .join('\n\n');

      const compiledEvidence = [
        modalityNote,
        `STRENGTHS: ${strengths.trim() || 'None noted'}`,
        `UNPROVEN / GAPS: ${gaps.trim() || 'None noted'}`,
        `RECOMMENDED FOLLOW-UPS: ${followUps.trim() || 'None noted'}`,
        '--- CAPTURED Q&A TRANSCRIPT ---',
        qaTranscript,
      ].join('\n');

      await updateInterviewStatusRpc({
        p_interview_id: interviewId,
        p_status: 'completed',
      });

      await createInterviewFeedback({
        interview_id: interviewId,
        skill_rating: skillRating,
        communication_rating: commRating,
        overall_rating: overallRating,
        decision,
        feedback: summaryNotes.trim(),
        evidence: compiledEvidence,
      });

      toast({
        title: 'Screening completed & recorded',
        tone: 'success',
      });
      onCompleted();
      onClose();
    } catch (err) {
      setFormError(mapSupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Screening session · ${candidateName}`}
      description={`${requirementTitle} · Modality: ${mode}`}
      maxWidth="max-w-[640px]"
    >
      <form onSubmit={handleCompleteScreening} className="space-y-4">
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] leading-[16px] space-y-2">
          <p className="text-[var(--text-secondary)]">
            {mode === 'ai_text'
              ? 'Structured text capture: communication rating evaluates written clarity and structure only.'
              : `Live ${mode} capture: communication and role-skill evidence are evaluated on separate axes.`}
          </p>
          <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={consentVerified}
              onChange={(e) => setConsentVerified(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[4px] border-[var(--border-strong)]"
            />
            <span>Candidate consent and capture modality ({mode}) verified</span>
          </label>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Screening questions ({qaList.length})
            </h4>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={aiLoading}
                onClick={handleLoadSuggestedQuestions}
              >
                Suggest interview questions
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={aiEvaluating}
                onClick={handleEvaluateWithAi}
              >
                Evaluate responses with AI
              </Button>
            </div>
          </div>

          {aiError && (
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">{aiError}</p>
          )}
          {aiLabel && (
            <AiSuggestionBanner label={aiLabel} onDismiss={() => setAiLabel(null)} />
          )}

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {qaList.map((item, idx) => (
              <div
                key={idx}
                className="rounded-[6px] border border-[var(--border)] p-3 space-y-2 bg-[var(--bg-subtle)] text-[13px] leading-[20px]"
              >
                <div className="flex items-center justify-between text-[12px] leading-[16px]">
                  <span className="font-medium text-[var(--text-primary)]">
                    Q{idx + 1}. {item.topic}
                  </span>
                  <span className="text-[var(--text-tertiary)] truncate max-w-xs">
                    {item.whatToLookFor}
                  </span>
                </div>
                <p className="text-[var(--text-primary)]">{item.question}</p>
                <Textarea
                  label="Candidate response"
                  rows={2}
                  value={item.response}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQaList((prev) =>
                      prev.map((q, i) => (i === idx ? { ...q, response: val } : q))
                    );
                  }}
                  placeholder="Record candidate response..."
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Textarea
            label="Strengths"
            rows={2}
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            placeholder="Proven JD skills..."
          />
          <Textarea
            label="Gaps / unproven"
            rows={2}
            value={gaps}
            onChange={(e) => setGaps(e.target.value)}
            placeholder="Areas needing verification..."
          />
          <Textarea
            label="Follow-ups"
            rows={2}
            value={followUps}
            onChange={(e) => setFollowUps(e.target.value)}
            placeholder="Next-round probes..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[var(--border)]">
          <RatingInput
            label="JD / role-skill"
            value={skillRating}
            onChange={setSkillRating}
          />
          <RatingInput
            label={mode === 'ai_text' ? 'Written communication' : 'Communication'}
            value={commRating}
            onChange={setCommRating}
          />
          <RatingInput
            label="Overall score"
            value={overallRating}
            onChange={setOverallRating}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Recommendation"
            value={decision}
            onChange={(e) => setDecision(e.target.value as InterviewDecision)}
            options={[
              { value: 'advance', label: 'Advance to next round' },
              { value: 'hold', label: 'Hold' },
              { value: 'additional_assessment', label: 'Additional assessment' },
              { value: 'reject', label: 'Reject' },
            ]}
          />
          <Textarea
            label="Evaluation summary (min 10 chars)"
            rows={2}
            value={summaryNotes}
            onChange={(e) => setSummaryNotes(e.target.value)}
            placeholder="Concise screening recommendation..."
          />
        </div>

        {formError && (
          <p className="text-[12px] leading-[16px] text-[var(--status-danger)]">{formError}</p>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Complete & save report
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
