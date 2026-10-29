import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInDays, parseISO } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react';
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
  RequirementsPipelineGrid,
  PipelineQuickFilterBar,
  matchesPipelineQuickFilter,
  type PipelineQuickFilter,
} from '../../components/domain/RequirementsPipelineView';
import {
  ShareRequirementModal,
  RequirementSharingFlowPanel,
} from '../../components/domain/ShareRequirementModal';
import { fetchRequirementShareActivities } from '../../lib/requirementSharing';
import {
  fetchRequirements,
  fetchRequirementById,
  fetchRequirementFinancials,
  fetchRequirementMargins,
  fetchRequirementVendorShares,
  setRequirementStatus,
  setRequirementPublic,
  setRequirementClientMapping,
  shareRequirementWithVendors,
  revokeRequirementShare,
  publishAndShareRequirementWithAllVendors,
  syncAllOpenRequirementsWithVendors,
  softDeleteRequirement,
  consolidateDuplicateRequirements,
} from '../../api/requirements';
import {
  fetchMatchesForRequirement,
  overrideMatchScore,
  recomputeRequirementMatches,
} from '../../api/candidates';
import { decomposeCompoundSkills } from '../../lib/matchingEngine';
import {
  fetchSubmissions,
  submitCandidateRpc,
} from '../../api/submissions';
import { fetchOrganizations, fetchAuditLogs } from '../../api/admin';
import { useAuth } from '../../auth/AuthProvider';
import {
  detectDuplicateRequirementGroups,
  type DuplicateRequirementGroup,
} from '../../lib/enterpriseLifecycle';
import { mapSupabaseError } from '../../lib/errors';
import {
  STAGE_LABELS,
  formatFinancialAmount,
  formatLocalDate,
  formatLocalDateTime,
  formatRequirementBudgetWithSubtitle,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  CandidateMatch,
  Requirement,
  RequirementStatus,
  SubmissionStage,
} from '../../types/db';

