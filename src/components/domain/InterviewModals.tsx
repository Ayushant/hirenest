import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sparkles } from 'lucide-react';
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
import { suggestInterviewQuestions, tidyInterviewNotes } from '../../api/ai';
import { mapSupabaseError } from '../../lib/errors';
import { ROUND_LABELS } from '../../lib/format';
import { useToast } from '../ui/Toast';
import type {
  InterviewDecision,
  InterviewMode,
  InterviewRound,
} from '../../types/db';

// 1. Schedule Interview Modal (includes "Suggest interview questions" from JD + candidate skills)
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
  const [aiLabel, setAiLabel] = useState('AI suggestion: review before use');

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
      title="Schedule Interview Round"
      description="Scheduling a round moves a client_review submission into interviewing."
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Interview Round"
            {...register('round_type')}
            error={errors.round_type?.message}
            options={[
              { value: 'initial_screening', label: 'Initial Screening' },
              { value: 'ai_screening', label: 'First-Round Screening (Structured Q&A)' },
              { value: 'technical', label: 'Technical Round' },
              { value: 'managerial', label: 'Managerial Round' },
              { value: 'final', label: 'Final Round' },
            ]}
          />
          <Select
            label="Mode"
            {...register('mode')}
            error={errors.mode?.message}
            options={[
              { value: 'video', label: 'Video Call' },
              { value: 'phone', label: 'Phone Call' },
              { value: 'in_person', label: 'In Person' },
              { value: 'ai_text', label: 'Structured Text Capture (ai_text)' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Date & Time (Local Time)"
            type="datetime-local"
            {...register('scheduled_at')}
            error={errors.scheduled_at?.message}
          />
          <Input
            label="Duration (Minutes)"
            type="number"
            {...register('duration_minutes')}
            error={errors.duration_minutes?.message}
          />
        </div>

        <Input
          label="Meeting Link (Optional)"
          placeholder="https://meet.google.com/..."
          {...register('meeting_link')}
          error={errors.meeting_link?.message}
        />

        {/* Guarded AI Suggestion: "Suggest interview questions" from JD + candidate skills */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Interview Preparation Guide
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Generates structured questions from requirement skills and candidate skill tags.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={aiLoading}
              onClick={handleSuggestQuestions}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              Suggest interview questions
            </Button>
          </div>

          {aiError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{aiError}</p>
          )}

          {aiQuestions.length > 0 && (
            <div className="space-y-2 pt-1">
              <AiSuggestionBanner
                label={aiLabel}
                onDismiss={() => setAiQuestions([])}
              />
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {aiQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-xs space-y-1"
                  >
                    <div className="font-semibold text-indigo-700 dark:text-indigo-300">
                      {idx + 1}. {q.topic}
                    </div>
                    <p className="text-slate-800 dark:text-slate-200">{q.question}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      What to look for: {q.whatToLookFor}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Schedule Interview
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 2. Section 8.1 Client / HQ Interview Feedback Modal (with "Tidy my notes")
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

  // Post-submit optional rejection prompt when decision === 'reject'
  const [offerRejectPrompt, setOfferRejectPrompt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingSubmission, setRejectingSubmission] = useState(false);

  // Guarded AI Suggestion: "Tidy my notes"
  const [aiTidying, setAiTidying] = useState(false);
  const [aiSuggestedNotes, setAiSuggestedNotes] = useState<string | null>(null);
  const [aiLabel, setAiLabel] = useState('AI suggestion: review before use');
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
      setFormError('Please select a 1–5 rating for all three assessment criteria.');
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
        description:
          'Feedback is final and visible to HireNest. It is shared with the vendor only if HireNest approves.',
        tone: 'success',
      });

      onSubmitted();

      // Section 8.1: If the decision is Reject, offer (do not force) moving the submission to rejected
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
        title="Move Submission to Rejected?"
        description="Your interview decision was Reject. Would you also like to move this candidate's pipeline submission to Rejected?"
      >
        <div className="space-y-4">
          <Textarea
            label="Rejection Reason (Required for pipeline transition)"
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
              Keep Current Stage
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={rejectingSubmission}
              disabled={!rejectReason.trim()}
              onClick={handleConfirmRejectSubmission}
            >
              Reject Submission
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
      title="Submit Interview Feedback"
      description={`${ROUND_LABELS[roundType]}${candidateName ? ` · ${candidateName}` : ''}`}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSaveFeedback} className="space-y-4">
        <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
          Interview Stage: <strong className="text-slate-900 dark:text-slate-100">{ROUND_LABELS[roundType]}</strong>.
          Feedback is final once saved and visible to HireNest. It is shared with the vendor only if HireNest approves.
        </div>

        <RatingInput
          label="Job-Related Skill Assessment"
          value={skillRating}
          onChange={setSkillRating}
        />

        <RatingInput
          label="Communication and Clarity"
          value={commRating}
          onChange={setCommRating}
        />

        <RatingInput
          label="Overall Interview Rating"
          value={overallRating}
          onChange={setOverallRating}
        />

        <Select
          label="Interview Decision"
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Feedback Summary (Required, min 10 chars)
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={aiTidying}
              onClick={handleTidyNotes}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              Tidy my notes
            </Button>
          </div>
          <Textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Example: Strong grasp of distributed transactions and query indexing; struggled with live concurrency debugging scenario."
          />

          {aiError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{aiError}</p>
          )}

          {aiSuggestedNotes && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-slate-50 dark:bg-slate-950 p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onDismiss={() => setAiSuggestedNotes(null)}
              />
              <textarea
                rows={3}
                value={aiSuggestedNotes}
                onChange={(e) => setAiSuggestedNotes(e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-800 dark:text-slate-200"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAiSuggestedNotes(null)}
                >
                  Keep Original
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setFeedback(aiSuggestedNotes);
                    setAiSuggestedNotes(null);
                  }}
                >
                  Apply Tidied Notes
                </Button>
              </div>
            </div>
          )}
        </div>

        <Textarea
          label="Specific Evidence / Observations (Optional)"
          rows={2}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Specific coding exercise outcomes, system design trade-offs discussed..."
        />

        {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Submit Final Feedback
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 3. Section 8.2 Candidate Quality Rating Modal (6 dimensions 1–5)
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
        description: 'Recorded for HireNest vendor quality governance.',
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
      title="Rate Candidate Submission Quality"
      description={`Evaluate submission quality across 6 dimensions${candidateName ? ` for ${candidateName}` : ''}.`}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <RatingInput
          label="1. JD Skill Alignment"
          value={jdSkillAlignment}
          onChange={setJdSkillAlignment}
        />
        <RatingInput
          label="2. Relevant Experience"
          value={relevantExperience}
          onChange={setRelevantExperience}
        />
        <RatingInput
          label="3. Resume Accuracy & Completeness"
          value={resumeAccuracy}
          onChange={setResumeAccuracy}
        />
        <RatingInput
          label="4. Communication & Professionalism"
          value={communication}
          onChange={setCommunication}
        />
        <RatingInput
          label="5. Interview Readiness"
          value={interviewReadiness}
          onChange={setInterviewReadiness}
        />
        <RatingInput
          label="6. Overall Candidate Suitability"
          value={overallSuitability}
          onChange={setOverallSuitability}
        />

        <Textarea
          label="Comments (Optional)"
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Notes on profile accuracy or shortlist calibration..."
        />

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Quality Rating
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// 4. First-Round Screening Session Runner Modal (PRD Section 4.13 & Flow E)
// Captures real structured Q&A responses in declared modality, separates JD/role-skill vs communication ratings,
// records strengths, gaps, and follow-ups into interview_feedback without claiming speech evaluation on text.
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

  // Build deterministic baseline questions from requirement + candidate skills
  const buildBaselineQuestions = () => {
    const primarySkills =
      requirementSkills.length > 0
        ? requirementSkills.slice(0, 3)
        : candidateSkills.slice(0, 3);
    const items = primarySkills.map((sk) => ({
      topic: `Core Skill: ${sk}`,
      question: `Describe a production system or project where you applied ${sk}, including architecture decisions and measurable outcomes.`,
      whatToLookFor: `Concrete hands-on ownership, trade-offs, and debugging depth in ${sk}.`,
      response: '',
    }));
    items.push({
      topic: 'Role Alignment & Problem Solving',
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

  // Separate JD/role-skill rating vs communication rating (PRD Section 4.13)
  const [skillRating, setSkillRating] = useState(0);
  const [commRating, setCommRating] = useState(0);
  const [overallRating, setOverallRating] = useState(0);
  const [decision, setDecision] = useState<InterviewDecision>('advance');

  const [aiLoading, setAiLoading] = useState(false);
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

  const handleCompleteScreening = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentVerified) {
      setFormError('Please confirm candidate consent and modality verification before saving.');
      return;
    }
    const answeredCount = qaList.filter((q) => q.response.trim().length > 0).length;
    if (answeredCount === 0) {
      setFormError('Capture at least one real candidate response before completing the screening.');
      return;
    }
    if (!skillRating || !commRating || !overallRating) {
      setFormError(
        'Provide separate ratings (1–5) for JD/Role-Skill Evidence, Written/Verbal Communication, and Overall Standing.'
      );
      return;
    }
    if (summaryNotes.trim().length < 10) {
      setFormError('Screening evaluation summary must be at least 10 characters.');
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      // Build structured evidence report (Modality declaration + Q&A responses + Strengths + Gaps + Follow-ups)
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

      // 1. Mark interview completed via canonical RPC
      await updateInterviewStatusRpc({
        p_interview_id: interviewId,
        p_status: 'completed',
      });

      // 2. Persist evaluation report in interview_feedback
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
        title: 'First-round screening completed & recorded',
        description: 'Structured Q&A responses, separate skill/communication scores, and evidence saved.',
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
      title={`First-Round Screening Session · ${candidateName}`}
      description={`Requirement: ${requirementTitle} · Declared Modality: ${mode}`}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleCompleteScreening} className="space-y-4">
        {/* Modality & Consent Gate (Flow E & Section 4.13) */}
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-indigo-950 dark:text-indigo-200">
              Modality & Governance Notice ({mode === 'ai_text' ? 'Structured Text Capture' : mode})
            </span>
            <span className="font-mono text-[11px] text-indigo-700 dark:text-indigo-300">
              Advisory Evaluation · Human Decision Final
            </span>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            {mode === 'ai_text'
              ? 'This session captures structured text responses. Communication rating assesses written clarity and structure only; speech or audio prosody is never claimed when text is captured.'
              : `This session captures live ${mode} responses. Communication and JD/role-skill evidence are evaluated on separate axes.`}
          </p>
          <label className="flex items-center gap-2 pt-1 cursor-pointer font-medium text-slate-900 dark:text-slate-100">
            <input
              type="checkbox"
              checked={consentVerified}
              onChange={(e) => setConsentVerified(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>
              Candidate consent and capture modality ({mode}) verified for this screening round
            </span>
          </label>
        </div>

        {/* Questions & Real Response Capture */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              JD & Profile-Grounded Screening Questions ({qaList.length})
            </h4>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={aiLoading}
              onClick={handleLoadSuggestedQuestions}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              Suggest interview questions
            </Button>
          </div>

          {aiError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{aiError}</p>
          )}
          {aiLabel && (
            <AiSuggestionBanner label={aiLabel} onDismiss={() => setAiLabel(null)} />
          )}

          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {qaList.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50/50 dark:bg-slate-950/40 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                    Q{idx + 1}. {item.topic}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Rubric focus: {item.whatToLookFor}
                  </span>
                </div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{item.question}</p>
                <Textarea
                  label="Captured Candidate Response"
                  rows={2}
                  value={item.response}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQaList((prev) =>
                      prev.map((q, i) => (i === idx ? { ...q, response: val } : q))
                    );
                  }}
                  placeholder="Record the candidate's actual response and technical specifics..."
                />
              </div>
            ))}
          </div>
        </div>

        {/* Evidence Breakdown: Strengths, Gaps, Follow-ups */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Textarea
            label="Observed Strengths"
            rows={2}
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            placeholder="Proven JD skills & project depth..."
          />
          <Textarea
            label="Gaps / Unproven Areas"
            rows={2}
            value={gaps}
            onChange={(e) => setGaps(e.target.value)}
            placeholder="Skills needing deeper verification..."
          />
          <Textarea
            label="Recommended Follow-Ups"
            rows={2}
            value={followUps}
            onChange={(e) => setFollowUps(e.target.value)}
            placeholder="Probes for next technical round..."
          />
        </div>

        {/* Separate Assessment Axes: JD/Role-Skill vs Communication */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <RatingInput
            label="JD / Role-Skill Answers (1–5)"
            value={skillRating}
            onChange={setSkillRating}
          />
          <RatingInput
            label={
              mode === 'ai_text'
                ? 'Written Communication (1–5)'
                : 'Communication Clarity (1–5)'
            }
            value={commRating}
            onChange={setCommRating}
          />
          <RatingInput
            label="Overall Screening Score (1–5)"
            value={overallRating}
            onChange={setOverallRating}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Human Reviewer Recommendation"
            value={decision}
            onChange={(e) => setDecision(e.target.value as InterviewDecision)}
            options={[
              { value: 'advance', label: 'Advance to Next Round' },
              { value: 'hold', label: 'Hold' },
              { value: 'additional_assessment', label: 'Needs Additional Assessment' },
              { value: 'reject', label: 'Reject' },
            ]}
          />
          <Textarea
            label="Evaluation Summary (Min 10 characters)"
            rows={2}
            value={summaryNotes}
            onChange={(e) => setSummaryNotes(e.target.value)}
            placeholder="Concise screening recommendation for hiring team..."
          />
        </div>

        {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Complete Screening & Save Report
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

