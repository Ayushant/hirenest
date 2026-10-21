import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInDays, parseISO } from 'date-fns';
import {
  Plus,
  RefreshCw,
  Share2,
  Sliders,
  Edit3,
  Globe,
  Send,
} from 'lucide-react';
import {
  PageHeader,
  Card,
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
  fetchSubmissionStageHistory,
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
        description="Governed client requisitions, SLA timers, vendor distributions, and deterministic candidate matches."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Requirement
          </Button>
        }
      />

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <Input
          placeholder="Search title (.ilike)..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={clientOrgId}
          onChange={(e) => {
            setClientOrgId(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Clients' },
            ...(clientsData?.data || []).map((c) => ({ value: c.id, label: c.name })),
          ]}
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
        <Select
          value={publicFilter}
          onChange={(e) => {
            setPublicFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Visibility' },
            { value: 'true', label: 'Public Job Board' },
            { value: 'false', label: 'Private / Vendor Only' },
          ]}
        />
        {(search || clientOrgId || status || publicFilter) && (
          <Button
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
          description="Create a new requirement or adjust your active filters."
          actionLabel="Create Requirement"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Requirement Title</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Location & Mode</th>
                  <th className="py-3 px-4 text-right">Vendor Budget</th>
                  <th className="py-3 px-4 text-right">SLA (Hrs)</th>
                  <th className="py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {data.data.map((req) => (
                  <tr
                    key={req.id}
                    onClick={() => navigate(`${prefix}/requirements/${req.id}`)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {req.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {req.min_experience}–{req.max_experience} yrs · {req.openings} opening
                        {req.openings > 1 ? 's' : ''}{' '}
                        {req.is_public ? '· Public' : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium">
                      {req.organizations?.name || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <RequirementStatusBadge status={req.status} />
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-600 dark:text-slate-400">
                      {req.location} · {req.work_mode}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatCurrency(req.vendor_visible_budget, req.currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {req.submission_sla_hours}h
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDate(req.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
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

// 2. HQ Requirement Detail Page (6 Tabs: Overview, Status, Vendor Sharing, Matches, Pipeline, Activity)
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

  // Status dialog
  const [statusTarget, setStatusTarget] = useState<RequirementStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  // Vendor sharing state
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [shareSlaHours, setShareSlaHours] = useState<number>(48);
  const [sharingLoading, setSharingLoading] = useState(false);

  // Match Override modal (HQ only)
  const [overrideTarget, setOverrideTarget] = useState<CandidateMatch | null>(null);
  const [overrideScoreInput, setOverrideScoreInput] = useState<string>('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  // Submit Candidate from Match modal
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
          ? 'Requirement published to Direct Candidates'
          : 'Requirement made private',
        tone: 'success',
      });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not update public visibility',
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
        description: 'Deterministic match scores refreshed.',
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
        description={`Client: ${req.organizations?.name || '—'} · ${req.location} (${req.work_mode}) · ${req.min_experience}–${req.max_experience} yrs`}
        actions={
          <div className="flex items-center gap-2">
            <RequirementStatusBadge status={req.status} />
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="h-3.5 w-3.5" />
              Edit Requirement
            </Button>
          </div>
        }
      />

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'status', label: 'Status Actions' },
          { id: 'vendors', label: 'Vendor Sharing', count: shares.length },
          {
            id: 'matches',
            label: 'Matches (Requirement → Candidates)',
            count: matchesData?.count || 0,
          },
          { id: 'pipeline', label: 'Pipeline', count: submissions.length },
          { id: 'activity', label: 'Activity & Audit' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Job Description
            </h3>
            {/* Section 10: No dangerouslySetInnerHTML. Render JD text as plain text with line breaks. */}
            <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
              {req.description}
            </p>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Required Skills
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {req.skills.map((skill) => (
                  <Badge key={skill} tone="indigo">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Commercials & SLA Governance
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Openings:</span>
                <span className="font-mono tabular-nums font-semibold">{req.openings}</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Employment Type:</span>
                <span className="capitalize">{req.employment_type.replace(/_/g, ' ')}</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Submission SLA:</span>
                <span className="font-mono tabular-nums">{req.submission_sla_hours} hours</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Public Job Board:</span>
                <span>{req.is_public ? 'Yes (Public)' : 'No (Private)'}</span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Vendor-Visible Budget:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatCurrency(req.vendor_visible_budget, req.currency)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-500">Actual Client Budget (HQ + Client):</span>
                <span className="font-mono tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">
                  {formatCurrency(financials?.actual_client_budget, req.currency)}
                </span>
              </div>
              {financials?.notes && (
                <div className="py-2.5">
                  <span className="text-slate-500 block">Financial Notes:</span>
                  <span className="text-slate-700 dark:text-slate-300">{financials.notes}</span>
                </div>
              )}
              {isAdmin && (
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Platform Margin (Admin Only):</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-600">
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
          </Card>
        </div>
      )}

      {/* TAB 2: STATUS ACTIONS */}
      {activeTab === 'status' && (
        <Card className="p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Requirement Status Governance
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Transition requirement status via <code className="font-mono">set_requirement_status</code> or toggle public candidate portal visibility via <code className="font-mono">set_requirement_public</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
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
                Set Status: {st.replace('_', ' ')}
              </Button>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Direct Candidate Portal Visibility
              </h4>
              <p className="text-xs text-slate-500">
                Currently: <strong>{req.is_public ? 'Public' : 'Private'}</strong>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleTogglePublic}>
              <Globe className="h-3.5 w-3.5" />
              {req.is_public ? 'Make Private' : 'Publish to Direct Candidates'}
            </Button>
          </div>
        </Card>
      )}

      {/* TAB 3: VENDOR SHARING */}
      {activeTab === 'vendors' && (
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Share Requirement with Approved Vendors
            </h3>
            {req.status !== 'open' ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Requirement must be in <strong>open</strong> status before sharing with vendors.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
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
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          selected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {v.name} ({v.sla_tier})
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-end gap-3 max-w-md">
                  <Input
                    label="Submission SLA Hours"
                    type="number"
                    value={shareSlaHours}
                    onChange={(e) => setShareSlaHours(Number(e.target.value))}
                  />
                  <Button
                    onClick={handleShareWithVendors}
                    loading={sharingLoading}
                    disabled={selectedVendorIds.length === 0}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share ({selectedVendorIds.length})
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4">Vendor Agency</th>
                    <th className="py-3 px-4">Shared At</th>
                    <th className="py-3 px-4">SLA Due At</th>
                    <th className="py-3 px-4">Acknowledged At</th>
                    <th className="py-3 px-4">First Valid Submission</th>
                    <th className="py-3 px-4">SLA Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {shares.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500">
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
                          <td className="py-3 px-4 font-semibold">
                            {sh.organizations?.name || sh.vendor_org_id}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                            {formatLocalDateTime(sh.shared_at)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                            {formatLocalDateTime(sh.due_at)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                            {formatLocalDateTime(sh.acknowledged_at)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                            {formatLocalDateTime(firstSubAt)}
                          </td>
                          <td className="py-3 px-4">
                            <SlaBadge
                              dueAt={sh.due_at}
                              firstSubmissionAt={firstSubAt}
                              revokedAt={sh.revoked_at}
                            />
                          </td>
                          <td className="py-3 px-4 text-right">
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
          </Card>
        </div>
      )}

      {/* TAB 4: MATCHES (Requirement -> Candidates) */}
      {activeTab === 'matches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Deterministic advisory matches from <code className="font-mono">candidate_matches</code>. A potential match is not an application until explicitly submitted.
            </p>
            <Button size="sm" variant="outline" onClick={handleRecomputeMatches}>
              <RefreshCw className="h-3.5 w-3.5" />
              Recompute Matches
            </Button>
          </div>

          {matchesLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : !matchesData?.data.length ? (
            <EmptyState
              title="No potential matches computed yet"
              description="Ensure the requirement is open and click Recompute Matches to run the deterministic engine."
              actionLabel="Recompute Matches"
              onAction={handleRecomputeMatches}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4">Candidate</th>
                      <th className="py-3 px-4">Original Source</th>
                      <th className="py-3 px-4">Owner Vendor</th>
                      <th className="py-3 px-4">Final Score</th>
                      <th className="py-3 px-4">Matched / Unproven Skills</th>
                      <th className="py-3 px-4">Experience Note & Engine</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {matchesData.data.map((m) => {
                      const cand = m.candidates;
                      const alreadySubmitted = submissions.some(
                        (s) => s.candidate_id === m.candidate_id
                      );
                      return (
                        <tr key={m.id} className="align-top">
                          <td className="py-3.5 px-4">
                            <Link
                              to={`${prefix}/candidates/${m.candidate_id}`}
                              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {cand?.full_name || m.candidate_id}
                            </Link>
                            <div className="text-[11px] text-slate-500">
                              {cand?.current_title || '—'} ·{' '}
                              {cand?.total_experience_years ?? '—'} yrs
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            {cand && (
                              <SourceBadge
                                source={cand.original_source}
                                vendorName={cand.source_vendor?.name}
                              />
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                            {cand?.owner_vendor?.name || '—'}
                          </td>
                          <td className="py-3.5 px-4">
                            <ScoreBar
                              score={m.final_score}
                              isOverridden={m.override_score !== null}
                            />
                            {m.override_score !== null && (
                              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-1">
                                Overridden by recruiter: {m.override_reason}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 max-w-xs">
                            <div className="flex flex-wrap gap-1 mb-1">
                              {(m.matched_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  className="rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:text-emerald-300"
                                >
                                  ✓ {sk}
                                </span>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {(m.unproven_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  title="Not found on profile; not proof the skill is missing"
                                  className="rounded border border-dashed border-slate-300 dark:border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500"
                                >
                                  ? {sk}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-500">
                            <div>{m.experience_note || '—'}</div>
                            <div className="text-[10px] font-mono tabular-nums text-slate-400 mt-1">
                              {m.engine_version} · {formatLocalDateTime(m.calculated_at)}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right space-x-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setOverrideTarget(m);
                                setOverrideScoreInput(
                                  m.override_score !== null ? String(m.override_score) : ''
                                );
                                setOverrideReasonInput(m.override_reason || '');
                              }}
                            >
                              <Sliders className="h-3.5 w-3.5" />
                              Override
                            </Button>
                            {alreadySubmitted ? (
                              <Badge tone="emerald">Submitted</Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSubmitMatchTarget(m);
                                  setSubmitNotes('');
                                }}
                              >
                                <Send className="h-3.5 w-3.5" />
                                Submit
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={matchesPage}
                totalCount={matchesData.count}
                onPageChange={setMatchesPage}
              />
            </Card>
          )}
        </div>
      )}

      {/* TAB 5: PIPELINE (Kanban + Table view) */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Click any submission card or row to open the stage governance drawer.
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={pipelineView === 'kanban' ? 'primary' : 'outline'}
                onClick={() => setPipelineView('kanban')}
              >
                Kanban Board
              </Button>
              <Button
                size="sm"
                variant={pipelineView === 'table' ? 'primary' : 'outline'}
                onClick={() => setPipelineView('table')}
              >
                Table View
              </Button>
            </div>
          </div>

          {submissions.length === 0 ? (
            <EmptyState
              title="No pipeline submissions yet"
              description="Submit candidates from the Matches tab or share this requirement with vendors."
            />
          ) : pipelineView === 'kanban' ? (
            <div className="flex gap-4 overflow-x-auto pb-4">
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
                return (
                  <div
                    key={st}
                    className="w-72 shrink-0 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/50 p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {STAGE_LABELS[st]}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
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
                            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2 cursor-pointer hover:border-indigo-500 transition-colors"
                          >
                            <div className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                              {sub.candidates?.full_name || sub.candidate_id}
                            </div>
                            <div className="flex items-center justify-between">
                              <SourceBadge
                                source={sub.source}
                                vendorName={sub.organizations?.name}
                              />
                              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                                {daysInStage}d in stage
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
            <Card className="overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4">Candidate</th>
                    <th className="py-3 px-4">Submission Source</th>
                    <th className="py-3 px-4">Stage</th>
                    <th className="py-3 px-4">Days in Stage</th>
                    <th className="py-3 px-4">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {submissions.map((sub) => {
                    const days = Math.max(
                      0,
                      differenceInDays(new Date(), parseISO(sub.stage_changed_at))
                    );
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => setDrawerSubmissionId(sub.id)}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="py-3 px-4 font-semibold">
                          {sub.candidates?.full_name || sub.candidate_id}
                        </td>
                        <td className="py-3 px-4">
                          <SourceBadge
                            source={sub.source}
                            vendorName={sub.organizations?.name}
                          />
                        </td>
                        <td className="py-3 px-4">
                          <StageBadge stage={sub.stage} />
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums">{days}d</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                          {formatLocalDateTime(sub.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* TAB 6: ACTIVITY & AUDIT */}
      {activeTab === 'activity' && (
        <div className="space-y-6">
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Requirement Audit Entries
            </h3>
            {!isAdmin ? (
              <p className="text-xs text-slate-500">
                Audit logs are restricted to HireNest Admin role. Inspect individual submission stage timelines inside the Pipeline tab.
              </p>
            ) : !auditData?.data.length ? (
              <p className="text-xs text-slate-500">No audit entries recorded for this requirement.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {auditData.data.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold uppercase">{log.action}</span>
                      <span className="ml-2 text-slate-500">
                        by {log.actor_role || 'system'}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-400">
                      {formatLocalDateTime(log.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

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
        title={`Change Requirement Status to ${statusTarget}`}
      >
        <div className="space-y-4">
          <Textarea
            label="Reason / Governance Note (Optional)"
            rows={3}
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStatusTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmStatusChange} loading={statusSaving}>
              Confirm Status Change
            </Button>
          </div>
        </div>
      </Dialog>

      {/* HQ Match Override Modal */}
      <Dialog
        open={Boolean(overrideTarget)}
        onClose={() => setOverrideTarget(null)}
        title="Recruiter Match Score Override"
        description="Recruiter override wins and displays 'Overridden by recruiter' with your reason."
      >
        <div className="space-y-4">
          <Input
            label="Override Score (0–100, or leave blank to clear override)"
            type="number"
            min={0}
            max={100}
            value={overrideScoreInput}
            onChange={(e) => setOverrideScoreInput(e.target.value)}
          />
          <Textarea
            label="Override Reason (Required)"
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
              Save Override
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Submit Candidate from Match Confirmation Dialog */}
      <Dialog
        open={Boolean(submitMatchTarget)}
        onClose={() => setSubmitMatchTarget(null)}
        title="Submit Candidate to Requirement"
        description="Review match evidence before creating a formal pipeline submission."
        maxWidth="max-w-xl"
      >
        {submitMatchTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitMatchTarget} />
            <Textarea
              label="Submission Notes (Optional)"
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
                Confirm Submission
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
    </div>
  );
};
