import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Ban, Star, Clock, ShieldCheck } from 'lucide-react';
import {
  Drawer,
  Button,
  Badge,
  Card,
  Dialog,
  Textarea,
  Skeleton,
} from '../ui/kit';
import {
  SourceBadge,
  StageBadge,
  Phase2ComingSoonCard,
} from './DomainBadges';
import {
  ScheduleInterviewModal,
  InterviewFeedbackModal,
  CandidateQualityModal,
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
  STAGE_LABELS,
  CANDIDATE_STAGE_LABELS,
  ROUND_LABELS,
  formatLocalDateTime,
} from '../../lib/format';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../ui/Toast';
import type { AppRole, Interview, SubmissionStage } from '../../types/db';

export const SubmissionDetailDrawer: React.FC<{
  submissionId: string | null;
  onClose: () => void;
  role: AppRole;
}> = ({ submissionId, onClose, role }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isCandidate = role === 'candidate';

  // Confirmation modal states for transitions & mark invalid
  const [targetStage, setTargetStage] = useState<SubmissionStage | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [transitionLoading, setTransitionLoading] = useState(false);

  const [markInvalidOpen, setMarkInvalidOpen] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  const [invalidLoading, setInvalidLoading] = useState(false);

  // Interview & Quality rating modals
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackInterview, setFeedbackInterview] = useState<Interview | null>(null);
  const [qualityModalOpen, setQualityModalOpen] = useState(false);

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

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['submission_detail', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_history', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_interviews', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submission_quality_feedback', submissionId] });
    queryClient.invalidateQueries({ queryKey: ['submissions'] });
    queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
  };

  const handleConfirmTransition = async () => {
    if (!submission || !targetStage) return;
    const needsReason = transitionRequiresReason(targetStage);
    if (needsReason && !transitionReason.trim()) {
      toast({
        title: 'Reason required',
        description: `Please provide a reason to move to ${STAGE_LABELS[targetStage]}.`,
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

  return (
    <Drawer
      open={Boolean(submissionId)}
      onClose={onClose}
      title={
        submission?.candidates?.full_name
          ? `Pipeline Record · ${submission.candidates.full_name}`
          : 'Submission Detail'
      }
      subtitle={submission?.requirements?.title || ''}
      widthClass="max-w-2xl"
    >
      {isLoading || !submission ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header summary & Three-Way Attribution (Rule 7) */}
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StageBadge stage={submission.stage} candidateView={isCandidate} />
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
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Submitted: {formatLocalDateTime(submission.created_at)}
              </span>
            </div>

            {!isCandidate && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-slate-500 block">Submission Source</span>
                  <span className="font-medium capitalize">
                    {submission.source === 'vendor'
                      ? `Vendor (${submission.organizations?.name || 'Agency'})`
                      : submission.source === 'direct'
                        ? 'Direct Applicant'
                        : 'HireNest Sourced'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Original Candidate Source</span>
                  <span className="font-medium capitalize">
                    {submission.candidates?.original_source || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Current Vendor Association</span>
                  <span className="font-medium">
                    {submission.candidates?.owner_vendor?.name || 'None (Direct / Internal)'}
                  </span>
                </div>
              </div>
            )}

            {isClient && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Contact details are managed by HireNest</span>
                <span>·</span>
                <span>Resume available on request from HireNest</span>
              </div>
            )}
          </Card>

          {/* Allowed Stage Transition Actions (Section 5.5) */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Available Actions
              </h3>
              {isHq && submission.is_valid && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMarkInvalidOpen(true)}
                  className="text-red-600 dark:text-red-400"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Mark Invalid
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {allowedTransitions.map((nextStage) => {
                const label =
                  nextStage === 'client_review'
                    ? 'Share with client'
                    : isCandidate && nextStage === 'withdrawn'
                      ? 'Withdraw Application'
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

              {(isHq || isClient) &&
                (submission.stage === 'client_review' ||
                  submission.stage === 'interviewing') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setScheduleOpen(true)}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Schedule Interview
                  </Button>
                )}

              {(isHq || isClient) && submission.shared_with_client_at && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setQualityModalOpen(true)}
                >
                  <Star className="h-3.5 w-3.5" />
                  Rate Candidate Quality
                </Button>
              )}

              {allowedTransitions.length === 0 && !isHq && !isClient && (
                <span className="text-xs text-slate-500">
                  No stage transitions available for your role at this stage.
                </span>
              )}
            </div>
          </Card>

          {/* Interviews & Structured Ratings */}
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Interviews ({interviewsData?.data?.length || 0})
            </h3>
            {!interviewsData?.data?.length ? (
              <p className="text-xs text-slate-500">No interview rounds scheduled yet.</p>
            ) : (
              <div className="space-y-3">
                {interviewsData.data.map((iv) => {
                  const feedbacks = iv.interview_feedback || [];
                  return (
                    <div
                      key={iv.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          Round #{iv.round_number}: {ROUND_LABELS[iv.round_type]} ({iv.mode})
                        </div>
                        <Badge
                          tone={
                            iv.status === 'completed'
                              ? 'emerald'
                              : iv.status === 'scheduled'
                                ? 'indigo'
                                : 'red'
                          }
                        >
                          {iv.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-slate-500 font-mono tabular-nums">
                        <span>Scheduled: {formatLocalDateTime(iv.scheduled_at)}</span>
                        <span>Duration: {iv.duration_minutes}m</span>
                        {iv.meeting_link && (
                          <a
                            href={iv.meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 dark:text-indigo-400 underline font-sans"
                          >
                            Meeting Link
                          </a>
                        )}
                      </div>

                      {(isHq || isClient) && iv.status === 'scheduled' && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateInterviewStatus(iv.id, 'completed')}
                          >
                            Mark Completed
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateInterviewStatus(iv.id, 'no_show')}
                          >
                            Mark No-Show
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateInterviewStatus(iv.id, 'cancelled')}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}

                      {(isHq || isClient) && iv.status === 'completed' && (
                        <div className="pt-1">
                          <Button
                            size="sm"
                            onClick={() => setFeedbackInterview(iv)}
                          >
                            Submit Interview Feedback
                          </Button>
                        </div>
                      )}

                      {/* Feedback received */}
                      {feedbacks.length > 0 && !isCandidate && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          {feedbacks.map((fb) => (
                            <div
                              key={fb.id}
                              className="rounded bg-slate-50 dark:bg-slate-800/50 p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">
                                  Overall: {fb.overall_rating}/5 · Skill: {fb.skill_rating}/5 · Comm:{' '}
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
                              <p className="text-slate-700 dark:text-slate-300">{fb.feedback}</p>
                              {fb.evidence && (
                                <p className="text-slate-500">Evidence: {fb.evidence}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Candidate Quality Feedback List */}
          {!isCandidate && (qualityData?.data?.length || 0) > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Candidate Quality Ratings ({qualityData?.data?.length})
              </h3>
              <div className="space-y-2">
                {qualityData!.data.map((qf) => (
                  <div
                    key={qf.id}
                    className="rounded border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-mono tabular-nums">
                      <span>Overall Suitability: {qf.overall_suitability}/5</span>
                      <span>JD Align: {qf.jd_skill_alignment}/5</span>
                      <span>Readiness: {qf.interview_readiness}/5</span>
                    </div>
                    {qf.comments && (
                      <p className="text-slate-600 dark:text-slate-300">{qf.comments}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Phase 2 Disabled Card: AI screening interview (Section 7.E) */}
          {!isCandidate && (
            <Phase2ComingSoonCard
              title="AI Screening Interview (Coming soon, Ollama)"
              description="Autonomous voice/text screening via local Ollama is disabled in MVP behind platform_settings.ai_screening_enabled."
            />
          )}

          {/* Stage Timeline (submission_stage_history) */}
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Stage History Timeline
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No stage transitions logged yet.</p>
            ) : (
              <div className="space-y-2.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-2.5 last:border-0 last:pb-0 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {item.from_stage
                          ? `${
                              isCandidate
                                ? CANDIDATE_STAGE_LABELS[item.from_stage]
                                : STAGE_LABELS[item.from_stage]
                            } → `
                          : ''}
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {isCandidate
                            ? CANDIDATE_STAGE_LABELS[item.to_stage]
                            : STAGE_LABELS[item.to_stage]}
                        </span>
                      </div>
                      {!isCandidate && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          <span>
                            Actor: {item.profiles?.full_name || item.actor_role} ({item.actor_role})
                          </span>
                        </div>
                      )}
                      {item.reason && (
                        <p className="text-slate-600 dark:text-slate-400">
                          Reason: {item.reason}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {formatLocalDateTime(item.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Confirmation Dialog for Stage Transition */}
      <Dialog
        open={Boolean(targetStage)}
        onClose={() => setTargetStage(null)}
        title={
          targetStage === 'client_review'
            ? 'Share Candidate with Client'
            : targetStage
              ? `Confirm Transition to ${STAGE_LABELS[targetStage]}`
              : 'Confirm Transition'
        }
        description="Every pipeline transition is logged in submission_stage_history."
      >
        <div className="space-y-4">
          <Textarea
            label={
              targetStage && transitionRequiresReason(targetStage)
                ? 'Reason (Required)'
                : 'Transition Note / Reason (Optional)'
            }
            rows={3}
            value={transitionReason}
            onChange={(e) => setTransitionReason(e.target.value)}
            placeholder="Provide context for the audit trail..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTargetStage(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmTransition} loading={transitionLoading}>
              Confirm Transition
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Mark Invalid Dialog (HQ only) */}
      <Dialog
        open={markInvalidOpen}
        onClose={() => setMarkInvalidOpen(false)}
        title="Mark Submission Invalid"
        description="Marks this submission non-compliant for vendor process compliance metrics."
      >
        <div className="space-y-4">
          <Textarea
            label="Invalidity Reason (Required)"
            rows={3}
            value={invalidReason}
            onChange={(e) => setInvalidReason(e.target.value)}
            placeholder="e.g. Candidate did not consent to submission or profile skills fabricated."
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
              Mark Invalid
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
    </Drawer>
  );
};
