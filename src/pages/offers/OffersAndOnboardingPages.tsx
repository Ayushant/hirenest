import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Calendar,
  CheckCircle2,
  Download,
  Filter,
  History,
  Plus,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { fetchSubmissions, transitionSubmissionRpc } from '../../api/submissions';
import { fetchRequirements } from '../../api/requirements';
import {
  type OfferActionType,
  type OfferOnboardingRecord,
  type OfferStatus,
  type OnboardingStatus,
  type VendorOfferReportStatus,
  OFFER_LIFECYCLE_LABELS,
  OFFER_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  VENDOR_REPORT_STATUS_LABELS,
  applyOfferOnboardingAction,
  buildMonthlyHiringOnboardingReport,
  computeOfferOnboardingMetrics,
  fetchAllOfferOnboardingRecordsApi,
  getContractContactPolicy,
  getOrBuildOfferOnboardingRecord,
  getTargetSubmissionStageForOfferAction,
  isSubmissionApprovedForClientVisibility,
} from '../../lib/offerOnboarding';
import {
  isRequirementSoftDeleted,
  isRequirementVisibleToClientOrg,
} from '../../lib/enterpriseLifecycle';
import {
  PageHeader,
  MetricStrip,
  Badge,
  Button,
  Input,
  Select,
  Textarea,
  Dialog,
  EmptyState,
  TableSkeleton,
  ErrorState,
} from '../../components/ui/kit';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { useToast } from '../../components/ui/Toast';
import { formatLocalDate, formatLocalDateTime } from '../../lib/format';
import { mapSupabaseError } from '../../lib/errors';
import type { Submission } from '../../types/db';

interface EnrichedOfferRow {
  submission: Submission;
  record: OfferOnboardingRecord;
}

const LIFECYCLE_STEPS = [
  { key: 'candidate_selected', label: '1. Candidate Selected' },
  { key: 'offer_issued', label: '2. Offer Issued' },
  { key: 'offer_accepted', label: '3. Offer Accepted / Declined' },
  { key: 'joining_scheduled', label: '4. Joining Scheduled (Expected DOJ)' },
  { key: 'onboarded', label: '5. Onboarded / Did Not Join' },
] as const;

function getOfferStatusTone(
  status: OfferStatus
): 'slate' | 'sky' | 'emerald' | 'red' | 'amber' {
  switch (status) {
    case 'accepted':
      return 'emerald';
    case 'issued':
      return 'amber';
    case 'declined':
    case 'withdrawn':
      return 'red';
    default:
      return 'slate';
  }
}

function getOnboardingStatusTone(
  status: OnboardingStatus
): 'slate' | 'sky' | 'emerald' | 'red' | 'amber' {
  switch (status) {
    case 'onboarded':
      return 'emerald';
    case 'joining_scheduled':
      return 'sky';
    case 'pending_offer_response':
      return 'amber';
    case 'did_not_join':
      return 'red';
    default:
      return 'slate';
  }
}

