import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit3, Star, Calendar } from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
  Button,
  Input,
  Select,
  Badge,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Pagination,
  Dialog,
  Textarea,
} from '../../components/ui/kit';
import {
  RequirementStatusBadge,
  SourceBadge,
  StageBadge,
} from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { RequirementFormModal } from '../../components/domain/RequirementFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import {
  InterviewFeedbackModal,
  CandidateQualityModal,
  ScheduleInterviewModal,
} from '../../components/domain/InterviewModals';
import {
  fetchRequirements,
  fetchRequirementById,
  fetchRequirementFinancials,
  setRequirementStatus,
} from '../../api/requirements';
import { fetchSubmissions } from '../../api/submissions';
import {
  fetchInterviews,
  fetchMyPendingFeedback,
  updateInterviewStatusRpc,
  getVendorPerformanceRpc,
} from '../../api/interviews';
import { fetchMatchesForRequirement } from '../../api/candidates';
import { fetchPlatformSettings } from '../../api/admin';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import {
  ROUND_LABELS,
  formatCurrency,
  formatLocalDate,
  formatLocalDateTime,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  InterviewRound,
  InterviewStatus,
  RequirementStatus,
  SubmissionStage,
} from '../../types/db';

// 1. Client Dashboard
export const ClientDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const { data: openReqs } = useQuery({
    queryKey: ['client_open_reqs', profile?.org_id],
    queryFn: () =>
      fetchRequirements({
        clientOrgId: profile?.org_id || undefined,
        status: 'open',
        page: 1,
      }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: reviewSubs } = useQuery({
    queryKey: ['client_review_subs', profile?.org_id],
    queryFn: () => fetchSubmissions({ stage: 'client_review', page: 1 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: upcomingInterviews } = useQuery({
    queryKey: ['client_scheduled_interviews', profile?.org_id],
    queryFn: () => fetchInterviews({ status: 'scheduled', page: 1 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: pendingFeedback = [] } = useQuery({
    queryKey: ['my_pending_feedback', profile?.id],
    queryFn: fetchMyPendingFeedback,
    enabled: Boolean(profile?.id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Hiring Workspace"
        description="Manage your organization's requirements, evaluate shortlisted candidates, and record interview outcomes."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="My Open Requirements"
          value={openReqs?.count ?? 0}
          sublabel="Active requisitions"
          onClick={() => navigate('/client/requirements')}
        />
        <StatCard
          label="Candidates Awaiting Review"
          value={reviewSubs?.count ?? 0}
          tone={(reviewSubs?.count ?? 0) > 0 ? 'amber' : 'default'}
          sublabel="In client_review stage"
          onClick={() => navigate('/client/candidates')}
        />
        <StatCard
          label="Upcoming Interviews"
          value={upcomingInterviews?.count ?? 0}
          sublabel="Scheduled rounds"
          onClick={() => navigate('/client/interviews')}
        />
        <StatCard
          label="Pending Interview Feedback"
          value={pendingFeedback.length}
          tone={pendingFeedback.length > 0 ? 'red' : 'default'}
          sublabel="Mandatory post-round ratings"
          onClick={() => navigate('/client/interviews')}
        />
      </div>

      {/* Quick Pending Feedback List */}
      {pendingFeedback.length > 0 && (
        <Card className="p-5 border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-red-800 dark:text-red-200">
              Action Required: Completed Interviews Pending Your Feedback
            </h3>
            <Badge tone="red">{pendingFeedback.length} Pending</Badge>
          </div>
          <div className="divide-y divide-red-200/60 dark:divide-red-900/40 text-xs">
            {pendingFeedback.map((pf) => (
              <div
                key={pf.interview_id}
                className="py-2 flex items-center justify-between"
              >
                <span>
                  <strong>{pf.candidate_name}</strong> · {pf.requirement_title} (Round #
                  {pf.round_number}: {ROUND_LABELS[pf.round_type]})
                </span>
                <Button size="sm" onClick={() => navigate('/client/interviews')}>
                  Complete Rating
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

// 2. Client Requirements List Page
export const ClientRequirementsPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const isManager = profile?.role === 'client_manager';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RequirementStatus | ''>('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['client_requirements', profile?.org_id, page, status, search],
    queryFn: () =>
      fetchRequirements({
        page,
        clientOrgId: profile?.org_id || undefined,
        status,
        search,
      }),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Organization's Requirements"
        description="Author job specifications, manage private internal budgets, and submit requisitions to HireNest HQ."
        actions={
          isManager ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Requirement
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
        <Input
          placeholder="Search requirement title..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as RequirementStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'pending_approval', label: 'Pending Approval' },
            { value: 'open', label: 'Open' },
            { value: 'on_hold', label: 'On Hold' },
            { value: 'closed', label: 'Closed' },
            { value: 'filled', label: 'Filled' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No requirements created yet"
          description={
            isManager
              ? 'Create a draft requirement and submit it to HireNest HQ for approval.'
              : 'Your hiring manager has not created any requirements yet.'
          }
          actionLabel={isManager ? 'Create Requirement' : undefined}
          onAction={isManager ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Requirement Title</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Location & Mode</th>
                <th className="py-3 px-4 text-right">Vendor Budget</th>
                <th className="py-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((req) => (
                <tr
                  key={req.id}
                  onClick={() => navigate(`/client/requirements/${req.id}`)}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                    {req.title}
                  </td>
                  <td className="py-3 px-4">
                    <RequirementStatusBadge status={req.status} />
                  </td>
                  <td className="py-3 px-4 capitalize text-slate-500">
                    {req.location} · {req.work_mode}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatCurrency(req.vendor_visible_budget, req.currency)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDate(req.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      {isManager && (
        <RequirementFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={(saved) => {
            queryClient.invalidateQueries({ queryKey: ['client_requirements'] });
            navigate(`/client/requirements/${saved.id}`);
          }}
          role={profile?.role || 'client_manager'}
          userOrgId={profile?.org_id || null}
        />
      )}
    </div>
  );
};

// 3. Client Requirement Detail Page (with allowed client_manager status actions)
export const ClientRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isManager = profile?.role === 'client_manager';
  const [editOpen, setEditOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<RequirementStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const { data: req, isLoading } = useQuery({
    queryKey: ['requirement_detail', id],
    queryFn: () => fetchRequirementById(id!),
    enabled: Boolean(id),
  });

  const { data: financials } = useQuery({
    queryKey: ['requirement_financials', id],
    queryFn: () => fetchRequirementFinancials(id!),
    enabled: Boolean(id),
  });

  if (isLoading || !req) return <TableSkeleton rows={4} cols={4} />;

  // Section 5.4 & 6.2: Allowed status actions for client_manager:
  // draft->pending_approval, pending_approval->draft, open<->on_hold, draft/open/on_hold->closed
  const allowedActions: Array<{ to: RequirementStatus; label: string }> = [];
  if (isManager) {
    if (req.status === 'draft') {
      allowedActions.push({ to: 'pending_approval', label: 'Submit for approval' });
      allowedActions.push({ to: 'closed', label: 'Close' });
    } else if (req.status === 'pending_approval') {
      allowedActions.push({ to: 'draft', label: 'Withdraw to draft' });
    } else if (req.status === 'open') {
      allowedActions.push({ to: 'on_hold', label: 'Put on hold' });
      allowedActions.push({ to: 'closed', label: 'Close' });
    } else if (req.status === 'on_hold') {
      allowedActions.push({ to: 'open', label: 'Reopen' });
      allowedActions.push({ to: 'closed', label: 'Close' });
    }
  }

  const handleStatusConfirm = async () => {
    if (!targetStatus) return;
    setStatusSaving(true);
    try {
      await setRequirementStatus({
        p_requirement_id: req.id,
        p_status: targetStatus,
        p_reason: statusReason.trim() || undefined,
      });
      toast({ title: `Requirement moved to ${targetStatus}`, tone: 'success' });
      setTargetStatus(null);
      setStatusReason('');
      queryClient.invalidateQueries({ queryKey: ['requirement_detail', id] });
    } catch (err) {
      toast({
        title: 'Action failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setStatusSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={req.title}
        description={`${req.location} (${req.work_mode}) · ${req.min_experience}–${req.max_experience} yrs · ${req.openings} opening(s)`}
        actions={
          <div className="flex items-center gap-2">
            <RequirementStatusBadge status={req.status} />
            {isManager && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-3.5 w-3.5" />
                Edit JD & Budgets
              </Button>
            )}
          </div>
        }
      />

      {allowedActions.length > 0 && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Governed Status Actions:
          </span>
          <div className="flex flex-wrap gap-2">
            {allowedActions.map((act) => (
              <Button
                key={act.to}
                size="sm"
                variant={act.to === 'closed' ? 'danger' : 'primary'}
                onClick={() => {
                  setTargetStatus(act.to);
                  setStatusReason('');
                }}
              >
                {act.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 space-y-4">
          <h3 className="text-sm font-semibold">Job Specification</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
            {req.description}
          </p>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold block mb-2">Required Skills</span>
            <div className="flex flex-wrap gap-1.5">
              {req.skills.map((s) => (
                <Badge key={s} tone="indigo">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-3 text-xs">
          <h3 className="text-sm font-semibold">Budget & SLA Summary</h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <div className="py-2 flex justify-between">
              <span className="text-slate-500">Vendor-Visible Budget:</span>
              <span className="font-mono tabular-nums font-semibold">
                {formatCurrency(req.vendor_visible_budget, req.currency)}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-500">Internal Budget (Never shared with vendors):</span>
              <span className="font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                {formatCurrency(financials?.actual_client_budget, req.currency)}
              </span>
            </div>
            {financials?.notes && (
              <div className="py-2">
                <span className="text-slate-500 block">Internal Notes:</span>
                <span>{financials.notes}</span>
              </div>
            )}
            <div className="py-2 flex justify-between">
              <span className="text-slate-500">SLA Hours:</span>
              <span className="font-mono tabular-nums">{req.submission_sla_hours}h</span>
            </div>
          </div>
        </Card>
      </div>

      {isManager && (
        <RequirementFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['requirement_detail', id] });
            queryClient.invalidateQueries({ queryKey: ['requirement_financials', id] });
          }}
          role={profile?.role || 'client_manager'}
          userOrgId={profile?.org_id || null}
          initialRequirement={req}
          initialFinancials={financials}
        />
      )}

      <Dialog
        open={Boolean(targetStatus)}
        onClose={() => setTargetStatus(null)}
        title={`Confirm Status Change to ${targetStatus}`}
      >
        <div className="space-y-4">
          <Textarea
            label="Reason (Optional)"
            rows={3}
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTargetStatus(null)}>
              Cancel
            </Button>
            <Button onClick={handleStatusConfirm} loading={statusSaving}>
              Confirm
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

// 4. Client Candidates for Review Page (Section 6.2: no contact details, resume on request, match evidence, quality rating)
export const ClientCandidatesReviewPage: React.FC = () => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState<SubmissionStage | ''>('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);
  const [qualityTarget, setQualityTarget] = useState<{
    submissionId: string;
    candidateName?: string;
  } | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{
    submissionId: string;
    reqTitle?: string;
    reqDesc?: string;
    reqSkills?: string[];
    candSkills?: string[];
    candExp?: number | null;
    candTitle?: string | null;
  } | null>(null);
  const [evidenceReqId, setEvidenceReqId] = useState<string | null>(null);
  const [evidenceCandId, setEvidenceCandId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['client_submissions', page, stageFilter],
    queryFn: () => fetchSubmissions({ page, stage: stageFilter }),
  });

  const { data: matchEvidenceData } = useQuery({
    queryKey: ['client_match_evidence', evidenceReqId],
    queryFn: () =>
      fetchMatchesForRequirement({ requirementId: evidenceReqId!, page: 1, pageSize: 100 }),
    enabled: Boolean(evidenceReqId),
  });

  const activeEvidenceMatch = matchEvidenceData?.data.find(
    (m) => m.candidate_id === evidenceCandId
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates Shared for Client Review"
        description="Evaluate shortlisted candidates shared by HireNest HQ. Contact details are managed by HireNest."
      />

      <div className="flex items-center gap-3">
        <Select
          value={stageFilter}
          onChange={(e) => {
            setStageFilter(e.target.value as SubmissionStage | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Shared Stages' },
            { value: 'client_review', label: 'Client Review' },
            { value: 'interviewing', label: 'Interviewing' },
            { value: 'offered', label: 'Offered' },
            { value: 'offer_accepted', label: 'Offer Accepted' },
            { value: 'onboarded', label: 'Onboarded' },
            { value: 'rejected', label: 'Rejected' },
          ]}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No candidates shared for review yet"
          description="HireNest HQ will share shortlisted candidates here once recruiter screening is complete."
        />
      ) : (
        <div className="space-y-4">
          {data.data.map((sub) => (
            <Card key={sub.id} className="p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {sub.candidates?.full_name || 'Candidate'}
                    </h3>
                    <StageBadge stage={sub.stage} />
                    <SourceBadge
                      source={sub.source}
                      vendorName={sub.organizations?.name}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {sub.candidates?.current_title || '—'} ·{' '}
                    {sub.candidates?.total_experience_years ?? '—'} yrs exp · Requirement:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {sub.requirements?.title}
                    </strong>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEvidenceReqId(sub.requirement_id);
                      setEvidenceCandId(sub.candidate_id);
                    }}
                  >
                    Match Evidence
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setQualityTarget({
                        submissionId: sub.id,
                        candidateName: sub.candidates?.full_name,
                      })
                    }
                  >
                    <Star className="h-3.5 w-3.5" />
                    Rate Candidate Quality
                  </Button>
                  {(sub.stage === 'client_review' || sub.stage === 'interviewing') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setScheduleTarget({
                          submissionId: sub.id,
                          reqTitle: sub.requirements?.title,
                          reqDesc: sub.requirements?.description,
                          reqSkills: sub.requirements?.skills,
                          candSkills: sub.candidates?.skills,
                          candExp: sub.candidates?.total_experience_years,
                          candTitle: sub.candidates?.current_title,
                        })
                      }
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Schedule Interview
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setDrawerSubId(sub.id)}>
                    Review & Stage Actions
                  </Button>
                </div>
              </div>

              {/* Skills & Governed Contact/Resume Notices */}
              <div className="flex flex-wrap gap-1.5">
                {(sub.candidates?.skills || []).map((sk) => (
                  <Badge key={sk} tone="slate">
                    {sk}
                  </Badge>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Contact details are managed by HireNest</span>
                <span>Resume available on request from HireNest</span>
              </div>
            </Card>
          ))}

          <Card>
            <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
          </Card>
        </div>
      )}

      {/* Match Evidence Dialog */}
      <Dialog
        open={Boolean(evidenceReqId && evidenceCandId)}
        onClose={() => {
          setEvidenceReqId(null);
          setEvidenceCandId(null);
        }}
        title="Deterministic Match Evidence"
        maxWidth="max-w-xl"
      >
        {activeEvidenceMatch ? (
          <MatchEvidencePanel match={activeEvidenceMatch} />
        ) : (
          <p className="text-xs text-slate-500">
            Match score record is being calculated or not available for this pair.
          </p>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'client_manager'}
      />

      {qualityTarget && (
        <CandidateQualityModal
          open={Boolean(qualityTarget)}
          onClose={() => setQualityTarget(null)}
          submissionId={qualityTarget.submissionId}
          candidateName={qualityTarget.candidateName}
          onSubmitted={() => {
            queryClient.invalidateQueries({ queryKey: ['client_submissions'] });
          }}
        />
      )}

      {scheduleTarget && (
        <ScheduleInterviewModal
          open={Boolean(scheduleTarget)}
          onClose={() => setScheduleTarget(null)}
          submissionId={scheduleTarget.submissionId}
          requirementTitle={scheduleTarget.reqTitle}
          requirementDescription={scheduleTarget.reqDesc}
          requirementSkills={scheduleTarget.reqSkills}
          candidateSkills={scheduleTarget.candSkills}
          candidateExperienceYears={scheduleTarget.candExp}
          candidateCurrentTitle={scheduleTarget.candTitle}
          onScheduled={() => {
            queryClient.invalidateQueries({ queryKey: ['client_submissions'] });
          }}
        />
      )}
    </div>
  );
};

// 5. Client Interviews & Feedback Page
export const ClientInterviewsPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const [feedbackModalTarget, setFeedbackModalTarget] = useState<{
    interviewId: string;
    submissionId: string;
    roundType: InterviewRound;
    candidateName?: string;
  } | null>(null);

  const { data: pendingFeedback = [] } = useQuery({
    queryKey: ['my_pending_feedback'],
    queryFn: fetchMyPendingFeedback,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['client_interviews', page, status],
    queryFn: () => fetchInterviews({ page, status }),
  });

  const handleStatusChange = async (
    interviewId: string,
    nextStatus: 'completed' | 'cancelled' | 'no_show'
  ) => {
    try {
      await updateInterviewStatusRpc({
        p_interview_id: interviewId,
        p_status: nextStatus,
      });
      toast({ title: `Interview marked ${nextStatus}`, tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['client_interviews'] });
      queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
    } catch (err) {
      toast({
        title: 'Could not update interview',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Interviews & Structured Feedback"
        description="Manage interview rounds and complete mandatory post-round evaluations."
      />

      {pendingFeedback.length > 0 && (
        <Card className="p-5 border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-3">
          <h3 className="text-xs font-semibold text-red-800 dark:text-red-200">
            Feedback Pending ({pendingFeedback.length}) — Mandatory after each completed round
          </h3>
          <div className="divide-y divide-red-200/60 dark:divide-red-900/40 text-xs">
            {pendingFeedback.map((pf) => (
              <div
                key={pf.interview_id}
                className="py-2 flex items-center justify-between"
              >
                <span>
                  <strong>{pf.candidate_name}</strong> · {pf.requirement_title} (Round #
                  {pf.round_number}: {ROUND_LABELS[pf.round_type]})
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    setFeedbackModalTarget({
                      interviewId: pf.interview_id,
                      submissionId: pf.submission_id,
                      roundType: pf.round_type,
                      candidateName: pf.candidate_name,
                    })
                  }
                >
                  Submit Feedback
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="max-w-xs">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InterviewStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'no_show', label: 'No-Show' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No interviews scheduled yet"
          description="Schedule an interview round from Candidates for Review."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Candidate & Requirement</th>
                <th className="py-3 px-4">Round</th>
                <th className="py-3 px-4">Scheduled At</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((iv) => (
                <tr key={iv.id}>
                  <td className="py-3 px-4">
                    <div className="font-semibold">
                      {iv.submissions?.candidates?.full_name || 'Candidate'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {iv.submissions?.requirements?.title || 'Requirement'}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    Round #{iv.round_number} · {ROUND_LABELS[iv.round_type]}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {formatLocalDateTime(iv.scheduled_at)}
                  </td>
                  <td className="py-3 px-4">
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
                  </td>
                  <td className="py-3 px-4 text-right space-x-1.5">
                    {iv.status === 'scheduled' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(iv.id, 'completed')}
                        >
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(iv.id, 'no_show')}
                        >
                          No-Show
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(iv.id, 'cancelled')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    {iv.status === 'completed' && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setFeedbackModalTarget({
                            interviewId: iv.id,
                            submissionId: iv.submission_id,
                            roundType: iv.round_type,
                            candidateName: iv.submissions?.candidates?.full_name,
                          })
                        }
                      >
                        Submit Feedback
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      {feedbackModalTarget && (
        <InterviewFeedbackModal
          open={Boolean(feedbackModalTarget)}
          onClose={() => setFeedbackModalTarget(null)}
          interviewId={feedbackModalTarget.interviewId}
          submissionId={feedbackModalTarget.submissionId}
          roundType={feedbackModalTarget.roundType}
          candidateName={feedbackModalTarget.candidateName}
          onSubmitted={() => {
            queryClient.invalidateQueries({ queryKey: ['client_interviews'] });
            queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
          }}
        />
      )}
    </div>
  );
};

// 6. Client Vendor Summary Page (only if share_vendor_summary_with_clients is true)
export const ClientVendorSummaryPage: React.FC = () => {
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['platform_settings'],
    queryFn: fetchPlatformSettings,
  });

  const { data: submissionsData, isLoading: loadingSubs } = useQuery({
    queryKey: ['client_vendor_subs_summary'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 100 }),
    enabled: Boolean(settings?.share_vendor_summary_with_clients),
  });

  const uniqueVendors = React.useMemo(() => {
    const map = new Map<string, string>();
    (submissionsData?.data || []).forEach((s) => {
      if (s.vendor_org_id && s.organizations?.name) {
        map.set(s.vendor_org_id, s.organizations.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [submissionsData]);

  const [selectedVendorId, setSelectedVendorId] = useState<string>('');

  const { data: vendorPerf } = useQuery({
    queryKey: ['client_vendor_perf', selectedVendorId],
    queryFn: () => getVendorPerformanceRpc(selectedVendorId),
    enabled: Boolean(
      selectedVendorId && settings?.share_vendor_summary_with_clients
    ),
  });

  if (loadingSettings || loadingSubs) {
    return <TableSkeleton rows={4} cols={3} />;
  }

  if (!settings?.share_vendor_summary_with_clients) {
    return (
      <EmptyState
        title="Vendor Summary Not Enabled"
        description="HireNest HQ has not enabled vendor performance summary sharing for client workspaces."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner Vendor Summary"
        description="Overall standing of vendor agencies contributing candidates to your requirements."
      />

      {uniqueVendors.length === 0 ? (
        <EmptyState
          title="No vendor submissions shared yet"
          description="Vendor summaries appear once vendor submissions are shared with your organization."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {uniqueVendors.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant={selectedVendorId === v.id ? 'primary' : 'outline'}
                onClick={() => setSelectedVendorId(v.id)}
              >
                {v.name}
              </Button>
            ))}
          </div>

          {selectedVendorId && vendorPerf && (
            <VendorPerformancePanel performance={vendorPerf} clientSummaryOnly />
          )}
        </div>
      )}
    </div>
  );
};
