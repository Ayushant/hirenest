import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  Button,
  Badge,
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

  return (
    <Drawer
      open={Boolean(submissionId)}
      onClose={onClose}
      title={submission?.candidates?.full_name || 'Submission detail'}
      subtitle={submission?.requirements?.title || ''}
      widthClass="max-w-[480px]"
    >
      {isLoading || !submission ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Facts & Attribution */}
          <div className="space-y-3 pb-4 border-b border-[var(--border)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
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
              <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
                {formatLocalDateTime(submission.created_at)}
              </span>
            </div>

            {!isCandidate && (
              <div className="space-y-1.5 pt-2 text-[13px] leading-[20px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Submission source</span>
                  <span className="text-[var(--text-primary)]">
                    {submission.source === 'vendor'
                      ? `Vendor · ${submission.organizations?.name || 'Agency'}`
                      : submission.source === 'direct'
                        ? 'Direct'
                        : 'HireNest'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Original candidate source</span>
                  <span className="text-[var(--text-primary)] capitalize">
                    {submission.candidates?.original_source || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">Vendor association</span>
                  <span className="text-[var(--text-primary)]">
                    {submission.candidates?.owner_vendor?.name || 'None'}
                  </span>
                </div>
              </div>
            )}

            {isClient && (
              <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)] pt-1">
                Contact details are managed by HireNest · Resume available on request.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3 pb-4 border-b border-[var(--border)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                Actions
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

              {(isHq || isClient) &&
                (submission.stage === 'client_review' ||
                  submission.stage === 'interviewing') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScheduleOpen(true)}
                  >
                    Schedule interview
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

              {allowedTransitions.length === 0 && !isHq && !isClient && (
                <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  No stage transitions available for your role at this stage.
                </span>
              )}
            </div>
          </div>

          {/* Interviews */}
          <div className="space-y-3 pb-4 border-b border-[var(--border)]">
            <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Interviews ({interviewsData?.data?.length || 0})
            </h3>
            {!interviewsData?.data?.length ? (
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                No interview rounds scheduled.
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
                              {fb.evidence && (
                                <p className="text-[var(--text-secondary)]">
                                  Evidence: {fb.evidence}
                                </p>
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
          </div>

          {/* Candidate Quality Feedback List */}
          {!isCandidate && (qualityData?.data?.length || 0) > 0 && (
            <div className="space-y-3 pb-4 border-b border-[var(--border)]">
              <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
                Quality ratings ({qualityData?.data?.length})
              </h3>
              <div className="space-y-2">
                {qualityData!.data.map((qf) => (
                  <div
                    key={qf.id}
                    className="rounded-[6px] border border-[var(--border)] p-3 text-[12px] leading-[16px] space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono tabular-nums text-[var(--text-primary)]">
                      <span>Suitability {qf.overall_suitability}/5</span>
                      <span>JD align {qf.jd_skill_alignment}/5</span>
                      <span>Readiness {qf.interview_readiness}/5</span>
                    </div>
                    {qf.comments && (
                      <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                        {qf.comments}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isCandidate && (
            <Phase2ComingSoonCard
              title="Autonomous screening"
              description="Disabled in v1 behind platform_settings.ai_screening_enabled."
            />
          )}

          {/* Stage Timeline */}
          <div className="space-y-3">
            <h3 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Stage history
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
