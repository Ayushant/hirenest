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
  round_type: z.enum(['initial_screening', 'technical', 'managerial', 'final']),
  scheduled_at: z.string().min(1, 'Date and time are required'),
  duration_minutes: z.coerce.number().int().min(15).max(240),
  mode: z.enum(['video', 'phone', 'in_person']),
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
