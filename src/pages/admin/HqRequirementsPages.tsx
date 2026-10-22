import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInDays, parseISO } from 'date-fns';
import { Plus, RefreshCw } from 'lucide-react';
import {
  PageHeader,
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
  SlaBadge,
  ScoreBar,
} from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { RequirementFormModal } from '../../components/domain/RequirementFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  fetchRequirements,
  fetchRequirementById,
  fetchRequirementFinancials,
  fetchRequirementMargins,
  fetchRequirementVendorShares,
  setRequirementStatus,
  setRequirementPublic,
  shareRequirementWithVendors,
  revokeRequirementShare,
} from '../../api/requirements';
import {
  fetchMatchesForRequirement,
  overrideMatchScore,
  recomputeRequirementMatches,
} from '../../api/candidates';
import {
  fetchSubmissions,
  submitCandidateRpc,
} from '../../api/submissions';
import { fetchOrganizations, fetchAuditLogs } from '../../api/admin';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import {
  STAGE_LABELS,
  formatCurrency,
  formatLocalDate,
  formatLocalDateTime,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  CandidateMatch,
  RequirementStatus,
  SubmissionStage,
} from '../../types/db';

// 1. HQ Requirements List Page
export const HqRequirementsListPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const prefix = profile?.role === 'admin' ? '/admin' : '/recruiter';

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RequirementStatus | ''>(
    (searchParams.get('status') as RequirementStatus) || ''
  );
  const [clientOrgId, setClientOrgId] = useState('');
  const [publicFilter, setPublicFilter] = useState<string>('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['requirements', page, status, clientOrgId, publicFilter, search],
    queryFn: () =>
      fetchRequirements({
        page,
        status,
        clientOrgId: clientOrgId || undefined,
        isPublic:
          publicFilter === 'true'
            ? true
            : publicFilter === 'false'
              ? false
              : undefined,
        search,
      }),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['organizations_clients'],
    queryFn: () => fetchOrganizations({ type: 'client', page: 1, pageSize: 100 }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requirements"
        description="Client requisitions, SLA timers, vendor distributions, and deterministic candidate matches."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New requirement
          </Button>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Input
            placeholder="Search title..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-48">
          <Select
            value={clientOrgId}
            onChange={(e) => {
              setClientOrgId(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All clients' },
              ...(clientsData?.data || []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="w-44">
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
        <div className="w-44">
          <Select
            value={publicFilter}
            onChange={(e) => {
              setPublicFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All visibility' },
              { value: 'true', label: 'Public job board' },
              { value: 'false', label: 'Private / vendor only' },
            ]}
          />
        </div>
        {(search || clientOrgId || status || publicFilter) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setClientOrgId('');
              setStatus('');
              setPublicFilter('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No requirements found"
          description="New client requisitions and published roles will appear here."
          actionLabel="New requirement"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Location & mode</th>
                  <th className="text-right">Vendor budget</th>
                  <th className="text-right">SLA</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((req) => (
                  <tr
                    key={req.id}
                    onClick={() => navigate(`${prefix}/requirements/${req.id}`)}
                    className="cursor-pointer"
                  >
                    <td>
                      <div className="font-medium text-[var(--text-primary)]">
                        {req.title}
                      </div>
                      <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
                        {req.min_experience}–{req.max_experience}y · {req.openings} open
                        {req.is_public ? ' · Public' : ''}
                      </div>
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      {req.organizations?.name || '—'}
                    </td>
                    <td>
                      <RequirementStatusBadge status={req.status} />
                    </td>
                    <td className="text-[var(--text-secondary)] capitalize">
                      {req.location} · {req.work_mode}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {formatCurrency(req.vendor_visible_budget, req.currency)}
                    </td>
                    <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {req.submission_sla_hours}h
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDate(req.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <RequirementFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => {
          queryClient.invalidateQueries({ queryKey: ['requirements'] });
          navigate(`${prefix}/requirements/${saved.id}`);
        }}
        role={profile?.role || 'recruiter'}
        userOrgId={profile?.org_id || null}
        clientOrgs={clientsData?.data || []}
      />
    </div>
  );
};

// 2. HQ Requirement 360 Detail Page: Two columns at 1200px (main ~760px with tabs + 320px right rail with key facts & actions)
export const HqRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const role = profile?.role || 'recruiter';
  const isAdmin = role === 'admin';
  const prefix = isAdmin ? '/admin' : '/recruiter';

  const [activeTab, setActiveTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [matchesPage, setMatchesPage] = useState(1);
  const [pipelineView, setPipelineView] = useState<'kanban' | 'table'>('kanban');
  const [drawerSubmissionId, setDrawerSubmissionId] = useState<string | null>(null);

  const [statusTarget, setStatusTarget] = useState<RequirementStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [shareSlaHours, setShareSlaHours] = useState<number>(48);
  const [sharingLoading, setSharingLoading] = useState(false);

  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<CandidateMatch | null>(null);
  const [overrideScoreInput, setOverrideScoreInput] = useState<string>('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  const [submitMatchTarget, setSubmitMatchTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [dupDialogReason, setDupDialogReason] = useState<string | null>(null);

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

  const { data: margins } = useQuery({
    queryKey: ['requirement_margins', id],
    queryFn: () => fetchRequirementMargins(id!),
    enabled: Boolean(id && isAdmin),
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['requirement_shares', id],
    queryFn: () => fetchRequirementVendorShares(id!),
    enabled: Boolean(id),
  });

  const { data: approvedVendors } = useQuery({
    queryKey: ['approved_vendors'],
    queryFn: () =>
      fetchOrganizations({ type: 'vendor', status: 'approved', page: 1, pageSize: 100 }),
  });

  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ['requirement_matches', id, matchesPage],
    queryFn: () => fetchMatchesForRequirement({ requirementId: id!, page: matchesPage }),
    enabled: Boolean(id),
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['requirement_submissions', id],
    queryFn: () => fetchSubmissions({ requirementId: id!, page: 1, pageSize: 100 }),
    enabled: Boolean(id),
  });

  const { data: auditData } = useQuery({
    queryKey: ['requirement_audit', id],
    queryFn: () => fetchAuditLogs({ recordId: id!, page: 1 }),
    enabled: Boolean(id && isAdmin),
  });

  if (isLoading || !req) {
    return <TableSkeleton rows={6} cols={5} />;
  }

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['requirement_detail', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_financials', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_margins', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_shares', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_matches', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_submissions', id] });
  };

  const handleConfirmStatusChange = async () => {
    if (!statusTarget) return;
    setStatusSaving(true);
    try {
      await setRequirementStatus({
        p_requirement_id: req.id,
        p_status: statusTarget,
        p_reason: statusReason.trim() || undefined,
      });
      toast({
        title: 'Requirement status updated',
        description: `Status set to ${statusTarget}.`,
        tone: 'success',
      });
      setStatusTarget(null);
      setStatusReason('');
      refreshAll();
    } catch (err) {
      toast({
        title: 'Status update failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setStatusSaving(false);
    }
  };

  const handleTogglePublic = async () => {
    try {
      await setRequirementPublic({
        p_requirement_id: req.id,
        p_is_public: !req.is_public,
      });
      toast({
        title: !req.is_public
          ? 'Published to direct candidates'
          : 'Requirement made private',
        tone: 'success',
      });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not update visibility',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const handleShareWithVendors = async () => {
    if (selectedVendorIds.length === 0) return;
    setSharingLoading(true);
    try {
      const count = await shareRequirementWithVendors({
        p_requirement_id: req.id,
        p_vendor_org_ids: selectedVendorIds,
        p_sla_hours: shareSlaHours || req.submission_sla_hours,
      });
      toast({
        title: `Shared with ${count} vendor(s)`,
        tone: 'success',
      });
      setSelectedVendorIds([]);
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not share with vendors',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSharingLoading(false);
    }
  };

  const handleRevokeShare = async (vendorOrgId: string) => {
    try {
      await revokeRequirementShare({
        p_requirement_id: req.id,
        p_vendor_org_id: vendorOrgId,
      });
      toast({ title: 'Vendor share revoked', tone: 'info' });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not revoke share',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const handleRecomputeMatches = async () => {
    try {
      await recomputeRequirementMatches(req.id);
      toast({
        title: 'Matches recomputed',
        tone: 'success',
      });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Recompute failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const handleSaveOverride = async () => {
    if (!overrideTarget || !overrideReasonInput.trim()) return;
    setOverrideLoading(true);
    try {
      const parsedScore =
        overrideScoreInput.trim() === '' ? null : Number(overrideScoreInput);
      await overrideMatchScore({
        p_requirement_id: req.id,
        p_candidate_id: overrideTarget.candidate_id,
        p_score: parsedScore,
        p_reason: overrideReasonInput.trim(),
      });
      toast({
        title: parsedScore === null ? 'Override cleared' : 'Match score overridden',
        tone: 'success',
      });
      setOverrideTarget(null);
      refreshAll();
    } catch (err) {
      toast({
        title: 'Override failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setOverrideLoading(false);
    }
  };

  const handleConfirmSubmitCandidate = async () => {
    if (!submitMatchTarget) return;
    setSubmitLoading(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: req.id,
        p_candidate_id: submitMatchTarget.candidate_id,
        p_notes: submitNotes.trim() || null,
      });
      if (res.status === 'duplicate') {
        setDupDialogReason(res.reason);
        setSubmitMatchTarget(null);
        return;
      }
      toast({
        title: 'Candidate submitted to pipeline',
        tone: 'success',
      });
      setSubmitMatchTarget(null);
      setSubmitNotes('');
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not submit candidate',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitLoading(false);
    }
  };

  const submissions = submissionsData?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={req.title}
        description={`${req.organizations?.name || 'Client'} · ${req.location} · ${req.work_mode}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleRecomputeMatches}>
              <RefreshCw className="h-3.5 w-3.5" />
              Recompute matches
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              Edit requirement
            </Button>
          </div>
        }
      />

      {/* Two columns at 1200px: main (~760px) with tabs + right rail (320px) with key facts & primary actions */}
      <div className="flex flex-col lg:flex-row items-start gap-8">
        {/* Main Column */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'status', label: 'Status' },
              { id: 'vendors', label: 'Vendor sharing', count: shares.length },
              {
                id: 'matches',
                label: 'Matches',
                count: matchesData?.count || 0,
              },
              { id: 'pipeline', label: 'Pipeline', count: submissions.length },
              { id: 'activity', label: 'Activity' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  Description
                </h3>
                <p className="text-[14px] leading-[20px] text-[var(--text-primary)] whitespace-pre-line">
                  {req.description}
                </p>
              </div>

              <div className="pt-4 border-t border-[var(--border)] space-y-2">
                <h4 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  Required skills ({req.skills.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {req.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STATUS ACTIONS */}
          {activeTab === 'status' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
                  Requirement status
                </h3>
                <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  Transition requirement status via <code className="font-mono">set_requirement_status</code>.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {(
                    ['draft', 'pending_approval', 'open', 'on_hold', 'closed', 'filled'] as const
                  ).map((st) => (
                    <Button
                      key={st}
                      size="sm"
                      variant={req.status === st ? 'primary' : 'outline'}
                      disabled={req.status === st}
                      onClick={() => {
                        setStatusTarget(st);
                        setStatusReason('');
                      }}
                    >
                      {st.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--border)] flex items-center justify-between">
                <div>
                  <h4 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
                    Direct candidate job board visibility
                  </h4>
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    Currently {req.is_public ? 'public on candidate job board' : 'private to HQ & shared vendors'}.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleTogglePublic}>
                  {req.is_public ? 'Make private' : 'Publish to job board'}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 3: VENDOR SHARING */}
          {activeTab === 'vendors' && (
            <div className="space-y-6">
              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3">
                <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
                  Share with approved vendors
                </h3>
                {req.status !== 'open' ? (
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    Requirement must be in <strong>open</strong> status before sharing with vendors.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(approvedVendors?.data || []).map((v) => {
                        const selected = selectedVendorIds.includes(v.id);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              setSelectedVendorIds((prev) =>
                                selected ? prev.filter((id) => id !== v.id) : [...prev, v.id]
                              )
                            }
                            className={`h-7 px-2.5 rounded-[6px] border text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                              selected
                                ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg)]'
                                : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                            }`}
                          >
                            {v.name} · {v.sla_tier}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-end gap-2 max-w-xs">
                      <Input
                        label="SLA hours"
                        type="number"
                        value={shareSlaHours}
                        onChange={(e) => setShareSlaHours(Number(e.target.value))}
                      />
                      <Button
                        onClick={handleShareWithVendors}
                        loading={sharingLoading}
                        disabled={selectedVendorIds.length === 0}
                      >
                        Share ({selectedVendorIds.length})
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table>
                  <thead>
                    <tr>
                      <th>Vendor agency</th>
                      <th>Shared</th>
                      <th>SLA due</th>
                      <th>Acknowledged</th>
                      <th>First submission</th>
                      <th>SLA status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shares.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-[var(--text-secondary)]">
                          Not shared with any vendor agencies yet.
                        </td>
                      </tr>
                    ) : (
                      shares.map((sh) => {
                        const vendorSubs = submissions
                          .filter((s) => s.vendor_org_id === sh.vendor_org_id && s.is_valid)
                          .sort((a, b) => a.created_at.localeCompare(b.created_at));
                        const firstSubAt = vendorSubs[0]?.created_at || null;
                        return (
                          <tr key={sh.id}>
                            <td className="font-medium">
                              {sh.organizations?.name || sh.vendor_org_id}
                            </td>
                            <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              {formatLocalDateTime(sh.shared_at)}
                            </td>
                            <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              {formatLocalDateTime(sh.due_at)}
                            </td>
                            <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              {formatLocalDateTime(sh.acknowledged_at)}
                            </td>
                            <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              {formatLocalDateTime(firstSubAt)}
                            </td>
                            <td>
                              <SlaBadge
                                dueAt={sh.due_at}
                                firstSubmissionAt={firstSubAt}
                                revokedAt={sh.revoked_at}
                              />
                            </td>
                            <td className="text-right">
                              {!sh.revoked_at && (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => handleRevokeShare(sh.vendor_org_id)}
                                >
                                  Revoke
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: MATCHES (Requirement -> Candidates) */}
          {activeTab === 'matches' && (
            <div className="space-y-4">
              {matchesLoading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : !matchesData?.data.length ? (
                <EmptyState
                  title="No potential matches computed yet"
                  description="Ensure the requirement is open and recompute matches to run the deterministic engine."
                  actionLabel="Recompute matches"
                  onAction={handleRecomputeMatches}
                />
              ) : (
                <div>
                  <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
                    {matchesData.data.map((m, idx) => {
                      const rank = (matchesPage - 1) * 25 + idx + 1;
                      const cand = m.candidates;
                      const existingSub = submissions.find(
                        (s) => s.candidate_id === m.candidate_id
                      );
                      const isOverridden =
                        m.override_score !== null && m.override_score !== undefined;

                      return (
                        <div
                          key={m.id}
                          className="py-3 px-2 hover:bg-[var(--bg-hover)] transition-colors space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono tabular-nums text-[12px] leading-[16px] text-[var(--text-tertiary)] w-6">
                                #{rank}
                              </span>
                              <Link
                                to={`${prefix}/candidates/${m.candidate_id}`}
                                className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] truncate"
                              >
                                {cand?.full_name || m.candidate_id}
                              </Link>
                              <span className="text-[13px] leading-[20px] text-[var(--text-secondary)] truncate">
                                {cand?.current_title || '—'} ·{' '}
                                <span className="font-mono tabular-nums">
                                  {cand?.total_experience_years ?? '—'}y
                                </span>
                              </span>
                              {cand && (
                                <SourceBadge
                                  source={cand.original_source}
                                  vendorName={cand.source_vendor?.name}
                                />
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {!existingSub ? (
                                <Badge tone="amber">Potential match</Badge>
                              ) : (
                                <Badge tone="emerald">
                                  {STAGE_LABELS[existingSub.stage]}
                                </Badge>
                              )}
                              <ScoreBar score={m.final_score} isOverridden={isOverridden} />
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEvidenceTarget(m)}
                                >
                                  Evidence
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setOverrideTarget(m);
                                    setOverrideScoreInput(
                                      m.override_score !== null ? String(m.override_score) : ''
                                    );
                                    setOverrideReasonInput(m.override_reason || '');
                                  }}
                                >
                                  Override
                                </Button>
                                {existingSub ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setDrawerSubmissionId(existingSub.id)}
                                  >
                                    Pipeline
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setSubmitMatchTarget(m);
                                      setSubmitNotes('');
                                    }}
                                  >
                                    Submit
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Matched & Unproven Skill Chips + Experience Note + Override Line */}
                          <div className="pl-9 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(m.matched_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[12px] leading-[16px] text-[var(--text-primary)]"
                                >
                                  {sk}
                                </span>
                              ))}
                              {(m.unproven_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  title="Not found on profile; not proof the skill is missing"
                                  className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]"
                                >
                                  {sk}
                                </span>
                              ))}
                              {m.experience_note && (
                                <span className="text-[12px] leading-[16px] text-[var(--text-secondary)] ml-1">
                                  · {m.experience_note}
                                </span>
                              )}
                            </div>

                            {isOverridden && (
                              <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
                                Overridden by recruiter · {m.override_score}
                                {m.override_reason ? ` · '${m.override_reason}'` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Pagination
                    page={matchesPage}
                    totalCount={matchesData.count}
                    onPageChange={setMatchesPage}
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PIPELINE (Kanban + Table view) */}
          {activeTab === 'pipeline' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  Select any candidate to inspect history or transition stage.
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={pipelineView === 'kanban' ? 'primary' : 'outline'}
                    onClick={() => setPipelineView('kanban')}
                  >
                    Kanban
                  </Button>
                  <Button
                    size="sm"
                    variant={pipelineView === 'table' ? 'primary' : 'outline'}
                    onClick={() => setPipelineView('table')}
                  >
                    Table
                  </Button>
                </div>
              </div>

              {submissions.length === 0 ? (
                <EmptyState
                  title="No pipeline submissions yet"
                  description="Submit candidates from the Matches tab or share this requirement with vendors."
                />
              ) : pipelineView === 'kanban' ? (
                <div className="flex gap-3 overflow-x-auto pb-4">
                  {(
                    [
                      'applied',
                      'recruiter_review',
                      'client_review',
                      'interviewing',
                      'offered',
                      'offer_accepted',
                      'onboarded',
                      'rejected',
                    ] as SubmissionStage[]
                  ).map((st) => {
                    const colSubs = submissions.filter((s) => s.stage === st);
                    const stageHeaderColors: Record<SubmissionStage, string> = {
                      applied: 'text-[var(--status-neutral)]',
                      recruiter_review: 'text-[var(--chip-storm-blue-text)]',
                      client_review: 'text-[var(--chip-rich-blue-text)]',
                      interviewing: 'text-[var(--chip-sky-text)]',
                      offered: 'text-[var(--chip-teal-text)]',
                      offer_accepted: 'text-[var(--status-success)]',
                      onboarded: 'text-[var(--status-success)]',
                      offer_declined: 'text-[var(--status-neutral)]',
                      withdrawn: 'text-[var(--status-neutral)]',
                      rejected: 'text-[var(--status-danger)]',
                    };
                    return (
                      <div
                        key={st}
                        className="w-64 shrink-0 rounded-[10px] border border-[var(--border)] bg-[var(--app-bg)] p-2.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between px-1">
                          <span
                            className={`text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] ${stageHeaderColors[st]}`}
                          >
                            {STAGE_LABELS[st]}
                          </span>
                          <span className="rounded-[6px] bg-[var(--track)] px-1.5 py-0.5 text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-secondary)]">
                            {colSubs.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {colSubs.map((sub) => {
                            const daysInStage = Math.max(
                              0,
                              differenceInDays(new Date(), parseISO(sub.stage_changed_at))
                            );
                            return (
                              <div
                                key={sub.id}
                                onClick={() => setDrawerSubmissionId(sub.id)}
                                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                              >
                                <div className="text-[13px] leading-[20px] font-medium text-[var(--text-primary)] truncate">
                                  {sub.candidates?.full_name || sub.candidate_id}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <SourceBadge
                                    source={sub.source}
                                    vendorName={sub.organizations?.name}
                                  />
                                  <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
                                    {daysInStage}d
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto border-t border-[var(--border)]">
                  <table>
                    <thead>
                      <tr>
                        <th>Candidate</th>
                        <th>Source</th>
                        <th>Stage</th>
                        <th className="text-right">Days in stage</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((sub) => {
                        const days = Math.max(
                          0,
                          differenceInDays(new Date(), parseISO(sub.stage_changed_at))
                        );
                        return (
                          <tr
                            key={sub.id}
                            onClick={() => setDrawerSubmissionId(sub.id)}
                            className="cursor-pointer"
                          >
                            <td className="font-medium">
                              {sub.candidates?.full_name || sub.candidate_id}
                            </td>
                            <td>
                              <SourceBadge
                                source={sub.source}
                                vendorName={sub.organizations?.name}
                              />
                            </td>
                            <td>
                              <StageBadge stage={sub.stage} />
                            </td>
                            <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                              {days}d
                            </td>
                            <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              {formatLocalDateTime(sub.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: ACTIVITY & AUDIT */}
          {activeTab === 'activity' && (
            <div className="space-y-3">
              {!isAdmin ? (
                <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  Audit logs are restricted to HireNest Admin role. Inspect individual submission stage timelines inside the Pipeline tab.
                </p>
              ) : !auditData?.data.length ? (
                <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  No audit entries recorded for this requirement.
                </p>
              ) : (
                <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
                  {auditData.data.map((log) => (
                    <div
                      key={log.id}
                      className="h-10 px-3 flex items-center justify-between text-[13px] leading-[20px]"
                    >
                      <div>
                        <span className="font-mono font-medium uppercase">
                          {log.action}
                        </span>
                        <span className="ml-2 text-[var(--text-secondary)]">
                          by {log.actor_role || 'system'}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                        {formatLocalDateTime(log.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Rail (320px): Key facts as label/value pairs + Primary actions */}
        <aside className="w-full lg:w-[320px] shrink-0 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
              Key facts
            </span>
            <RequirementStatusBadge status={req.status} />
          </div>

          <div className="divide-y divide-[var(--border)] text-[13px] leading-[20px]">
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Client</span>
              <span className="font-medium text-[var(--text-primary)] truncate">
                {req.organizations?.name || '—'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Openings</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.openings}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Experience</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.min_experience}–{req.max_experience} yrs
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Location</span>
              <span className="text-[var(--text-primary)]">{req.location}</span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Work mode</span>
              <span className="capitalize text-[var(--text-primary)]">{req.work_mode}</span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Employment</span>
              <span className="capitalize text-[var(--text-primary)]">
                {req.employment_type.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Submission SLA</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.submission_sla_hours}h
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Job board</span>
              <span className="text-[var(--text-primary)]">
                {req.is_public ? 'Public' : 'Private'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Vendor budget</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {formatCurrency(req.vendor_visible_budget, req.currency)}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Client budget</span>
              <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                {formatCurrency(financials?.actual_client_budget, req.currency)}
              </span>
            </div>
            {financials?.notes && (
              <div className="py-2 space-y-0.5">
                <span className="text-[12px] text-[var(--text-secondary)] block">
                  Financial notes
                </span>
                <span className="text-[12px] text-[var(--text-primary)]">
                  {financials.notes}
                </span>
              </div>
            )}
            {isAdmin && (
              <div className="py-2 flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Platform margin</span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {margins?.platform_margin !== null &&
                  margins?.platform_margin !== undefined
                    ? margins.margin_type === 'percentage'
                      ? `${margins.platform_margin}%`
                      : formatCurrency(margins.platform_margin, req.currency)
                    : '—'}
                </span>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Edit Requirement Modal */}
      <RequirementFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={refreshAll}
        role={role}
        userOrgId={profile?.org_id || null}
        initialRequirement={req}
        initialFinancials={financials}
        initialMargins={margins}
      />

      {/* Confirm Status Dialog */}
      <Dialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        title={`Change status of ${req.title} to ${statusTarget}?`}
      >
        <div className="space-y-4">
          <Textarea
            label="Reason / note (optional)"
            rows={3}
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStatusTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmStatusChange} loading={statusSaving}>
              Confirm
            </Button>
          </div>
        </div>
      </Dialog>

      {/* HQ Match Override Modal */}
      <Dialog
        open={Boolean(overrideTarget)}
        onClose={() => setOverrideTarget(null)}
        title="Override match score"
        description="Recruiter override takes precedence and logs your reason."
      >
        <div className="space-y-4">
          <Input
            label="Override score (0–100, or blank to clear)"
            type="number"
            min={0}
            max={100}
            value={overrideScoreInput}
            onChange={(e) => setOverrideScoreInput(e.target.value)}
          />
          <Textarea
            label="Reason (required)"
            rows={3}
            value={overrideReasonInput}
            onChange={(e) => setOverrideReasonInput(e.target.value)}
            placeholder="e.g. Verified production Kubernetes experience during screening call."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveOverride}
              loading={overrideLoading}
              disabled={!overrideReasonInput.trim()}
            >
              Save override
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Submit Candidate from Match Confirmation Dialog */}
      <Dialog
        open={Boolean(submitMatchTarget)}
        onClose={() => setSubmitMatchTarget(null)}
        title="Submit candidate to requirement"
        description="Review match evidence before creating a pipeline submission."
        maxWidth="max-w-[640px]"
      >
        {submitMatchTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitMatchTarget} />
            <Textarea
              label="Submission notes (optional)"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              placeholder="Shortlist summary or notice period details..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitMatchTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSubmitCandidate} loading={submitLoading}>
                Confirm submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubmissionId}
        onClose={() => setDrawerSubmissionId(null)}
        role={role}
      />

      <DuplicateDialog
        open={Boolean(dupDialogReason)}
        onClose={() => setDupDialogReason(null)}
        reason={dupDialogReason}
      />

      {/* Explainable Match Evidence Inspection Modal */}
      <Dialog
        open={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        title="Match evidence"
        description="Deterministic score, matched vs unproven skills, and recruiter override."
        maxWidth="max-w-[640px]"
      >
        {evidenceTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={evidenceTarget} />
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setEvidenceTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