export const OffersWorkspaceView: React.FC<{
  mode: 'offers' | 'onboarded';
}> = ({ mode }) => {
  const { profile } = useAuth();
  const role = profile?.role || 'client_manager';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';

  // Filters
  const [requirementFilter, setRequirementFilter] = useState<string>('');
  const [candidateSearch, setCandidateSearch] = useState<string>('');
  const [offerStatusFilter, setOfferStatusFilter] = useState<string>('');
  const [onboardingStatusFilter, setOnboardingStatusFilter] = useState<string>(
    mode === 'onboarded' ? 'onboarded' : ''
  );
  const [dateFromFilter, setDateFromFilter] = useState<string>('');
  const [dateToFilter, setDateToFilter] = useState<string>('');
  const [showMonthlyReport, setShowMonthlyReport] = useState<boolean>(true);

  // Drawer & Action Modal States
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [issueOfferModalOpen, setIssueOfferModalOpen] = useState<boolean>(false);
  const [selectedCandidateSubIdForNewOffer, setSelectedCandidateSubIdForNewOffer] =
    useState<string>('');

  const [activeActionModal, setActiveActionModal] = useState<{
    row: EnrichedOfferRow;
    action: OfferActionType;
  } | null>(null);
  const [auditHistoryRow, setAuditHistoryRow] = useState<EnrichedOfferRow | null>(null);

  // Action Form Inputs
  const [formOfferDate, setFormOfferDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [formResponseDate, setFormResponseDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [formExpectedDoj, setFormExpectedDoj] = useState<string>('');
  const [formActualDoj, setFormActualDoj] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [formOfferedCtc, setFormOfferedCtc] = useState<string>('');
  const [formOfferRef, setFormOfferRef] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formVendorStatus, setFormVendorStatus] =
    useState<VendorOfferReportStatus>('acceptance_confirmed');
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  const workspaceQuery = useQuery({
    queryKey: ['offers-onboarding-workspace', role, profile?.org_id],
    queryFn: async () => {
      const [subsRes, reqsRes, recordsMap] = await Promise.all([
        fetchSubmissions({
          page: 1,
          pageSize: 300,
          vendorOrgId: isVendor ? profile?.org_id || undefined : undefined,
          clientOrgId: isClient ? profile?.org_id || null : undefined,
          enforceClientGate: isClient,
        }),
        fetchRequirements({
          page: 1,
          pageSize: 200,
          clientOrgId: isClient ? profile?.org_id || undefined : undefined,
        }),
        fetchAllOfferOnboardingRecordsApi(),
      ]);

      const visibleReqs = (reqsRes.data || []).filter((r) => {
        if (isRequirementSoftDeleted(r)) return false;
        if (isClient) return isRequirementVisibleToClientOrg(r, profile?.org_id);
        return true;
      });

      const visibleReqIds = new Set(visibleReqs.map((r) => r.id));

      // Role-scoped submissions
      const scopedSubs = (subsRes.data || []).filter((sub) => {
        if (sub.is_valid === false) return false;
        if (isClient) {
          if (!isSubmissionApprovedForClientVisibility(sub, profile?.org_id)) return false;
          if (sub.requirements && !visibleReqIds.has(sub.requirement_id)) return false;
        }
        if (isVendor && profile?.org_id) {
          const subVendorId = sub.vendor_org_id || sub.candidates?.owner_vendor_org_id;
          if (subVendorId && subVendorId !== profile.org_id) return false;
        }
        return true;
      });

      const enrichedRows: EnrichedOfferRow[] = scopedSubs.map((sub) => ({
        submission: sub,
        record: getOrBuildOfferOnboardingRecord(sub, recordsMap),
      }));

      const metrics = computeOfferOnboardingMetrics(scopedSubs, recordsMap);
      const monthlyReport = buildMonthlyHiringOnboardingReport(scopedSubs, recordsMap);

      return {
        requirements: visibleReqs,
        allScopedSubmissions: scopedSubs,
        enrichedRows,
        metrics,
        monthlyReport,
      };
    },
  });

  const reloadWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ['offers-onboarding-workspace'] });
    queryClient.invalidateQueries({ queryKey: ['client-dashboard-subs'] });
    queryClient.invalidateQueries({ queryKey: ['hq-dashboard-subs'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-dashboard-subs'] });
    workspaceQuery.refetch();
  };

  const openActionModal = (row: EnrichedOfferRow, action: OfferActionType) => {
    const today = new Date().toISOString().slice(0, 10);
    setFormOfferDate(row.record.offerDate || today);
    setFormResponseDate(row.record.offerResponseDate || today);
    setFormExpectedDoj(row.record.expectedDoj || '');
    setFormActualDoj(row.record.actualDoj || row.record.expectedDoj || today);
    setFormOfferedCtc(row.record.offeredCtc || '');
    setFormOfferRef(
      row.record.offerReferenceCode ||
        `OFR-${row.submission.id.slice(0, 6).toUpperCase()}`
    );
    setFormNotes('');
    setFormVendorStatus(
      row.record.vendorReportedStatus !== 'none'
        ? row.record.vendorReportedStatus
        : 'acceptance_confirmed'
    );
    setActiveActionModal({ row, action });
  };

  const handleConfirmAction = async () => {
    if (!activeActionModal) return;
    const { row, action } = activeActionModal;

    if (action === 'schedule_joining' && !formExpectedDoj.trim()) {
      toast({
        title: 'Expected DOJ required',
        description: 'Please enter the Expected Date of Joining to schedule pre-boarding.',
        tone: 'error',
      });
      return;
    }

    if (action === 'confirm_onboarded' && !formActualDoj.trim()) {
      toast({
        title: 'Confirmed Actual DOJ required',
        description:
          'An Actual Date of Joining is required to confirm candidate onboarding.',
        tone: 'error',
      });
      return;
    }

    setSubmittingAction(true);
    try {
      await applyOfferOnboardingAction({
        submission: row.submission,
        action,
        actorId: profile?.id || 'user_actor',
        actorName: profile?.full_name || profile?.email || 'Authorised User',
        actorRole: role,
        actorOrgId: profile?.org_id || null,
        offerDate: formOfferDate || null,
        offerResponseDate: formResponseDate || null,
        expectedDoj: formExpectedDoj || null,
        actualDoj: formActualDoj || null,
        offeredCtc: formOfferedCtc || null,
        offerReferenceCode: formOfferRef || null,
        notes: formNotes.trim() || null,
        vendorReportedStatus: formVendorStatus,
        vendorReportedExpectedDoj: formExpectedDoj || null,
      });

      const targetDbStage = getTargetSubmissionStageForOfferAction(
        row.submission.stage,
        action
      );
      if (targetDbStage && targetDbStage !== row.submission.stage) {
        await transitionSubmissionRpc({
          p_submission_id: row.submission.id,
          p_to: targetDbStage,
          p_reason:
            formNotes.trim() ||
            `Offer/Onboarding workflow update (${action}) by ${
              profile?.full_name || role
            }`,
        }).catch(() => {
          if (targetDbStage === 'onboarded' && row.submission.stage === 'offered') {
            return transitionSubmissionRpc({
              p_submission_id: row.submission.id,
              p_to: 'offer_accepted',
              p_reason: 'Accepted prior to onboarding confirmation',
            }).then(() =>
              transitionSubmissionRpc({
                p_submission_id: row.submission.id,
                p_to: 'onboarded',
                p_reason: formNotes.trim() || 'Confirmed actual joining',
              })
            );
          }
          return undefined;
        });
      }

      toast({
        title: 'Offer & Onboarding lifecycle updated',
        description: `${row.submission.candidates?.full_name || 'Candidate'} updated with full audit log.`,
        tone: 'success',
      });
      setActiveActionModal(null);
      reloadWorkspace();
    } catch (err) {
      toast({
        title: 'Could not complete action',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleIssueNewOfferFromSelector = async () => {
    const rows = workspaceQuery.data?.enrichedRows || [];
    const targetRow = rows.find(
      (r) => r.submission.id === selectedCandidateSubIdForNewOffer
    );
    if (!targetRow) return;

    setSubmittingAction(true);
    try {
      await applyOfferOnboardingAction({
        submission: targetRow.submission,
        action: 'issue_offer',
        actorId: profile?.id || 'user_actor',
        actorName: profile?.full_name || profile?.email || 'Authorised User',
        actorRole: role,
        actorOrgId: profile?.org_id || null,
        offerDate: formOfferDate || new Date().toISOString().slice(0, 10),
        expectedDoj: formExpectedDoj || null,
        offeredCtc: formOfferedCtc || null,
        offerReferenceCode:
          formOfferRef || `OFR-${targetRow.submission.id.slice(0, 6).toUpperCase()}`,
        notes: formNotes.trim() || 'Formal offer issued.',
      });

      if (targetRow.submission.stage !== 'offered') {
        await transitionSubmissionRpc({
          p_submission_id: targetRow.submission.id,
          p_to: 'offered',
          p_reason: formNotes.trim() || 'Formal offer issued',
        }).catch(() => undefined);
      }

      toast({
        title: 'Formal offer issued',
        description: `${
          targetRow.submission.candidates?.full_name || 'Candidate'
        } now appears in Offers and updated the issued-offer count.`,
        tone: 'success',
      });
      setIssueOfferModalOpen(false);
      setSelectedCandidateSubIdForNewOffer('');
      reloadWorkspace();
    } catch (err) {
      toast({
        title: 'Could not issue offer',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const eligibleForNewOfferRows = useMemo(() => {
    const rows = workspaceQuery.data?.enrichedRows || [];
    return rows.filter(
      (r) =>
        r.record.offerStatus === 'none' &&
        r.submission.stage !== 'rejected' &&
        r.submission.stage !== 'withdrawn'
    );
  }, [workspaceQuery.data?.enrichedRows]);

  const filteredRows = useMemo(() => {
    const rows = workspaceQuery.data?.enrichedRows || [];
    return rows.filter(({ submission, record }) => {
      if (mode === 'offers' && offerStatusFilter !== 'none') {
        const hasOffer =
          record.offerStatus !== 'none' ||
          Boolean(record.offerDate) ||
          ['offered', 'offer_accepted', 'offer_declined', 'onboarded'].includes(
            submission.stage
          );
        if (!hasOffer) return false;
      }

      if (mode === 'onboarded' && !onboardingStatusFilter) {
        const isOnboardingRelevant =
          record.onboardingStatus === 'onboarded' ||
          record.onboardingStatus === 'joining_scheduled' ||
          record.onboardingStatus === 'did_not_join' ||
          submission.stage === 'onboarded';
        if (!isOnboardingRelevant) return false;
      }

      if (requirementFilter && submission.requirement_id !== requirementFilter) {
        return false;
      }

      if (candidateSearch.trim()) {
        const q = candidateSearch.trim().toLowerCase();
        const name = (submission.candidates?.full_name || '').toLowerCase();
        const title = (submission.candidates?.current_title || '').toLowerCase();
        const reqTitle = (submission.requirements?.title || '').toLowerCase();
        if (!name.includes(q) && !title.includes(q) && !reqTitle.includes(q)) {
          return false;
        }
      }

      if (offerStatusFilter && record.offerStatus !== offerStatusFilter) {
        return false;
      }

      if (
        onboardingStatusFilter &&
        record.onboardingStatus !== onboardingStatusFilter
      ) {
        return false;
      }

      const relevantDate =
        mode === 'onboarded'
          ? record.actualDoj || record.expectedDoj || record.offerDate
          : record.offerDate || record.expectedDoj || record.actualDoj;

      if (dateFromFilter && relevantDate && relevantDate < dateFromFilter) {
        return false;
      }
      if (dateToFilter && relevantDate && relevantDate > dateToFilter) {
        return false;
      }

      return true;
    });
  }, [
    workspaceQuery.data?.enrichedRows,
    mode,
    requirementFilter,
    candidateSearch,
    offerStatusFilter,
    onboardingStatusFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  const exportMonthlyReportCsv = () => {
    const rows = workspaceQuery.data?.monthlyReport || [];
    const headers = [
      'Month',
      'Offers Issued',
      'Offers Accepted',
      'Offers Declined',
      'Pending Offers',
      'Joining Scheduled (Expected DOJ)',
      'Confirmed Onboarded (Actual DOJ)',
      'Did Not Join',
      'Offer-to-Onboarding Conversion %',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          `"${r.monthLabel}"`,
          r.offersIssued,
          r.offersAccepted,
          r.offersDeclined,
          r.pendingOffers,
          r.joiningScheduled,
          r.onboarded,
          r.didNotJoin,
          `${r.conversionRatePercent}%`,
        ].join(',')
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hirenest_offer_onboarding_report_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const metrics = workspaceQuery.data?.metrics;

  const basePortalPrefix = isClient
    ? '/client'
    : isVendor
      ? '/vendor'
      : role === 'recruiter'
        ? '/recruiter'
        : '/admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          mode === 'offers'
            ? 'Offer Management & Joining Desk'
            : 'Confirmed Onboarded & Joining Roster'
        }
        description={
          isClient
            ? 'Issue formal offers, track candidate acceptances, schedule expected joining dates, and confirm Day-1 onboarding for your organisation.'
            : isVendor
              ? 'Track formal client offers and joining schedules for your submitted candidates, and report candidate availability or joining risks.'
              : 'Company-wide oversight of formal offers, acceptances, expected joining dates, confirmed onboarding, and audit verification across all clients and vendors.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`${basePortalPrefix}/offers`}>
              <Button
                size="sm"
                variant={mode === 'offers' ? 'primary' : 'outline'}
              >
                <Award className="h-3.5 w-3.5 mr-1" />
                Offers ({metrics?.offersIssued ?? 0})
              </Button>
            </Link>
            <Link to={`${basePortalPrefix}/onboarded`}>
              <Button
                size="sm"
                variant={mode === 'onboarded' ? 'primary' : 'outline'}
              >
                <UserCheck className="h-3.5 w-3.5 mr-1" />
                Onboarded ({metrics?.onboardedCandidates ?? 0})
              </Button>
            </Link>
            {(isClient || isHq) && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const first = eligibleForNewOfferRows[0];
                  setSelectedCandidateSubIdForNewOffer(first?.submission.id || '');
                  setFormOfferDate(new Date().toISOString().slice(0, 10));
                  setFormExpectedDoj('');
                  setFormOfferedCtc('');
                  setFormOfferRef(
                    first
                      ? `OFR-${first.submission.id.slice(0, 6).toUpperCase()}`
                      : ''
                  );
                  setFormNotes('');
                  setIssueOfferModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Issue Formal Offer
              </Button>
            )}
          </div>
        }
      />

      {workspaceQuery.error && (
        <ErrorState
          message={mapSupabaseError(workspaceQuery.error)}
          onRetry={reloadWorkspace}
        />
      )}

      {/* Lifecycle Governance Banner */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="h-4 w-4 text-[#1F4CC4]" />
              <span>Shared Offer &amp; Onboarding Lifecycle Governance</span>
            </div>
            <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
              Maintains strictly separate{' '}
              <strong className="text-[var(--text-primary)]">Offer Date</strong>,{' '}
              <strong className="text-[var(--text-primary)]">Response Date</strong>,{' '}
              <strong className="text-[var(--text-primary)]">Expected DOJ</strong>, and{' '}
              <strong className="text-[var(--text-primary)]">Confirmed Actual DOJ</strong>.
              An issued offer never automatically counts as an onboarding, and an Expected DOJ is never treated as proof of joining until Day-1 joining is confirmed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LIFECYCLE_STEPS.map((s) => (
              <span
                key={s.key}
                className="inline-flex items-center rounded-[5px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Live Database-Driven 7-Metric Strip */}
      <MetricStrip
        items={[
          {
            label: 'Candidates shared',
            value: metrics?.candidatesShared ?? '—',
            sublabel: 'Approved for client',
          },
          {
            label: 'Offers issued',
            value: metrics?.offersIssued ?? '—',
            sublabel: 'Formal offers',
          },
          {
            label: 'Offers accepted',
            value: metrics?.offersAccepted ?? '—',
            sublabel: 'Accepted by candidate',
            tone: 'emerald',
          },
          {
            label: 'Offers declined',
            value: metrics?.offersDeclined ?? '—',
            sublabel: 'Declined / withdrawn',
            tone: 'red',
          },
          {
            label: 'Pending offers',
            value: metrics?.pendingOffers ?? '—',
            sublabel: 'Awaiting response',
            tone: 'amber',
          },
          {
            label: 'Onboarded',
            value: metrics?.onboardedCandidates ?? '—',
            sublabel: 'Confirmed Actual DOJ',
            tone: 'emerald',
          },
          {
            label: 'Upcoming joinings',
            value: metrics?.upcomingJoiningsCount ?? '—',
            sublabel: 'Scheduled Expected DOJ',
          },
        ]}
      />

      {/* Upcoming Joining Dates Watch Strip */}
      {metrics && metrics.upcomingJoinings.length > 0 && (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#1F4CC4]" />
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Upcoming Scheduled Joining Dates (Pre-Boarding Watchlist · Not Yet Counted as Onboarded)
              </h2>
            </div>
            <Badge tone="sky">{metrics.upcomingJoinings.length} scheduled</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {metrics.upcomingJoinings
              .slice(0, 6)
              .map(({ submission, record, daysUntilJoining }) => (
                <div
                  key={submission.id}
                  className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {submission.candidates?.full_name || 'Candidate'}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                      {submission.requirements?.title || 'Requirement'}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] mt-0.5">
                      Expected DOJ:{' '}
                      <strong className="text-[var(--text-primary)]">
                        {record.expectedDoj}
                      </strong>{' '}
                      ({daysUntilJoining === 0
                        ? 'Today'
                        : daysUntilJoining > 0
                          ? `in ${daysUntilJoining}d`
                          : `${Math.abs(daysUntilJoining)}d overdue`})
                    </div>
                  </div>
                  {(isClient || isHq) && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() =>
                        openActionModal({ submission, record }, 'confirm_onboarded')
                      }
                    >
                      Confirm Joined
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
            <Filter className="h-3.5 w-3.5" />
            <span>
              Filter by Requirement, Candidate, Offer Status, Onboarding Status &amp; Date Range
            </span>
          </div>
          {(requirementFilter ||
            candidateSearch ||
            offerStatusFilter ||
            onboardingStatusFilter !== (mode === 'onboarded' ? 'onboarded' : '') ||
            dateFromFilter ||
            dateToFilter) && (
            <button
              type="button"
              onClick={() => {
                setRequirementFilter('');
                setCandidateSearch('');
                setOfferStatusFilter('');
                setOnboardingStatusFilter(mode === 'onboarded' ? 'onboarded' : '');
                setDateFromFilter('');
                setDateToFilter('');
              }}
              className="text-[12px] text-[#1F4CC4] hover:underline cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Input
            placeholder="Search candidate or role..."
            value={candidateSearch}
            onChange={(e) => setCandidateSearch(e.target.value)}
          />

          <Select
            value={requirementFilter}
            onChange={(e) => setRequirementFilter(e.target.value)}
            options={[
              { value: '', label: 'All requirements' },
              ...(workspaceQuery.data?.requirements || []).map((r) => ({
                value: r.id,
                label: r.title,
              })),
            ]}
          />

          <Select
            value={offerStatusFilter}
            onChange={(e) => setOfferStatusFilter(e.target.value)}
            options={[
              { value: '', label: 'All offer statuses' },
              { value: 'issued', label: 'Pending Response (Issued)' },
              { value: 'accepted', label: 'Offer Accepted' },
              { value: 'declined', label: 'Offer Declined' },
              { value: 'none', label: 'No Formal Offer Yet (Selected)' },
            ]}
          />

          <Select
            value={onboardingStatusFilter}
            onChange={(e) => setOnboardingStatusFilter(e.target.value)}
            options={[
              { value: '', label: 'All onboarding statuses' },
              { value: 'pending_offer_response', label: 'Awaiting Offer Acceptance' },
              { value: 'joining_scheduled', label: 'Joining Scheduled (Pre-Boarding)' },
              { value: 'onboarded', label: 'Confirmed Onboarded (Actual DOJ)' },
              { value: 'did_not_join', label: 'Did Not Join / Backed Out' },
            ]}
          />

          <Input
            type="date"
            value={dateFromFilter}
            onChange={(e) => setDateFromFilter(e.target.value)}
            title="From Date (Offer / DOJ)"
          />

          <Input
            type="date"
            value={dateToFilter}
            onChange={(e) => setDateToFilter(e.target.value)}
            title="To Date (Offer / DOJ)"
          />
        </div>
      </div>

      {/* Main Offers / Onboarded Table */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
              {mode === 'offers'
                ? `Formal Offers & Pre-Boarding Pipeline (${filteredRows.length})`
                : `Confirmed Onboarded & Joining Roster (${filteredRows.length})`}
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Connected to shared candidate, requirement, and submission records with role-enforced audit history.
            </p>
          </div>
          {mode === 'onboarded' && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={onboardingStatusFilter === 'onboarded' ? 'primary' : 'outline'}
                onClick={() => setOnboardingStatusFilter('onboarded')}
              >
                Confirmed Onboarded ({metrics?.onboardedCandidates ?? 0})
              </Button>
              <Button
                size="sm"
                variant={
                  onboardingStatusFilter === 'joining_scheduled' ? 'primary' : 'outline'
                }
                onClick={() => setOnboardingStatusFilter('joining_scheduled')}
              >
                Scheduled to Join ({metrics?.joiningScheduledCount ?? 0})
              </Button>
              <Button
                size="sm"
                variant={onboardingStatusFilter === '' ? 'primary' : 'outline'}
                onClick={() => setOnboardingStatusFilter('')}
              >
                All Joining Records
              </Button>
            </div>
          )}
        </div>

        {workspaceQuery.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={6} cols={8} />
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title={
              mode === 'offers'
                ? 'No formal offers match your filters'
                : 'No confirmed onboarded candidates match your filters'
            }
            description={
              mode === 'offers'
                ? 'Issue a formal offer to an approved candidate or adjust your status/date filters.'
                : 'Candidates appear here once their Actual Date of Joining (DOJ) is confirmed by the client or Admin.'
            }
            actionLabel={
              (isClient || isHq) && eligibleForNewOfferRows.length > 0
                ? 'Issue Formal Offer'
                : undefined
            }
            onAction={
              (isClient || isHq) && eligibleForNewOfferRows.length > 0
                ? () => {
                    const first = eligibleForNewOfferRows[0];
                    setSelectedCandidateSubIdForNewOffer(first?.submission.id || '');
                    setIssueOfferModalOpen(true);
                  }
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  <th className="py-2.5 pl-4 pr-3 text-left">Candidate &amp; Contract</th>
                  <th className="px-3 py-2.5 text-left">Requirement &amp; Partner</th>
                  <th className="px-3 py-2.5 text-left">Lifecycle Stage</th>
                  <th className="px-3 py-2.5 text-left">Offer Date &amp; CTC</th>
                  <th className="px-3 py-2.5 text-left">Offer Status &amp; Response</th>
                  <th className="px-3 py-2.5 text-left">Expected DOJ</th>
                  <th className="px-3 py-2.5 text-left">Confirmed Actual DOJ</th>
                  <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[13px] leading-[20px]">
                {filteredRows.map((row) => {
                  const { submission, record } = row;
                  const contactPolicy = getContractContactPolicy(
                    submission.requirements?.employment_type
                  );
                  return (
                    <tr
                      key={submission.id}
                      className="hover:bg-[var(--bg-hover)] transition-colors align-top"
                    >
                      {/* Candidate & Contract Policy */}
                      <td className="py-3 pl-4 pr-3">
                        <button
                          type="button"
                          onClick={() => setSelectedSubmissionId(submission.id)}
                          className="font-medium text-[var(--text-primary)] hover:text-[#1F4CC4] text-left cursor-pointer"
                        >
                          {submission.candidates?.full_name || 'Candidate'}
                        </button>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {submission.candidates?.current_title || '—'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge
                            tone={contactPolicy.isContractEngagement ? 'amber' : 'slate'}
                          >
                            {contactPolicy.engagementCode}
                          </Badge>
                          {record.offerReferenceCode && (
                            <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                              {record.offerReferenceCode}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Requirement & Org */}
                      <td className="px-3 py-3">
                        <div className="font-medium text-[var(--text-primary)]">
                          {submission.requirements?.title || 'Requirement'}
                        </div>
                        <div className="text-[12px] text-[var(--text-tertiary)]">
                          {isHq && (
                            <span>
                              Client:{' '}
                              <strong className="text-[var(--text-secondary)]">
                                {submission.requirements?.organizations?.name || 'Client Org'}
                              </strong>{' '}
                              ·{' '}
                            </span>
                          )}
                          {!isClient && (
                            <span>
                              Source:{' '}
                              {submission.organizations?.name ||
                                submission.candidates?.owner_vendor?.name ||
                                'HireNest HQ'}
                            </span>
                          )}
                          {isClient && (
                            <span>
                              Location: {submission.requirements?.location || '—'}
                            </span>
                          )}
                        </div>
                        {record.vendorReportedStatus !== 'none' && (
                          <div className="mt-1">
                            <Badge
                              tone={
                                record.vendorReportedStatus === 'withdrawal_risk' ||
                                record.vendorReportedStatus === 'joining_issue'
                                  ? 'red'
                                  : 'sky'
                              }
                            >
                              Vendor: {VENDOR_REPORT_STATUS_LABELS[record.vendorReportedStatus]}
                            </Badge>
                          </div>
                        )}
                      </td>

                      {/* Lifecycle Stage */}
                      <td className="px-3 py-3">
                        <Badge
                          tone={
                            record.lifecycleStage === 'onboarded'
                              ? 'emerald'
                              : record.lifecycleStage === 'offer_declined' ||
                                  record.lifecycleStage === 'did_not_join'
                                ? 'red'
                                : record.lifecycleStage === 'joining_scheduled' ||
                                    record.lifecycleStage === 'offer_accepted'
                                  ? 'sky'
                                  : 'amber'
                          }
                        >
                          {OFFER_LIFECYCLE_LABELS[record.lifecycleStage]}
                        </Badge>
                        {record.adminVerified && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>HQ Verified</span>
                          </div>
                        )}
                      </td>

                      {/* Offer Date & CTC */}
                      <td className="px-3 py-3 font-mono tabular-nums text-[12px]">
                        <div className="text-[var(--text-primary)]">
                          {record.offerDate ? formatLocalDate(record.offerDate) : '—'}
                        </div>
                        {record.offeredCtc && (
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            CTC: {record.offeredCtc}
                          </div>
                        )}
                        {record.issuedByName && (
                          <div className="text-[11px] font-sans text-[var(--text-tertiary)]">
                            by {record.issuedByName}
                          </div>
                        )}
                      </td>

                      {/* Offer Status & Response Date */}
                      <td className="px-3 py-3">
                        <Badge tone={getOfferStatusTone(record.offerStatus)}>
                          {OFFER_STATUS_LABELS[record.offerStatus]}
                        </Badge>
                        <div className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] mt-1">
                          {record.offerResponseDate
                            ? `Responded: ${formatLocalDate(record.offerResponseDate)}`
                            : record.offerStatus === 'issued'
                              ? 'Awaiting candidate response'
                              : '—'}
                        </div>
                      </td>

                      {/* Expected DOJ */}
                      <td className="px-3 py-3 font-mono tabular-nums text-[12px]">
                        {record.expectedDoj ? (
                          <div>
                            <span className="font-semibold text-[var(--text-primary)]">
                              {formatLocalDate(record.expectedDoj)}
                            </span>
                            <div className="text-[11px] font-sans text-[var(--text-tertiary)]">
                              Scheduled target
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">Not scheduled</span>
                        )}
                      </td>

                      {/* Confirmed Actual DOJ */}
                      <td className="px-3 py-3">
                        {record.onboardingStatus === 'onboarded' && record.actualDoj ? (
                          <div className="space-y-0.5">
                            <div className="inline-flex items-center gap-1 font-mono tabular-nums text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{formatLocalDate(record.actualDoj)}</span>
                            </div>
                            {record.joiningConfirmedByName && (
                              <div className="text-[11px] text-[var(--text-tertiary)]">
                                Confirmed by {record.joiningConfirmedByName}
                              </div>
                            )}
                          </div>
                        ) : record.onboardingStatus === 'did_not_join' ? (
                          <div>
                            <Badge tone="red">Did Not Join</Badge>
                            {record.didNotJoinReason && (
                              <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-[180px] truncate">
                                {record.didNotJoinReason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Badge tone={getOnboardingStatusTone(record.onboardingStatus)}>
                            {ONBOARDING_STATUS_LABELS[record.onboardingStatus]}
                          </Badge>
                        )}
                      </td>

                      {/* Role-Specific Actions */}
                      <td className="py-3 pl-3 pr-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {(isClient || isHq) && record.offerStatus === 'none' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openActionModal(row, 'issue_offer')}
                            >
                              Issue Offer
                            </Button>
                          )}

                          {(isClient || isHq) && record.offerStatus === 'issued' && (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openActionModal(row, 'accept_offer')}
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => openActionModal(row, 'decline_offer')}
                              >
                                Decline
                              </Button>
                            </>
                          )}

                          {(isClient || isHq) &&
                            record.offerStatus === 'accepted' &&
                            record.onboardingStatus !== 'onboarded' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openActionModal(row, 'schedule_joining')}
                                >
                                  {record.expectedDoj ? 'Update Expected DOJ' : 'Schedule DOJ'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => openActionModal(row, 'confirm_onboarded')}
                                >
                                  Confirm Joined
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-[var(--status-danger)]"
                                  onClick={() => openActionModal(row, 'mark_did_not_join')}
                                >
                                  Did Not Join
                                </Button>
                              </>
                            )}

                          {isHq && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openActionModal(row, 'admin_verify_or_correct')}
                            >
                              {record.adminVerified ? 'Edit / Re-verify' : 'HQ Verify'}
                            </Button>
                          )}

                          {isVendor && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openActionModal(row, 'vendor_report_update')}
                            >
                              Report Status
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAuditHistoryRow(row)}
                            title="View Offer & Onboarding Audit Trail"
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedSubmissionId(submission.id)}
                          >
                            Profile
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly Hiring & Onboarding Report */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
              Monthly Hiring &amp; Onboarding Report
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Database-driven monthly breakdown of Offers Issued, Accepted, Declined, Pending, Scheduled DOJ, and Confirmed Onboarded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={exportMonthlyReportCsv}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowMonthlyReport((v) => !v)}
            >
              {showMonthlyReport ? 'Hide Report' : 'Show Report'}
            </Button>
          </div>
        </div>

        {showMonthlyReport && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                  <th className="py-2.5 pl-4 pr-3 text-left">Month</th>
                  <th className="px-3 py-2.5 text-right">Offers Issued</th>
                  <th className="px-3 py-2.5 text-right">Offers Accepted</th>
                  <th className="px-3 py-2.5 text-right">Offers Declined</th>
                  <th className="px-3 py-2.5 text-right">Pending Response</th>
                  <th className="px-3 py-2.5 text-right">Joining Scheduled</th>
                  <th className="px-3 py-2.5 text-right">Confirmed Onboarded</th>
                  <th className="px-3 py-2.5 text-right">Did Not Join</th>
                  <th className="py-2.5 pl-3 pr-4 text-right">Offer → Onboarded %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-[13px] font-mono tabular-nums">
                {(workspaceQuery.data?.monthlyReport || []).map((m) => (
                  <tr key={m.monthKey} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 pl-4 pr-3 font-sans font-medium text-[var(--text-primary)]">
                      {m.monthLabel}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[var(--text-primary)]">
                      {m.offersIssued}
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                      {m.offersAccepted}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-600 dark:text-red-400">
                      {m.offersDeclined}
                    </td>
                    <td className="px-3 py-2.5 text-right text-amber-600 dark:text-amber-400">
                      {m.pendingOffers}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sky-600 dark:text-sky-400">
                      {m.joiningScheduled}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-300">
                      {m.onboarded}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">
                      {m.didNotJoin}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right font-semibold text-[var(--text-primary)]">
                      {m.conversionRatePercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: Issue New Formal Offer to an Approved Candidate */}
      <Dialog
        open={issueOfferModalOpen}
        onClose={() => setIssueOfferModalOpen(false)}
        title="Issue Formal Offer"
        description="Select a candidate shared with your organisation to issue a formal offer. Issuing an offer updates the Offers section and issued-offer count without prematurely counting as an onboarding."
      >
        <div className="space-y-4">
          {eligibleForNewOfferRows.length === 0 ? (
            <p className="text-[13px] text-[var(--text-secondary)]">
              All currently approved candidates already have a formal offer on record, or no new candidates are awaiting offer issuance.
            </p>
          ) : (
            <>
              <Select
                label="Candidate & Requirement"
                value={selectedCandidateSubIdForNewOffer}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCandidateSubIdForNewOffer(id);
                  setFormOfferRef(id ? `OFR-${id.slice(0, 6).toUpperCase()}` : '');
                }}
                options={eligibleForNewOfferRows.map((r) => ({
                  value: r.submission.id,
                  label: `${r.submission.candidates?.full_name || 'Candidate'} — ${
                    r.submission.requirements?.title || 'Requirement'
                  } (${r.submission.stage})`,
                }))}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Offer Date (Required)"
                  type="date"
                  value={formOfferDate}
                  onChange={(e) => setFormOfferDate(e.target.value)}
                />
                <Input
                  label="Proposed / Expected DOJ (Optional)"
                  type="date"
                  value={formExpectedDoj}
                  onChange={(e) => setFormExpectedDoj(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Offered CTC / Compensation"
                  placeholder="e.g. 28 LPA or ₹1,60,000 / month"
                  value={formOfferedCtc}
                  onChange={(e) => setFormOfferedCtc(e.target.value)}
                />
                <Input
                  label="Offer Reference Code"
                  placeholder="OFR-XXXXXX"
                  value={formOfferRef}
                  onChange={(e) => setFormOfferRef(e.target.value)}
                />
              </div>

              <Textarea
                label="Offer Notes / Terms"
                rows={3}
                placeholder="Compensation structure, joining bonus, notice buyout terms..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <Button variant="outline" onClick={() => setIssueOfferModalOpen(false)}>
              Cancel
            </Button>
            {eligibleForNewOfferRows.length > 0 && (
              <Button
                loading={submittingAction}
                disabled={!selectedCandidateSubIdForNewOffer}
                onClick={handleIssueNewOfferFromSelector}
              >
                Issue Formal Offer
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      {/* Modal 2: Lifecycle Action Dialog */}
      <Dialog
        open={Boolean(activeActionModal)}
        onClose={() => setActiveActionModal(null)}
        title={
          activeActionModal
            ? `${
                activeActionModal.action === 'issue_offer'
                  ? 'Issue Formal Offer'
                  : activeActionModal.action === 'accept_offer'
                    ? 'Record Offer Acceptance'
                    : activeActionModal.action === 'decline_offer'
                      ? 'Record Offer Decline'
                      : activeActionModal.action === 'schedule_joining'
                        ? 'Schedule Joining Date (Expected DOJ)'
                        : activeActionModal.action === 'confirm_onboarded'
                          ? 'Confirm Actual Day-1 Joining (Onboarded)'
                          : activeActionModal.action === 'mark_did_not_join'
                            ? 'Mark Candidate Did Not Join'
                            : activeActionModal.action === 'admin_verify_or_correct'
                              ? 'Admin Verification & Record Correction'
                              : 'Vendor Candidate Offer / Joining Report'
              } — ${activeActionModal.row.submission.candidates?.full_name || 'Candidate'}`
            : 'Update Offer & Onboarding'
        }
        description="All updates persist to the shared lifecycle record and append an immutable audit event with actor, role, and timestamp."
      >
        {activeActionModal && (
          <div className="space-y-4">
            {activeActionModal.action === 'issue_offer' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Offer Date"
                    type="date"
                    value={formOfferDate}
                    onChange={(e) => setFormOfferDate(e.target.value)}
                  />
                  <Input
                    label="Proposed Expected DOJ (Optional)"
                    type="date"
                    value={formExpectedDoj}
                    onChange={(e) => setFormExpectedDoj(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Offered CTC / Rate"
                    placeholder="e.g. 24 LPA"
                    value={formOfferedCtc}
                    onChange={(e) => setFormOfferedCtc(e.target.value)}
                  />
                  <Input
                    label="Offer Reference"
                    value={formOfferRef}
                    onChange={(e) => setFormOfferRef(e.target.value)}
                  />
                </div>
              </>
            )}

            {(activeActionModal.action === 'accept_offer' ||
              activeActionModal.action === 'decline_offer') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Offer Response Date (Required)"
                  type="date"
                  value={formResponseDate}
                  onChange={(e) => setFormResponseDate(e.target.value)}
                />
                {activeActionModal.action === 'accept_offer' && (
                  <Input
                    label="Expected Date of Joining (Expected DOJ)"
                    type="date"
                    value={formExpectedDoj}
                    onChange={(e) => setFormExpectedDoj(e.target.value)}
                  />
                )}
              </div>
            )}

            {activeActionModal.action === 'schedule_joining' && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-sky-500/30 bg-sky-500/10 p-3 text-[12px] text-[var(--text-primary)]">
                  Scheduling an <strong>Expected DOJ</strong> moves the candidate to{' '}
                  <strong>Joining Scheduled</strong> and adds them to Upcoming Joining Dates. It will not count as Onboarded until Day-1 joining is confirmed.
                </div>
                <Input
                  label="Expected Date of Joining (Expected DOJ)"
                  type="date"
                  value={formExpectedDoj}
                  onChange={(e) => setFormExpectedDoj(e.target.value)}
                />
              </div>
            )}

            {activeActionModal.action === 'confirm_onboarded' && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-[var(--text-primary)]">
                  <strong>Day-1 Joining Confirmation:</strong> Recording the confirmed{' '}
                  <strong>Actual DOJ</strong> transitions this candidate to{' '}
                  <strong>Onboarded</strong>, increments the Onboarded dashboard metric, and logs{' '}
                  <strong>{profile?.full_name || role}</strong> as the confirming authority.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Confirmed Actual Date of Joining (Actual DOJ)"
                    type="date"
                    value={formActualDoj}
                    onChange={(e) => setFormActualDoj(e.target.value)}
                  />
                  <Input
                    label="Original Expected DOJ (Reference)"
                    type="date"
                    value={formExpectedDoj}
                    onChange={(e) => setFormExpectedDoj(e.target.value)}
                  />
                </div>
              </div>
            )}

            {activeActionModal.action === 'admin_verify_or_correct' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Offer Date"
                    type="date"
                    value={formOfferDate}
                    onChange={(e) => setFormOfferDate(e.target.value)}
                  />
                  <Input
                    label="Offer Response Date"
                    type="date"
                    value={formResponseDate}
                    onChange={(e) => setFormResponseDate(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Expected DOJ"
                    type="date"
                    value={formExpectedDoj}
                    onChange={(e) => setFormExpectedDoj(e.target.value)}
                  />
                  <Input
                    label="Confirmed Actual DOJ (if onboarded)"
                    type="date"
                    value={formActualDoj}
                    onChange={(e) => setFormActualDoj(e.target.value)}
                  />
                </div>
                <Input
                  label="Offered CTC"
                  value={formOfferedCtc}
                  onChange={(e) => setFormOfferedCtc(e.target.value)}
                />
              </div>
            )}

            {activeActionModal.action === 'vendor_report_update' && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] text-[var(--text-secondary)]">
                  As a Vendor partner, your status update is visible to HireNest Admin and Client teams alongside the offer record. It will not overwrite client-confirmed or Admin-verified dates.
                </div>
                <Select
                  label="Candidate Status / Escalation"
                  value={formVendorStatus}
                  onChange={(e) =>
                    setFormVendorStatus(e.target.value as VendorOfferReportStatus)
                  }
                  options={Object.entries(VENDOR_REPORT_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label })
                  )}
                />
                <Input
                  label="Candidate Confirmed Availability / Expected DOJ"
                  type="date"
                  value={formExpectedDoj}
                  onChange={(e) => setFormExpectedDoj(e.target.value)}
                />
              </div>
            )}

            <Textarea
              label={
                activeActionModal.action === 'decline_offer' ||
                activeActionModal.action === 'mark_did_not_join'
                  ? 'Reason (Required for audit trail)'
                  : 'Audit Notes / Context'
              }
              rows={3}
              placeholder="Record confirmation details, relieving letter status, or reason..."
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => setActiveActionModal(null)}>
                Cancel
              </Button>
              <Button loading={submittingAction} onClick={handleConfirmAction}>
                Save &amp; Record Audit Event
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Modal 3: Offer & Onboarding Audit Trail */}
      <Dialog
        open={Boolean(auditHistoryRow)}
        onClose={() => setAuditHistoryRow(null)}
        title={
          auditHistoryRow
            ? `Offer & Onboarding Audit Trail — ${
                auditHistoryRow.submission.candidates?.full_name || 'Candidate'
              }`
            : 'Audit Trail'
        }
        description="Chronological record of offer issuance, candidate response, expected DOJ scheduling, and confirmed Day-1 joining."
      >
        {auditHistoryRow && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px]">
              <div>
                <span className="text-[11px] text-[var(--text-tertiary)] block">
                  Offer Date
                </span>
                <strong className="font-mono text-[var(--text-primary)]">
                  {auditHistoryRow.record.offerDate || '—'}
                </strong>
              </div>
              <div>
                <span className="text-[11px] text-[var(--text-tertiary)] block">
                  Response Date
                </span>
                <strong className="font-mono text-[var(--text-primary)]">
                  {auditHistoryRow.record.offerResponseDate || '—'}
                </strong>
              </div>
              <div>
                <span className="text-[11px] text-[var(--text-tertiary)] block">
                  Expected DOJ
                </span>
                <strong className="font-mono text-[var(--text-primary)]">
                  {auditHistoryRow.record.expectedDoj || '—'}
                </strong>
              </div>
              <div>
                <span className="text-[11px] text-[var(--text-tertiary)] block">
                  Confirmed Actual DOJ
                </span>
                <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                  {auditHistoryRow.record.actualDoj || 'Not yet joined'}
                </strong>
              </div>
            </div>

            {auditHistoryRow.record.auditTrail.length === 0 ? (
              <p className="text-[13px] text-[var(--text-secondary)]">
                Initial state synced from submission pipeline. Perform any offer or onboarding update to append detailed audit events.
              </p>
            ) : (
              <div className="max-h-[340px] overflow-y-auto divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {auditHistoryRow.record.auditTrail.map((ev) => (
                  <div
                    key={ev.id}
                    className="py-2.5 flex items-start justify-between gap-4 text-[12px]"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium text-[var(--text-primary)]">
                        {ev.summary}
                      </div>
                      {ev.notes && (
                        <div className="text-[var(--text-secondary)]">{ev.notes}</div>
                      )}
                      <div className="text-[11px] text-[var(--text-tertiary)]">
                        Confirmed by <strong>{ev.actorName}</strong> ({ev.actorRole})
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-[11px] text-[var(--text-tertiary)] shrink-0">
                      {formatLocalDateTime(ev.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setAuditHistoryRow(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Submission Detail Drawer */}
      <SubmissionDetailDrawer
        submissionId={selectedSubmissionId}
        onClose={() => {
          setSelectedSubmissionId(null);
          reloadWorkspace();
        }}
        role={role}
      />
    </div>
  );
};

export const OffersManagementPage: React.FC = () => (
  <OffersWorkspaceView mode="offers" />
);

export const OnboardedCandidatesPage: React.FC = () => (
  <OffersWorkspaceView mode="onboarded" />
);