// 1. HQ Requirements List Page
export const HqRequirementsListPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
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
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [quickFilter, setQuickFilter] = useState<PipelineQuickFilter>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [createOpen, setCreateOpen] = useState(false);
  const [syncingVendors, setSyncingVendors] = useState(false);

  // Soft-Delete Confirmation Dialog state
  const [deleteTarget, setDeleteTarget] = useState<Requirement | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Share Requirement Modal state (Steps 3, 4 & 5)
  const [shareModalTarget, setShareModalTarget] = useState<Requirement | null>(null);

  // Duplicate Cleanup & Canonical Consolidation Modal state
  const [duplicatesModalOpen, setDuplicatesModalOpen] = useState(false);
  const [canonicalSelectionByGroup, setCanonicalSelectionByGroup] = useState<
    Record<string, string>
  >({});
  const [consolidatingGroupKey, setConsolidatingGroupKey] = useState<string | null>(null);
  const [consolidatingAll, setConsolidatingAll] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['requirements', page, status, clientOrgId, publicFilter, mappingFilter, search],
    queryFn: () =>
      fetchRequirements({
        page,
        pageSize: 100,
        status,
        clientOrgId: clientOrgId || undefined,
        isPublic:
          publicFilter === 'true'
            ? true
            : publicFilter === 'false'
              ? false
              : undefined,
        mappingFilter,
        search,
      }),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['organizations_clients'],
    queryFn: () => fetchOrganizations({ type: 'client', page: 1, pageSize: 100 }),
  });

  const { data: approvedVendorsList } = useQuery({
    queryKey: ['approved_vendors'],
    queryFn: () =>
      fetchOrganizations({ type: 'vendor', status: 'approved', page: 1, pageSize: 100 }),
  });

  const { data: allShareActivities = [], refetch: refetchShareActivities } = useQuery({
    queryKey: ['requirement_share_activities_all'],
    queryFn: () => fetchRequirementShareActivities(),
  });

  const invalidateAllRequirementQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['requirements'] });
    queryClient.invalidateQueries({ queryKey: ['client_requirements'] });
    queryClient.invalidateQueries({ queryKey: ['client_open_reqs'] });
    queryClient.invalidateQueries({ queryKey: ['vendor_requirements'] });
    queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
    queryClient.invalidateQueries({ queryKey: ['public_requirements'] });
  };

  const handleSyncWithVendors = async () => {
    setSyncingVendors(true);
    try {
      const res = await syncAllOpenRequirementsWithVendors();
      toast({
        title: 'Requirements published & shared with vendors',
        description: `${res.sharedRequirementCount} open requirement(s) shared with vendor agencies (${res.publishedCount} newly published).`,
        tone: 'success',
      });
      invalidateAllRequirementQueries();
    } catch (err) {
      toast({
        title: 'Could not sync requirements with vendors',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSyncingVendors(false);
    }
  };

  const handleConfirmDeleteRequirement = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await softDeleteRequirement({
        requirement: deleteTarget,
        deletedBy: profile?.id || profile?.email || 'admin',
        reason: deleteReason.trim() || 'Soft-deleted by Admin via Requirements table',
      });
      toast({
        title: 'Requirement archived (soft-deleted)',
        description: `"${deleteTarget.title}" (${res.requirementId.slice(0, 8).toUpperCase()}) was removed from active feeds. Linked submissions and audit records remain intact.`,
        tone: 'success',
      });
      setDeleteTarget(null);
      setDeleteReason('');
      invalidateAllRequirementQueries();
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

  const allRequirements = data?.data || [];
  const filteredRows = allRequirements.filter((req) =>
    matchesPipelineQuickFilter(req, quickFilter)
  );

  // Detect duplicate requirement groups across active records
  const duplicateGroups = useMemo(
    () => detectDuplicateRequirementGroups(allRequirements),
    [allRequirements]
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

  const handleConsolidateSingleGroup = async (grp: DuplicateRequirementGroup) => {
    const canonicalId = getSelectedCanonicalId(grp);
    const canonicalReq = grp.requirements.find((r) => r.id === canonicalId) || grp.requirements[0];
    const duplicatesToArchive = grp.requirements.filter((r) => r.id !== canonicalReq.id);
    if (!duplicatesToArchive.length) return;

    setConsolidatingGroupKey(grp.groupKey);
    try {
      const res = await consolidateDuplicateRequirements({
        canonicalRequirement: canonicalReq,
        duplicateRequirements: duplicatesToArchive,
        deletedBy: profile?.id || profile?.email || 'admin',
      });
      toast({
        title: 'Duplicate group consolidated',
        description: `Retained canonical ID ${canonicalReq.id.slice(0, 8).toUpperCase()} for "${canonicalReq.title}" and archived ${res.archivedIds.length} duplicate record(s).`,
        tone: 'success',
      });
      invalidateAllRequirementQueries();
    } catch (err) {
      toast({
        title: 'Could not consolidate duplicate group',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setConsolidatingGroupKey(null);
    }
  };

  const handleConsolidateAllGroups = async () => {
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
          deletedBy: profile?.id || profile?.email || 'admin',
        });
        totalArchived += res.archivedIds.length;
      }
      toast({
        title: 'All duplicate requirement groups cleaned up',
        description: `Consolidated ${duplicateGroups.length} group(s) and soft-archived ${totalArchived} duplicate requirement(s) while preserving submissions and mappings.`,
        tone: 'success',
      });
      setDuplicatesModalOpen(false);
      invalidateAllRequirementQueries();
    } catch (err) {
      toast({
        title: 'Duplicate consolidation error',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setConsolidatingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requirements"
        description="Client requisitions, SLA timers, vendor distributions, and deterministic candidate matches."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-1 rounded-[4px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Pipeline cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-[4px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Table view
              </button>
            </div>
            {duplicateGroups.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setDuplicatesModalOpen(true)}
              >
                <Layers className="h-3.5 w-3.5 text-amber-500" />
                Review duplicates ({totalExtraDuplicateRecords})
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleSyncWithVendors}
              loading={syncingVendors}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Publish &amp; share all with vendors
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New requirement
            </Button>
          </div>
        }
      />

      {/* Simple Requirement Sharing Flow Strip (Matches User Diagram) */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
            <span className="inline-flex items-center gap-1.5 text-[#1F4CC4]">
              <Share2 className="h-3.5 w-3.5" />
              Simple Sharing Flow:
            </span>
            <span>1. Requirement in HireNestOS</span>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span>2. Click &ldquo;Share Requirement&rdquo;</span>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span className="text-emerald-600 dark:text-emerald-400">Vendor Sharing</span>
            <span className="text-[var(--text-tertiary)]">/</span>
            <span className="text-amber-600 dark:text-amber-400">Direct Candidates</span>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span>WhatsApp · Copy Link · In-app</span>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span>Track Responses in HireNestOS</span>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Expected outcome: Every shared requirement originates from HireNestOS, recipients respond through the platform, and the team tracks what was shared, with whom, and what happened next ({allShareActivities.length} share activity record{allShareActivities.length === 1 ? '' : 's'} logged).
          </p>
        </div>

        {allRequirements.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setShareModalTarget(allRequirements[0])}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Share Requirement
            </Button>
          </div>
        )}
      </div>

      {/* Duplicate Requirements Governance Banner */}
      {duplicateGroups.length > 0 && (
        <div className="rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
                {duplicateGroups.length} duplicate requirement group(s) detected ({totalExtraDuplicateRecords} redundant record{totalExtraDuplicateRecords === 1 ? '' : 's'})
              </div>
              <p className="mt-0.5 text-[12px] leading-[18px] text-[var(--text-secondary)]">
                Review duplicate groups, inspect their exact requirement IDs, and choose the canonical record to retain. Linked candidates, submissions, client mappings, and audit history are preserved before archiving duplicates.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => setDuplicatesModalOpen(true)}>
              Review &amp; clean up duplicates
            </Button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Input
            placeholder="SEARCH REQUIREMENTS..."
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
        <div className="w-48">
          <Select
            value={mappingFilter}
            onChange={(e) => {
              setMappingFilter(e.target.value as 'all' | 'mapped' | 'unmapped');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All client mappings' },
              { value: 'mapped', label: 'Explicitly mapped to client' },
              { value: 'unmapped', label: 'Unmapped (Internal / vendor)' },
            ].map((o) => ({ value: o.value || 'all', label: o.label }))}
          />
        </div>
        {(search ||
          clientOrgId ||
          status ||
          publicFilter ||
          mappingFilter !== 'all' ||
          quickFilter !== 'all') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setClientOrgId('');
              setStatus('');
              setPublicFilter('');
              setMappingFilter('all');
              setQuickFilter('all');
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
      ) : !allRequirements.length ? (
        <EmptyState
          title="No requirements found"
          description="New client requisitions and published roles will appear here."
          actionLabel="New requirement"
          onAction={() => setCreateOpen(true)}
        />
      ) : viewMode === 'cards' ? (
        <RequirementsPipelineGrid
          requirements={allRequirements}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
          onSelectRequirement={(req) => navigate(`${prefix}/requirements/${req.id}`)}
          onShareRequirement={(req) => setShareModalTarget(req)}
          onDeleteRequirement={(req) => {
            setDeleteTarget(req);
            setDeleteReason('');
          }}
          emptyActionLabel="New requirement"
          onEmptyAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <h2 className="text-[12px] leading-[16px] font-bold uppercase tracking-[0.04em] text-[var(--text-primary)]">
              Active Requirements Pipeline
            </h2>
            <PipelineQuickFilterBar
              activeFilter={quickFilter}
              onChange={setQuickFilter}
            />
          </div>

          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Client mapping</th>
                  <th>Status</th>
                  <th>Location &amp; mode</th>
                  <th className="text-right">Vendor budget</th>
                  <th className="text-right">SLA</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((req) => {
                  const budgetInfo = formatRequirementBudgetWithSubtitle(req);
                  const shortId = req.id.replace(/-/g, '').slice(0, 8).toUpperCase();
                  return (
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
                          ID: {shortId} · {req.min_experience}–{req.max_experience}y · {req.openings} open
                          {req.is_public ? ' · Public' : ''}
                        </div>
                      </td>
                      <td>
                        {budgetInfo.isClientMapped ? (
                          <div className="flex items-center gap-1.5">
                            <Badge tone="emerald">Mapped</Badge>
                            <span className="text-[var(--text-secondary)] truncate">
                              {req.organizations?.name || 'Client'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Badge tone="amber">Unmapped</Badge>
                            <span className="text-[12px] text-[var(--text-tertiary)]">
                              Hidden from client
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <RequirementStatusBadge status={req.status} />
                      </td>
                      <td className="text-[var(--text-secondary)] capitalize">
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
                      <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                        {req.submission_sla_hours}h
                      </td>
                      <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                        {formatLocalDate(req.created_at)}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShareModalTarget(req);
                            }}
                          >
                            <Share2 className="h-3.5 w-3.5 text-[#1F4CC4]" />
                            Share
                          </Button>
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={filteredRows.length} onPageChange={setPage} />
        </div>
      )}

      {/* Soft-Delete Requirement Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteLoading) {
            setDeleteTarget(null);
            setDeleteReason('');
          }
        }}
        title={deleteTarget ? `Delete requirement "${deleteTarget.title}"?` : 'Delete requirement'}
        description="Soft deletion removes this requirement from active lists and blocks client, vendor, and public access while preserving linked candidate submissions and audit history."
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] leading-[18px] space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Requirement title</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {deleteTarget.title}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Requirement ID</span>
                <span className="font-mono text-[var(--text-primary)]">{deleteTarget.id}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Client / Location</span>
                <span className="text-[var(--text-primary)]">
                  {deleteTarget.organizations?.name || 'Internal'} · {deleteTarget.location} ({deleteTarget.work_mode})
                </span>
              </div>
            </div>

            <Textarea
              label="Deletion / archival reason (recorded in audit history)"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Duplicate posting, obsolete requisition, or incorrect specification..."
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
                onClick={handleConfirmDeleteRequirement}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirm delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Duplicate Requirements Cleanup & Canonical Consolidation Dialog */}
      <Dialog
        open={duplicatesModalOpen}
        onClose={() => setDuplicatesModalOpen(false)}
        title="Review & clean up duplicate requirements"
        description="Inspect duplicate requirement groups and their IDs. Select the canonical record to retain; linked submissions, financials, mappings, and audit logs will be preserved before archiving duplicates."
        maxWidth="max-w-[760px]"
      >
        <div className="space-y-5">
          {duplicateGroups.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-6 text-center space-y-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto" />
              <div className="text-[14px] font-medium text-[var(--text-primary)]">
                No duplicate requirements detected
              </div>
              <p className="text-[12px] text-[var(--text-secondary)]">
                All active requirements have unique fingerprints across title, client organization, location, work mode, and skills.
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[440px] overflow-y-auto space-y-4 pr-1">
                {duplicateGroups.map((grp) => {
                  const selectedCanonicalId = getSelectedCanonicalId(grp);
                  const isConsolidatingThis = consolidatingGroupKey === grp.groupKey;

                  return (
                    <div
                      key={grp.groupKey}
                      className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                              {grp.title}
                            </span>
                            <Badge tone="amber">{grp.requirements.length} records</Badge>
                          </div>
                          <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            Client: <strong>{grp.clientName}</strong> · Location:{' '}
                            <strong>{grp.location}</strong> · Mode:{' '}
                            <strong className="capitalize">{grp.workMode}</strong>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          loading={isConsolidatingThis}
                          disabled={consolidatingAll}
                          onClick={() => handleConsolidateSingleGroup(grp)}
                        >
                          Retain selected &amp; archive {grp.requirements.length - 1} duplicate(s)
                        </Button>
                      </div>

                      <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface)]">
                        {grp.requirements.map((item) => {
                          const isCanonical = item.id === selectedCanonicalId;
                          const budgetInfo = formatRequirementBudgetWithSubtitle(item);
                          return (
                            <label
                              key={item.id}
                              className={`flex items-start justify-between gap-3 p-3 text-[12px] cursor-pointer transition-colors ${
                                isCanonical
                                  ? 'bg-[#1F4CC4]/5'
                                  : 'hover:bg-[var(--bg-hover)]'
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                <input
                                  type="radio"
                                  name={`canonical_${grp.groupKey}`}
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
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono font-semibold text-[var(--text-primary)]">
                                      ID: {item.id}
                                    </span>
                                    {isCanonical ? (
                                      <Badge tone="emerald">Canonical (Retain)</Badge>
                                    ) : (
                                      <Badge tone="warning">Duplicate (Will archive)</Badge>
                                    )}
                                    {item.id === grp.recommendedCanonicalId && (
                                      <span className="text-[11px] text-[var(--text-tertiary)]">
                                        (Recommended)
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[var(--text-secondary)]">
                                    Skills ({item.skills?.length || 0}):{' '}
                                    {item.skills?.length ? item.skills.join(', ') : 'None'} · Budget:{' '}
                                    <span className="font-mono">{budgetInfo.formatted}</span> · Created:{' '}
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

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]">
                <span className="text-[12px] text-[var(--text-secondary)]">
                  Consolidating preserves linked candidates, submissions, financials, and audit logs.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={consolidatingAll}
                    onClick={() => setDuplicatesModalOpen(false)}
                  >
                    Close
                  </Button>
                  <Button
                    loading={consolidatingAll}
                    onClick={handleConsolidateAllGroups}
                  >
                    Consolidate all ({duplicateGroups.length} group{duplicateGroups.length === 1 ? '' : 's'})
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Dialog>

      <RequirementFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => {
          invalidateAllRequirementQueries();
          navigate(`${prefix}/requirements/${saved.id}`);
        }}
        role={profile?.role || 'recruiter'}
        userOrgId={profile?.org_id || null}
        clientOrgs={clientsData?.data || []}
      />

      {/* Share Requirement Modal (WhatsApp · Copy Link · In-app Feed) */}
      <ShareRequirementModal
        open={Boolean(shareModalTarget)}
        onClose={() => setShareModalTarget(null)}
        requirement={shareModalTarget}
        approvedVendors={approvedVendorsList?.data || []}
        sharedByName={profile?.full_name || profile?.email || 'HireNest HQ'}
        sharedByRole={profile?.role || 'admin'}
        onShared={() => {
          invalidateAllRequirementQueries();
          void refetchShareActivities();
        }}
      />
    </div>
  );
};

// 2. HQ Requirement 360 Detail Page: Two columns at 1200px (main ~760px with tabs + 320px right rail with key facts & actions)
export const HqRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
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

  const { data: shareActivities = [], refetch: refetchReqShareActivities } = useQuery({
    queryKey: ['requirement_share_activities', id],
    queryFn: () => fetchRequirementShareActivities(id!),
    enabled: Boolean(id),
  });

  const [shareRequirementModalOpen, setShareRequirementModalOpen] = useState(false);

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
    queryClient.invalidateQueries({ queryKey: ['requirement_share_activities', id] });
    queryClient.invalidateQueries({ queryKey: ['requirement_share_activities_all'] });
    void refetchReqShareActivities();
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

  const [detailDeleteOpen, setDetailDeleteOpen] = useState(false);
  const [detailDeleteReason, setDetailDeleteReason] = useState('');
  const [detailDeleteLoading, setDetailDeleteLoading] = useState(false);

  const handlePublishAndShareAll = async () => {
    setSharingLoading(true);
    try {
      await publishAndShareRequirementWithAllVendors({
        requirementId: req.id,
        slaHours: shareSlaHours || req.submission_sla_hours || 48,
      });
      toast({
        title: 'Requirement published & shared with vendors',
        description: `${req.title} is now Open and distributed to vendor agencies.`,
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
      queryClient.invalidateQueries({ queryKey: ['approved_vendors'] });
      refreshAll();
    } catch (err) {
      toast({
        title: 'Could not publish & share requirement',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSharingLoading(false);
    }
  };

  const handleDetailSoftDelete = async () => {
    setDetailDeleteLoading(true);
    try {
      await softDeleteRequirement({
        requirement: req,
        deletedBy: profile?.id || profile?.email || 'admin',
        reason: detailDeleteReason.trim() || 'Soft-deleted from Requirement Detail view',
      });
      toast({
        title: 'Requirement archived (soft-deleted)',
        description: `"${req.title}" has been removed from active feeds. Linked submissions and audit records remain preserved.`,
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      queryClient.invalidateQueries({ queryKey: ['client_requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
      setDetailDeleteOpen(false);
      navigate(`${prefix}/requirements`);
    } catch (err) {
      toast({
        title: 'Could not delete requirement',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setDetailDeleteLoading(false);
    }
  };

  const submissions = submissionsData?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={req.title}
        description={`${req.organizations?.name || 'Client'} · ${req.location} · ${req.work_mode}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setShareRequirementModalOpen(true)}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share Requirement
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePublishAndShareAll}
              loading={sharingLoading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Publish &amp; share with vendors
            </Button>
            <Button size="sm" variant="outline" onClick={handleRecomputeMatches}>
              <RefreshCw className="h-3.5 w-3.5" />
              Recompute matches
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              Edit requirement
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setDetailDeleteReason('');
                setDetailDeleteOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
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
              {
                id: 'vendors',
                label: 'Sharing & responses',
                count: Math.max(shares.length, shareActivities.length),
              },
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
                {(() => {
                  const displaySkills = decomposeCompoundSkills(req.skills || []);
                  return (
                    <>
                      <h4 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                        Required skills ({displaySkills.length})
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {displaySkills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Vendor Sourcing & Distribution Summary on Overview Tab */}
              <div className="pt-4 border-t border-[var(--border)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                      Vendor sourcing &amp; distribution ({shares.length})
                    </h4>
                    <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                      {shares.length > 0
                        ? `Published (${req.status}) and shared with ${shares.length} vendor agency(s) for active candidate sourcing.`
                        : 'Publish this requirement and distribute it to all approved vendor agencies.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setShareRequirementModalOpen(true)}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share Requirement (WhatsApp / Link / In-app)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePublishAndShareAll}
                      loading={sharingLoading}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Publish &amp; share with all vendors
                    </Button>
                  </div>
                </div>

                {shares.length > 0 && (
                  <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
                    <table>
                      <thead>
                        <tr>
                          <th>Vendor agency</th>
                          <th>Shared</th>
                          <th>SLA due</th>
                          <th>Acknowledged</th>
                          <th>SLA status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shares.map((sh) => (
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
                              {sh.acknowledged_at
                                ? formatLocalDateTime(sh.acknowledged_at)
                                : 'Pending'}
                            </td>
                            <td>
                              <SlaBadge
                                dueAt={sh.due_at}
                                firstSubmissionAt={null}
                                revokedAt={sh.revoked_at}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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

              {/* Update 1: Explicit Client Mapping Governance */}
              <div className="pt-4 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
                      Client portal mapping & visibility
                    </h4>
                    <Badge
                      tone={
                        formatRequirementBudgetWithSubtitle(req).isClientMapped
                          ? 'emerald'
                          : 'amber'
                      }
                    >
                      {formatRequirementBudgetWithSubtitle(req).isClientMapped
                        ? `Mapped · ${req.organizations?.name || 'Client'}`
                        : 'Internal / Unmapped'}
                    </Badge>
                  </div>
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    {formatRequirementBudgetWithSubtitle(req).isClientMapped
                      ? `Explicitly mapped to ${req.organizations?.name || 'client'}. Visible in client lists, search, counts, and detail view.`
                      : 'Unmapped internal requirement. Hidden from all client surfaces while eligible for vendor sourcing when open & shared.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const currentMapped = formatRequirementBudgetWithSubtitle(req).isClientMapped;
                    try {
                      await setRequirementClientMapping({
                        requirement: req,
                        isClientMapped: !currentMapped,
                        mappedClientOrgId: !currentMapped ? req.client_org_id : null,
                      });
                      toast({
                        title: !currentMapped
                          ? `Requirement mapped to ${req.organizations?.name || 'client'}`
                          : 'Requirement unmapped from client portal',
                        description: !currentMapped
                          ? 'Now visible in the client workspace.'
                          : 'Now hidden from clients; eligible vendor sourcing remains unaffected.',
                        tone: 'success',
                      });
                      refreshAll();
                    } catch (err) {
                      toast({
                        title: 'Could not update client mapping',
                        description: mapSupabaseError(err),
                        tone: 'error',
                      });
                    }
                  }}
                >
                  {formatRequirementBudgetWithSubtitle(req).isClientMapped
                    ? 'Unmap from client (Make internal)'
                    : `Map to ${req.organizations?.name || 'client'}`}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 3: SHARING & RESPONSES (7-Step Flow + Vendor SLA Table) */}
          {activeTab === 'vendors' && (
            <div className="space-y-6">
              <RequirementSharingFlowPanel
                requirement={req}
                shares={shares}
                submissions={submissions}
                activities={shareActivities}
                onOpenShareModal={() => setShareRequirementModalOpen(true)}
                onRefresh={refreshAll}
              />

              <div className="rounded-[8px] border border-[var(--border)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
                    Share with approved vendors
                  </h3>
                  <Button
                    size="sm"
                    onClick={handlePublishAndShareAll}
                    loading={sharingLoading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Publish &amp; share with all vendors
                  </Button>
                </div>
                {req.status !== 'open' ? (
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    Requirement is currently in <strong>{req.status}</strong> status. Click{' '}
                    <strong>Publish &amp; share with all vendors</strong> above to transition it to{' '}
                    <strong>open</strong> and distribute it to all vendor agencies immediately.
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
                                {cand?.current_title || '-'} ·{' '}
                                <span className="font-mono tabular-nums">
                                  {cand?.total_experience_years ?? '-'}y
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
                                  title="Matched on candidate resume / profile"
                                  className="inline-flex items-center gap-1 rounded-[6px] border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                                >
                                  <CheckCircle2 className="h-3 w-3 text-[#2A9D8F] shrink-0" />
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
                              <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-secondary)] ml-1">
                                · Skills {m.skill_score}% · Exp {m.experience_score}% · Domain{' '}
                                {m.domain_score ??
                                  Number(
                                    (m.evidence as Record<string, unknown> | null)?.domain_score ??
                                      m.skill_score
                                  )}
                                % · Seniority{' '}
                                {m.seniority_score ??
                                  Number(
                                    (m.evidence as Record<string, unknown> | null)
                                      ?.seniority_score ?? m.experience_score
                                  )}
                                %
                              </span>
                              {m.experience_note && (
                                <span className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                                  ({m.experience_note})
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
            <div className="py-2 flex justify-between items-center gap-2">
              <span className="text-[var(--text-secondary)]">Client mapping</span>
              {formatRequirementBudgetWithSubtitle(req).isClientMapped ? (
                <span className="font-medium text-[var(--text-primary)] truncate">
                  Mapped · {req.organizations?.name || '-'}
                </span>
              ) : (
                <Badge tone="amber">Unmapped (Internal)</Badge>
              )}
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
              <div className="text-right">
                <div className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {formatRequirementBudgetWithSubtitle(req).formatted}
                </div>
                {formatRequirementBudgetWithSubtitle(req).subtitle && (
                  <div className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
                    {formatRequirementBudgetWithSubtitle(req).subtitle}
                  </div>
                )}
              </div>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Client budget</span>
              <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                {formatFinancialAmount(financials?.actual_client_budget, req)}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Financial notes</span>
              <span className="text-right text-[12px] text-[var(--text-primary)] max-w-[180px] break-words">
                {financials?.notes || '-'}
              </span>
            </div>
            {isAdmin && (
              <div className="py-2 flex justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Platform margin</span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {margins?.platform_margin !== null &&
                  margins?.platform_margin !== undefined
                    ? margins.margin_type === 'percentage'
                      ? `${margins.platform_margin}%`
                      : formatFinancialAmount(margins.platform_margin, req)
                    : '-'}
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

      {/* Soft-Delete Confirmation Dialog on Requirement Detail Page */}
      <Dialog
        open={detailDeleteOpen}
        onClose={() => {
          if (!detailDeleteLoading) setDetailDeleteOpen(false);
        }}
        title={`Delete requirement "${req.title}"?`}
        description="Soft deletion removes this requirement from active lists and blocks client, vendor, and public access while preserving linked candidate submissions and audit history."
      >
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] leading-[18px] space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Requirement title</span>
              <span className="font-semibold text-[var(--text-primary)]">{req.title}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Requirement ID</span>
              <span className="font-mono text-[var(--text-primary)]">{req.id}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Linked submissions</span>
              <span className="font-mono text-[var(--text-primary)]">
                {submissions.length} preserved
              </span>
            </div>
          </div>

          <Textarea
            label="Deletion / archival reason (recorded in audit history)"
            rows={2}
            value={detailDeleteReason}
            onChange={(e) => setDetailDeleteReason(e.target.value)}
            placeholder="e.g. Duplicate posting, obsolete requisition, or incorrect specification..."
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={detailDeleteLoading}
              onClick={() => setDetailDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={detailDeleteLoading}
              onClick={handleDetailSoftDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Confirm delete
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Share Requirement Modal (WhatsApp · Copy Link · In-app Feed) */}
      <ShareRequirementModal
        open={shareRequirementModalOpen}
        onClose={() => setShareRequirementModalOpen(false)}
        requirement={req}
        approvedVendors={approvedVendors?.data || []}
        existingShares={shares}
        sharedByName={profile?.full_name || profile?.email || 'HireNest HQ'}
        sharedByRole={profile?.role || 'admin'}
        onShared={refreshAll}
      />
    </div>
  );
};
