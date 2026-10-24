import React, { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Layers, Trash2 } from 'lucide-react';
import {
  PageHeader,
  MetricStrip,
  Button,
  Input,
  Select,
  Badge,
  Tabs,
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
  softDeleteRequirement,
  consolidateDuplicateRequirements,
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
import {
  detectDuplicateRequirementGroups,
  type DuplicateRequirementGroup,
} from '../../lib/enterpriseLifecycle';
import { mapSupabaseError } from '../../lib/errors';
import {
  ROUND_LABELS,
  formatFinancialAmount,
  formatLocalDate,
  formatLocalDateTime,
  formatRequirementBudgetWithSubtitle,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  InterviewRound,
  InterviewStatus,
  Requirement,
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
        onlyClientMapped: true,
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

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  return (
    <div className="space-y-8">
      <div className="dashboard-header-band rounded-[10px] border border-[var(--border)] px-6 py-5">
        <h1 className="type-greeting text-[var(--text-primary)]">
          Good day, {firstName}
        </h1>
        <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Client hiring overview and items awaiting your review.
        </p>
      </div>

      {/* Needs attention */}
      <div className="space-y-2.5">
        <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Needs attention
        </h2>
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
          {(reviewSubs?.count ?? 0) > 0 && (
            <div
              onClick={() => navigate('/client/candidates')}
              className="flex h-11 items-center justify-between px-4 hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <div className="flex items-center gap-2 text-[13px]">
                <Badge tone="warning">Candidates awaiting client review</Badge>
              </div>
              <span className="font-mono tabular-nums text-[13px] font-medium text-[var(--text-primary)]">
                {reviewSubs?.count ?? 0}
              </span>
            </div>
          )}
          {pendingFeedback.map((pf) => (
            <div
              key={pf.interview_id}
              onClick={() => navigate('/client/interviews')}
              className="flex h-11 items-center justify-between px-4 hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <div className="flex items-center gap-2 text-[13px]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-danger-dot)]" />
                <span className="font-medium text-[var(--text-primary)]">
                  {pf.candidate_name}
                </span>
                <span className="text-[var(--text-secondary)]">
                  · {pf.requirement_title} (Round {pf.round_number}:{' '}
                  {ROUND_LABELS[pf.round_type]})
                </span>
              </div>
              <span className="text-[12px] font-medium text-[var(--accent)]">
                Submit feedback →
              </span>
            </div>
          ))}
          {(reviewSubs?.count ?? 0) === 0 && pendingFeedback.length === 0 && (
            <div className="flex h-11 items-center px-4 text-[13px] text-[var(--text-secondary)]">
              All candidate reviews and interview evaluations are up to date.
            </div>
          )}
        </div>
      </div>

      {/* 4-Metric Strip */}
      <MetricStrip
        items={[
          {
            label: 'Open requirements',
            value: openReqs?.count ?? 0,
            onClick: () => navigate('/client/requirements'),
          },
          {
            label: 'Awaiting review',
            value: reviewSubs?.count ?? 0,
            tone: (reviewSubs?.count ?? 0) > 0 ? 'warning' : 'default',
            onClick: () => navigate('/client/candidates'),
          },
          {
            label: 'Upcoming interviews',
            value: upcomingInterviews?.count ?? 0,
            onClick: () => navigate('/client/interviews'),
          },
          {
            label: 'Pending feedback',
            value: pendingFeedback.length,
            tone: pendingFeedback.length > 0 ? 'danger' : 'default',
            onClick: () => navigate('/client/interviews'),
          },
        ]}
      />
    </div>
  );
};

// 2. Client Requirements List Page
export const ClientRequirementsPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const isManager = profile?.role === 'client_manager';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RequirementStatus | ''>('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [createOpen, setCreateOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Requirement | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [duplicatesModalOpen, setDuplicatesModalOpen] = useState(false);
  const [canonicalSelectionByGroup, setCanonicalSelectionByGroup] = useState<
    Record<string, string>
  >({});
  const [consolidatingAll, setConsolidatingAll] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['client_requirements', profile?.org_id, page, status, search],
    queryFn: () =>
      fetchRequirements({
        page,
        pageSize: 100,
        clientOrgId: profile?.org_id || undefined,
        onlyClientMapped: true,
        status,
        search,
      }),
    enabled: Boolean(profile?.org_id),
  });

  const rows = data?.data || [];
  const duplicateGroups = useMemo(
    () => detectDuplicateRequirementGroups(rows),
    [rows]
  );
  const totalExtraDuplicateRecords = useMemo(
    () =>
      duplicateGroups.reduce(
        (acc, grp) => acc + Math.max(0, grp.requirements.length - 1),
        0
      ),
    [duplicateGroups]
  );

  const getSelectedCanonicalId = (grp: DuplicateRequirementGroup): string => {
    const chosen = canonicalSelectionByGroup[grp.groupKey];
    if (chosen && grp.requirements.some((r) => r.id === chosen)) {
      return chosen;
    }
    return grp.recommendedCanonicalId;
  };

  const refreshClientReqs = () => {
    queryClient.invalidateQueries({ queryKey: ['client_requirements'] });
    queryClient.invalidateQueries({ queryKey: ['client_open_reqs'] });
    queryClient.invalidateQueries({ queryKey: ['requirements'] });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await softDeleteRequirement({
        requirement: deleteTarget,
        deletedBy: profile?.id || profile?.email || 'client_manager',
        reason: deleteReason.trim() || 'Deleted from Client Requirements table',
      });
      toast({
        title: 'Requirement archived (soft-deleted)',
        description: `"${deleteTarget.title}" was removed from active requirements.`,
        tone: 'success',
      });
      setDeleteTarget(null);
      setDeleteReason('');
      refreshClientReqs();
    } catch (err) {
      toast({
        title: 'Could not delete requirement',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleConsolidateAll = async () => {
    if (!duplicateGroups.length) return;
    setConsolidatingAll(true);
    let totalArchived = 0;
    try {
      for (const grp of duplicateGroups) {
        const canonicalId = getSelectedCanonicalId(grp);
        const canonicalReq =
          grp.requirements.find((r) => r.id === canonicalId) || grp.requirements[0];
        const duplicatesToArchive = grp.requirements.filter((r) => r.id !== canonicalReq.id);
        if (!duplicatesToArchive.length) continue;

        const res = await consolidateDuplicateRequirements({
          canonicalRequirement: canonicalReq,
          duplicateRequirements: duplicatesToArchive,
          deletedBy: profile?.id || profile?.email || 'client_manager',
        });
        totalArchived += res.archivedIds.length;
      }
      toast({
        title: 'Duplicate requirements consolidated',
        description: `Archived ${totalArchived} duplicate requirement(s) while retaining canonical records.`,
        tone: 'success',
      });
      setDuplicatesModalOpen(false);
      refreshClientReqs();
    } catch (err) {
      toast({
        title: 'Could not consolidate duplicates',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setConsolidatingAll(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Requirements"
        description="Author job specifications, manage internal budgets, and submit requisitions to HireNest HQ."
        actions={
          isManager ? (
            <div className="flex items-center gap-2">
              {duplicateGroups.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setDuplicatesModalOpen(true)}
                >
                  <Layers className="h-3.5 w-3.5 text-amber-500" />
                  Review duplicates ({totalExtraDuplicateRecords})
                </Button>
              )}
              <Button onClick={() => setCreateOpen(true)}>Create requirement</Button>
            </div>
          ) : undefined
        }
      />

      {isManager && duplicateGroups.length > 0 && (
        <div className="rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
                {duplicateGroups.length} duplicate requirement group(s) detected ({totalExtraDuplicateRecords} redundant record{totalExtraDuplicateRecords === 1 ? '' : 's'})
              </div>
              <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--text-secondary)]">
                Review duplicate postings, choose the canonical record to retain, and archive redundant rows.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setDuplicatesModalOpen(true)}>
            Review &amp; clean up duplicates
          </Button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
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
            { value: '', label: 'All statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'pending_approval', label: 'Pending approval' },
            { value: 'open', label: 'Open' },
            { value: 'on_hold', label: 'On hold' },
            { value: 'closed', label: 'Closed' },
            { value: 'filled', label: 'Filled' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState
          title="No requirements created yet"
          description={
            isManager
              ? 'Create a draft requirement and submit it to HireNest HQ for approval.'
              : 'Your hiring manager has not created any requirements yet.'
          }
          actionLabel={isManager ? 'Create requirement' : undefined}
          onAction={isManager ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Location &amp; mode</th>
                  <th className="text-right">Vendor budget</th>
                  <th>Created</th>
                  {isManager && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((req) => {
                  const budgetInfo = formatRequirementBudgetWithSubtitle(req);
                  const shortId = req.id.replace(/-/g, '').slice(0, 8).toUpperCase();
                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/client/requirements/${req.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {req.title}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-tertiary)]">
                          ID: {shortId}
                        </div>
                      </td>
                      <td>
                        <RequirementStatusBadge status={req.status} />
                      </td>
                      <td className="capitalize text-[var(--text-secondary)]">
                        {req.location} · {req.work_mode}
                      </td>
                      <td className="text-right">
                        <div className="font-mono tabular-nums text-[var(--text-primary)]">
                          {budgetInfo.formatted}
                        </div>
                        {budgetInfo.subtitle && (
                          <div className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
                            {budgetInfo.subtitle}
                          </div>
                        )}
                      </td>
                      <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {formatLocalDate(req.created_at)}
                      </td>
                      {isManager && (
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(req);
                              setDeleteReason('');
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={rows.length} onPageChange={setPage} />
        </div>
      )}

      {/* Soft-Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteLoading) {
            setDeleteTarget(null);
            setDeleteReason('');
          }
        }}
        title={deleteTarget ? `Delete requirement "${deleteTarget.title}"?` : 'Delete requirement'}
        description="Soft deletion removes this requirement from active lists while preserving linked submissions and audit history."
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] leading-[18px] space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Requirement title</span>
                <span className="font-semibold text-[var(--text-primary)]">{deleteTarget.title}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Requirement ID</span>
                <span className="font-mono text-[var(--text-primary)]">{deleteTarget.id}</span>
              </div>
            </div>

            <Textarea
              label="Reason (optional)"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Duplicate posting or obsolete requisition..."
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={deleteLoading}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteLoading}
                onClick={handleConfirmDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirm delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Duplicate Cleanup Modal */}
      <Dialog
        open={duplicatesModalOpen}
        onClose={() => setDuplicatesModalOpen(false)}
        title="Review & clean up duplicate requirements"
        description="Select the canonical record to retain for each duplicate group. Linked submissions and financial notes will be preserved before archiving duplicates."
        maxWidth="max-w-[740px]"
      >
        <div className="space-y-4">
          {duplicateGroups.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-6 text-center space-y-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto" />
              <div className="text-[14px] font-medium text-[var(--text-primary)]">
                No duplicate requirements detected
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-[420px] overflow-y-auto space-y-4 pr-1">
                {duplicateGroups.map((grp) => {
                  const selectedCanonicalId = getSelectedCanonicalId(grp);
                  return (
                    <div
                      key={grp.groupKey}
                      className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                            {grp.title}
                          </span>
                          <span className="ml-2 text-[12px] text-[var(--text-secondary)]">
                            ({grp.location} · {grp.workMode})
                          </span>
                        </div>
                        <Badge tone="amber">{grp.requirements.length} records</Badge>
                      </div>
                      <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface)]">
                        {grp.requirements.map((item) => {
                          const isCanonical = item.id === selectedCanonicalId;
                          return (
                            <label
                              key={item.id}
                              className={`flex items-start justify-between gap-3 p-3 text-[12px] cursor-pointer ${
                                isCanonical ? 'bg-[#1F4CC4]/5' : 'hover:bg-[var(--bg-hover)]'
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <input
                                  type="radio"
                                  name={`client_canonical_${grp.groupKey}`}
                                  checked={isCanonical}
                                  onChange={() =>
                                    setCanonicalSelectionByGroup((prev) => ({
                                      ...prev,
                                      [grp.groupKey]: item.id,
                                    }))
                                  }
                                  className="mt-1 accent-[#1F4CC4]"
                                />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-semibold text-[var(--text-primary)]">
                                      ID: {item.id}
                                    </span>
                                    {isCanonical ? (
                                      <Badge tone="emerald">Canonical (Retain)</Badge>
                                    ) : (
                                      <Badge tone="warning">Duplicate (Archive)</Badge>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[var(--text-secondary)]">
                                    Skills ({item.skills?.length || 0}):{' '}
                                    {item.skills?.length ? item.skills.join(', ') : 'None'} · Created:{' '}
                                    <span className="font-mono">{formatLocalDateTime(item.created_at)}</span>
                                  </div>
                                </div>
                              </div>
                              <RequirementStatusBadge status={item.status} />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <Button variant="outline" onClick={() => setDuplicatesModalOpen(false)}>
                  Close
                </Button>
                <Button loading={consolidatingAll} onClick={handleConsolidateAll}>
                  Consolidate all ({duplicateGroups.length} group{duplicateGroups.length === 1 ? '' : 's'})
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog>

      {isManager && (
        <RequirementFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={(saved) => {
            refreshClientReqs();
            queryClient.invalidateQueries({ queryKey: ['requirement_detail', saved.id] });
            queryClient.invalidateQueries({ queryKey: ['requirement_financials', saved.id] });
            navigate(`/client/requirements/${saved.id}`);
          }}
          role={profile?.role || 'client_manager'}
          userOrgId={profile?.org_id || null}
        />
      )}
    </div>
  );
};

// 3. Client Requirement Detail Page (2-column 1200px layout)
export const ClientRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isManager = profile?.role === 'client_manager';
  const [activeTab, setActiveTab] = useState<'overview'>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<RequirementStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const { data: req, isLoading } = useQuery({
    queryKey: ['requirement_detail', id, profile?.role, profile?.org_id],
    queryFn: () =>
      fetchRequirementById(id!, {
        viewerRole: profile?.role || 'client_manager',
        viewerOrgId: profile?.org_id || null,
      }),
    enabled: Boolean(id),
  });

  const { data: financials } = useQuery({
    queryKey: ['requirement_financials', id],
    queryFn: () => fetchRequirementFinancials(id!),
    enabled: Boolean(id && req),
  });

  if (isLoading) return <TableSkeleton rows={4} cols={4} />;
  if (!req) {
    return (
      <EmptyState
        title="Requirement not available"
        description="This requirement is not mapped to your client organization or does not exist."
      />
    );
  }

  const budgetInfo = formatRequirementBudgetWithSubtitle(req);

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
    <div className="max-w-[1200px]">
      <PageHeader
        title={req.title}
        description={`${req.location} (${req.work_mode}) · ${req.min_experience}–${req.max_experience} yrs · ${req.openings} opening(s)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RequirementStatusBadge status={req.status} />
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
            {isManager && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                Edit specification
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 min-w-0 w-full space-y-6">
          <Tabs
            tabs={[{ id: 'overview', label: 'Specification' }]}
            activeTab={activeTab}
            onChange={() => setActiveTab('overview')}
          />

          <div className="space-y-6">
            <div>
              <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                Description
              </h3>
              <p className="text-[14px] leading-[22px] text-[var(--text-primary)] whitespace-pre-line">
                {req.description}
              </p>
            </div>

            <div className="pt-4 border-t border-[var(--border)]">
              <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                Required skills ({req.skills.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {req.skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Budget & Financial Governance Summary Card */}
            <div className="pt-4 border-t border-[var(--border)]">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                      Budget &amp; internal financial governance
                    </h3>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Vendor-visible budget vs. private internal client budget and financial notes.
                    </p>
                  </div>
                  {isManager && (
                    <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                      Edit budget &amp; notes
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                      Vendor-visible budget
                    </div>
                    <div className="mt-1 font-mono tabular-nums text-[15px] font-semibold text-[var(--text-primary)]">
                      {budgetInfo.formatted}
                    </div>
                    {budgetInfo.subtitle && (
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {budgetInfo.subtitle}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                      Internal client budget
                    </div>
                    <div className="mt-1 font-mono tabular-nums text-[15px] font-semibold text-[var(--text-primary)]">
                      {formatFinancialAmount(financials?.actual_client_budget, req)}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      Private (Client + HQ only)
                    </div>
                  </div>

                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                      Internal financial notes
                    </div>
                    <div className="mt-1 text-[13px] text-[var(--text-primary)] break-words">
                      {financials?.notes || '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right key-facts rail (320px) */}
        <aside className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-6 lg:pt-0 lg:pl-6 space-y-4">
          <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">
            Key facts
          </h3>
          <dl className="divide-y divide-[var(--border)] text-[13px]">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Status</dt>
              <dd><RequirementStatusBadge status={req.status} /></dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Vendor budget</dt>
              <dd className="text-right">
                <div className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {budgetInfo.formatted}
                </div>
                {budgetInfo.subtitle && (
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    {budgetInfo.subtitle}
                  </div>
                )}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Internal budget</dt>
              <dd className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                {formatFinancialAmount(financials?.actual_client_budget, req)}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Financial notes</dt>
              <dd className="text-right text-[var(--text-primary)] max-w-[180px] break-words">
                {financials?.notes || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Submission SLA</dt>
              <dd className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.submission_sla_hours}h
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Created</dt>
              <dd className="font-mono tabular-nums text-[var(--text-secondary)]">
                {formatLocalDate(req.created_at)}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {isManager && (
        <RequirementFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['client_requirements'] });
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
        title={`Move requirement to ${targetStatus}`}
      >
        <div className="space-y-4">
          <Textarea
            label="Reason (optional)"
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

// 4. Client Candidates for Review Page
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
    <div>
      <PageHeader
        title="Candidates for review"
        description="Evaluate shortlisted candidates shared by HireNest HQ. Contact details are managed by HireNest."
      />

      <div className="mb-4 max-w-xs">
        <Select
          value={stageFilter}
          onChange={(e) => {
            setStageFilter(e.target.value as SubmissionStage | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All shared stages' },
            { value: 'client_review', label: 'Client review' },
            { value: 'interviewing', label: 'Interviewing' },
            { value: 'offered', label: 'Offered' },
            { value: 'offer_accepted', label: 'Offer accepted' },
            { value: 'onboarded', label: 'Onboarded' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No candidates shared for review yet"
          description="HireNest HQ shares shortlisted candidates here once recruiter screening is complete."
        />
      ) : (
        <div>
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {data.data.map((sub) => (
              <div key={sub.id} className="py-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[14px] font-medium text-[var(--text-primary)]">
                        {sub.candidates?.full_name || 'Candidate'}
                      </span>
                      <StageBadge stage={sub.stage} />
                      <SourceBadge
                        source={sub.source}
                        vendorName={sub.organizations?.name}
                      />
                    </div>
                    <p className="text-[13px] text-[var(--text-secondary)]">
                      {sub.candidates?.current_title || '—'} ·{' '}
                      <span className="font-mono tabular-nums">
                        {sub.candidates?.total_experience_years ?? '—'} yrs
                      </span>{' '}
                      · Requirement:{' '}
                      <span className="text-[var(--text-primary)] font-medium">
                        {sub.requirements?.title}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEvidenceReqId(sub.requirement_id);
                        setEvidenceCandId(sub.candidate_id);
                      }}
                    >
                      Match evidence
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
                      Rate quality
                    </Button>
                    {(sub.stage === 'client_review' || sub.stage === 'interviewing') && (
                      <Button
                        size="sm"
                        variant="outline"
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
                        Schedule interview
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setDrawerSubId(sub.id)}>
                      Review
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(sub.candidates?.skills || []).map((sk) => (
                    <span
                      key={sk}
                      className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
                    >
                      {sk}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--text-tertiary)]">
                  <span>Contact details are managed by HireNest</span>
                  <span>Resume available on request from HireNest</span>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <Dialog
        open={Boolean(evidenceReqId && evidenceCandId)}
        onClose={() => {
          setEvidenceReqId(null);
          setEvidenceCandId(null);
        }}
        title="Match evidence"
      >
        {activeEvidenceMatch ? (
          <MatchEvidencePanel match={activeEvidenceMatch} />
        ) : (
          <p className="text-[13px] text-[var(--text-secondary)]">
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
    <div>
      <PageHeader
        title="Interviews"
        description="Manage interview rounds and complete post-round evaluations."
      />

      {pendingFeedback.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-[var(--text-primary)]">
              Pending feedback ({pendingFeedback.length})
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {pendingFeedback.map((pf) => (
              <div
                key={pf.interview_id}
                className="flex h-10 items-center justify-between px-2"
              >
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-danger)]" />
                  <span className="font-medium text-[var(--text-primary)]">
                    {pf.candidate_name}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    · {pf.requirement_title} (Round {pf.round_number}:{' '}
                    {ROUND_LABELS[pf.round_type]})
                  </span>
                </div>
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
                  Submit feedback
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 max-w-xs">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InterviewStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'no_show', label: 'No-show' },
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
          description="Schedule an interview round from Candidates for review."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Candidate & requirement</th>
                  <th>Round</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((iv) => (
                  <tr key={iv.id}>
                    <td>
                      <div className="font-medium text-[var(--text-primary)]">
                        {iv.submissions?.candidates?.full_name || 'Candidate'}
                      </div>
                      <div className="text-[12px] text-[var(--text-secondary)]">
                        {iv.submissions?.requirements?.title || 'Requirement'}
                      </div>
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      Round {iv.round_number} · {ROUND_LABELS[iv.round_type]}
                    </td>
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatLocalDateTime(iv.scheduled_at)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          iv.status === 'completed'
                            ? 'success'
                            : iv.status === 'scheduled'
                              ? 'neutral'
                              : 'danger'
                        }
                      >
                        {iv.status}
                      </Badge>
                    </td>
                    <td className="text-right space-x-1.5">
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
                            No-show
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
                          Submit feedback
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
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

// 6. Client Vendor Summary Page
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
        title="Vendor summary not enabled"
        description="HireNest HQ has not enabled vendor performance summary sharing for client workspaces."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Partner vendor summary"
        description="Composite standing of vendor agencies contributing candidates to your requirements."
      />

      {uniqueVendors.length === 0 ? (
        <EmptyState
          title="No vendor submissions shared yet"
          description="Vendor summaries appear once vendor submissions are shared with your organization."
        />
      ) : (
        <div className="space-y-6">
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
