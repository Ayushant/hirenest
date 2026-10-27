import React, { useState, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  SkillsChipInput,
} from '../../components/ui/kit';
import {
  SourceBadge,
  StageBadge,
  SlaBadge,
  ScoreBar,
} from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  getOrBuildValidationRecord,
  fetchAllValidationRecordsFromBackend,
  DECISION_GATE_LABELS,
  DECISION_GATE_TONES,
} from '../../lib/recruiterValidation';
import {
  RequirementsPipelineGrid,
  PipelineQuickFilterBar,
  matchesPipelineQuickFilter,
  type PipelineQuickFilter,
} from '../../components/domain/RequirementsPipelineView';
import {
  fetchRequirements,
  fetchRequirementById,
  fetchRequirementVendorShares,
  acknowledgeRequirement,
} from '../../api/requirements';
import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateContacts,
  updateCandidateProfile,
  updateCandidateContacts,
  uploadCandidateResume,
  getResumeSignedUrl,
  fetchMatchesForRequirement,
  fetchMatchesForCandidate,
} from '../../api/candidates';
import {
  fetchSubmissions,
  submitCandidateRpc,
} from '../../api/submissions';
import {
  fetchInterviews,
  getVendorPerformanceRpc,
  fetchInterviewFeedbackList,
  fetchQualityFeedbackList,
  raiseRatingDisputeRpc,
} from '../../api/interviews';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import {
  formatCurrency,
  formatLocalDate,
  formatLocalDateTime,
  formatRequirementBudgetWithSubtitle,
  maskEmail,
  maskPhone,
} from '../../lib/format';
import {
  computeOfferOnboardingMetrics,
  fetchAllOfferOnboardingRecordsApi,
} from '../../lib/offerOnboarding';
import { useToast } from '../../components/ui/Toast';
import type {
  CandidateContacts,
  CandidateMatch,
  FeedbackKind,
  SubmissionStage,
} from '../../types/db';

// 1. Vendor Dashboard
export const VendorDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [quickFilter, setQuickFilter] = useState<PipelineQuickFilter>('all');

  const { data: reqsData } = useQuery({
    queryKey: ['vendor_requirements', 1, ''],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 100, forVendor: true }),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_shares', profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(undefined, profile?.org_id || undefined),
  });

  const { data: subsData } = useQuery({
    queryKey: ['vendor-dashboard-subs', profile?.org_id],
    queryFn: () =>
      fetchSubmissions({
        vendorOrgId: profile?.org_id || undefined,
        page: 1,
        pageSize: 200,
      }),
  });

  const { data: offerRecordsMap } = useQuery({
    queryKey: ['offers-onboarding-workspace', 'vendor_dashboard', profile?.org_id],
    queryFn: fetchAllOfferOnboardingRecordsApi,
  });

  const { data: interviewsData } = useQuery({
    queryKey: ['vendor_interviews_dash', profile?.org_id],
    queryFn: () => fetchInterviews({ status: 'scheduled', page: 1 }),
  });

  const { data: perf } = useQuery({
    queryKey: ['vendor_performance', profile?.org_id],
    queryFn: () => getVendorPerformanceRpc(profile!.org_id!),
    enabled: Boolean(profile?.org_id),
  });

  const offerMetrics = useMemo(
    () => computeOfferOnboardingMetrics(subsData?.data || [], offerRecordsMap),
    [subsData?.data, offerRecordsMap]
  );

  const allRequirements = reqsData?.data || [];
  const activeShares = shares.filter((s) => !s.revoked_at);
  const unacknowledged = activeShares.filter((s) => !s.acknowledged_at);
  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  return (
    <div className="space-y-8">
      <div className="dashboard-header-band rounded-[10px] border border-[var(--border)] px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="type-greeting text-[var(--text-primary)]">
            Good day, {firstName}
          </h1>
          <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">
            Shared requirements, SLA countdowns, and agency performance standing.
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/vendor/requirements')}>
          Open requirements pipeline
        </Button>
      </div>

      {/* Needs attention */}
      <div className="space-y-2.5">
        <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Needs attention
        </h2>
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
          {activeShares.length === 0 && allRequirements.length === 0 ? (
            <div className="flex h-11 items-center px-4 text-[13px] text-[var(--text-secondary)]">
              No active requirement shares right now.
            </div>
          ) : activeShares.length > 0 ? (
            activeShares.slice(0, 8).map((sh) => (
              <div
                key={sh.id}
                onClick={() => navigate(`/vendor/requirements/${sh.requirement_id}`)}
                className="flex h-11 items-center justify-between gap-4 px-4 hover:bg-[var(--bg-hover)] cursor-pointer text-[13px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-[var(--text-primary)] truncate">
                    {sh.requirements?.title || sh.requirement_id}
                  </span>
                  {!sh.acknowledged_at && (
                    <Badge tone="warning">Unacknowledged</Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                    Due {formatLocalDateTime(sh.due_at)}
                  </span>
                  <SlaBadge dueAt={sh.due_at} showCountdown />
                </div>
              </div>
            ))
          ) : (
            allRequirements.slice(0, 8).map((req) => (
              <div
                key={req.id}
                onClick={() => navigate(`/vendor/requirements/${req.id}`)}
                className="flex h-11 items-center justify-between gap-4 px-4 hover:bg-[var(--bg-hover)] cursor-pointer text-[13px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-[var(--text-primary)] truncate">
                    {req.title}
                  </span>
                  <Badge tone="emerald">Active</Badge>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                    {formatRequirementBudgetWithSubtitle(req).formatted}
                  </span>
                  <span className="text-[12px] text-[var(--accent)] font-medium">
                    View →
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4-Metric Strip */}
      <MetricStrip
        items={[
          {
            label: 'Unacknowledged shares',
            value: unacknowledged.length,
            tone: unacknowledged.length > 0 ? 'warning' : 'default',
            onClick: () => navigate('/vendor/requirements'),
          },
          {
            label: 'Active requirements',
            value: Math.max(activeShares.length, allRequirements.length),
            onClick: () => navigate('/vendor/requirements'),
          },
          {
            label: 'Total submissions',
            value: subsData?.count ?? 0,
            onClick: () => navigate('/vendor/submissions'),
          },
          {
            label: 'Scheduled interviews',
            value: interviewsData?.count ?? 0,
            onClick: () => navigate('/vendor/interviews'),
          },
        ]}
      />

      {/* Vendor Offer & Onboarding Tracking Strip */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Candidate Offers &amp; Joining Tracker
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/vendor/offers')}>
              Offers ({offerMetrics.offersIssued})
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/vendor/onboarded')}>
              Onboarded ({offerMetrics.onboardedCandidates})
            </Button>
          </div>
        </div>
        <MetricStrip
          items={[
            {
              label: 'Candidates shared',
              value: offerMetrics.candidatesShared,
              onClick: () => navigate('/vendor/submissions'),
            },
            {
              label: 'Offers issued',
              value: offerMetrics.offersIssued,
              onClick: () => navigate('/vendor/offers'),
            },
            {
              label: 'Offers accepted',
              value: offerMetrics.offersAccepted,
              tone: offerMetrics.offersAccepted > 0 ? 'success' : 'default',
              onClick: () => navigate('/vendor/offers'),
            },
            {
              label: 'Pending offers',
              value: offerMetrics.pendingOffers,
              tone: offerMetrics.pendingOffers > 0 ? 'warning' : 'default',
              onClick: () => navigate('/vendor/offers'),
            },
            {
              label: 'Confirmed onboarded',
              value: offerMetrics.onboardedCandidates,
              tone: offerMetrics.onboardedCandidates > 0 ? 'success' : 'default',
              onClick: () => navigate('/vendor/onboarded'),
            },
            {
              label: 'Upcoming joinings',
              value: offerMetrics.upcomingJoiningsCount,
              onClick: () => navigate('/vendor/onboarded'),
            },
          ]}
        />
      </div>

      {/* Active Requirements Pipeline on Vendor Overview Dashboard */}
      {allRequirements.length > 0 && (
        <RequirementsPipelineGrid
          requirements={allRequirements}
          shares={shares}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
          onSelectRequirement={(req) => navigate(`/vendor/requirements/${req.id}`)}
        />
      )}

      {perf && (
        <div className="space-y-3">
          <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Agency performance standing
          </h2>
          <VendorPerformancePanel performance={perf} />
        </div>
      )}
    </div>
  );
};

// 2. Vendor Open Requirements Pipeline Page
export const VendorRequirementsPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [quickFilter, setQuickFilter] = useState<PipelineQuickFilter>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_requirements', page, search],
    queryFn: () => fetchRequirements({ page, pageSize: 100, search, forVendor: true }),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_shares', profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(undefined, profile?.org_id || undefined),
  });

  const allRequirements = data?.data || [];
  const filteredRows = allRequirements.filter((req) =>
    matchesPipelineQuickFilter(req, quickFilter)
  );

  return (
    <div className="space-y-5">
      {/* Operational Staffing OS Header Band */}
      <div className="pb-4 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h1 className="text-[14px] leading-[20px] font-bold uppercase tracking-[0.02em] text-[var(--text-primary)]">
              Operational Staffing OS
            </h1>
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
              High-density governance layer, Requirements &amp; AI Matching.
            </p>
          </div>

          <div className="w-full sm:w-64">
            <Input
              placeholder="SEARCH REQUIREMENTS..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !allRequirements.length ? (
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
          <EmptyState
            title="No requirements shared with your agency yet"
            description="HireNest HQ shares open requirements with your agency here."
          />
        </div>
      ) : viewMode === 'cards' ? (
        <RequirementsPipelineGrid
          requirements={allRequirements}
          shares={shares}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
          onSelectRequirement={(req) => navigate(`/vendor/requirements/${req.id}`)}
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

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Location &amp; mode</th>
                  <th className="text-right">Vendor budget</th>
                  <th>Acknowledgement</th>
                  <th>SLA countdown</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((req) => {
                  const share = shares.find((s) => s.requirement_id === req.id);
                  const budgetInfo = formatRequirementBudgetWithSubtitle(req);
                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/vendor/requirements/${req.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {req.title}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {req.min_experience}–{req.max_experience} yrs · {req.openings} opening(s)
                        </div>
                      </td>
                      <td className="capitalize text-[var(--text-secondary)]">
                        {req.location} · {req.work_mode}
                      </td>
                      <td className="text-right">
                        <div className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                          {budgetInfo.formatted}
                        </div>
                        {budgetInfo.subtitle && (
                          <div className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
                            {budgetInfo.subtitle}
                          </div>
                        )}
                      </td>
                      <td>
                        {share?.acknowledged_at ? (
                          <Badge tone="success">Acknowledged</Badge>
                        ) : (
                          <Badge tone="warning">Needs acknowledgement</Badge>
                        )}
                      </td>
                      <td>
                        <SlaBadge dueAt={share?.due_at} showCountdown />
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
    </div>
  );
};

// 3. Vendor Shared Requirement Detail Page (2-column 1200px layout)
export const VendorRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'matches' | 'submissions' | 'overview'>('matches');
  const [acking, setAcking] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data: req, isLoading } = useQuery({
    queryKey: ['vendor_req_detail', id, profile?.role, profile?.org_id],
    queryFn: () =>
      fetchRequirementById(id!, {
        viewerRole: profile?.role,
        viewerOrgId: profile?.org_id,
      }),
    enabled: Boolean(id),
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_req_shares', id, profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(id!, profile?.org_id || undefined),
    enabled: Boolean(id),
  });

  const { data: matchesData } = useQuery({
    queryKey: ['vendor_req_matches', id],
    queryFn: () => fetchMatchesForRequirement({ requirementId: id!, page: 1 }),
    enabled: Boolean(id),
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['vendor_req_submissions', id, profile?.org_id],
    queryFn: () =>
      fetchSubmissions({
        requirementId: id!,
        vendorOrgId: profile?.org_id || undefined,
        page: 1,
      }),
    enabled: Boolean(id && profile?.org_id),
  });

  const share = shares[0];

  const handleAcknowledge = async () => {
    if (!id) return;
    setAcking(true);
    try {
      await acknowledgeRequirement({
        p_requirement_id: id,
        vendorOrgId: profile?.org_id,
      });
      toast({
        title: 'Requirement acknowledged',
        description: 'Response speed recorded for SLA metrics.',
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['vendor_req_shares'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_requirements'] });
    } catch (err) {
      toast({
        title: 'Could not acknowledge',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setAcking(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!submitTarget || !id) return;
    setSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: id,
        p_candidate_id: submitTarget.candidate_id,
        p_notes: submitNotes.trim() || null,
      });
      if (res.status === 'duplicate') {
        setDupReason(res.reason);
        setSubmitTarget(null);
        return;
      }
      toast({
        title: 'Candidate submitted to requirement',
        tone: 'success',
      });
      setSubmitTarget(null);
      setSubmitNotes('');
      queryClient.invalidateQueries({ queryKey: ['vendor_req_submissions'] });
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !req) return <TableSkeleton rows={5} cols={4} />;

  const mySubmissions = submissionsData?.data || [];
  const budgetInfo = formatRequirementBudgetWithSubtitle(req);

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title={req.title}
        description={`${req.location} (${req.work_mode}) · ${req.min_experience}–${req.max_experience} yrs · Vendor budget: ${budgetInfo.formatted}${budgetInfo.subtitle ? ` (${budgetInfo.subtitle})` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {share && <SlaBadge dueAt={share.due_at} showCountdown />}
            {share && !share.acknowledged_at && (
              <Button onClick={handleAcknowledge} loading={acking}>
                Acknowledge requirement
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 min-w-0 w-full space-y-6">
          <Tabs
            tabs={[
              {
                id: 'matches',
                label: 'Matching candidates',
                count: matchesData?.count || 0,
              },
              {
                id: 'submissions',
                label: 'Submissions',
                count: mySubmissions.length,
              },
              {
                id: 'overview',
                label: 'Specification',
              },
            ]}
            activeTab={activeTab}
            onChange={(t) => setActiveTab(t as 'matches' | 'submissions' | 'overview')}
          />

          {activeTab === 'matches' && (
            !matchesData?.data.length ? (
              <EmptyState
                title="No matching candidates in your pool yet"
                description="Add candidates with matching skills in your Candidate Pool to see ranked matches here."
              />
            ) : (
              <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {matchesData.data.map((m, idx) => {
                  const alreadySubmitted = mySubmissions.some(
                    (s) => s.candidate_id === m.candidate_id
                  );
                  return (
                    <div key={m.id} className="py-3 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)] w-6">
                            #{idx + 1}
                          </span>
                          <Link
                            to={`/vendor/candidates/${m.candidate_id}`}
                            className="text-[14px] font-medium text-[var(--text-primary)] hover:underline truncate"
                          >
                            {m.candidates?.full_name || m.candidate_id}
                          </Link>
                          <span className="text-[13px] text-[var(--text-secondary)]">
                            {m.candidates?.current_title || '—'} ·{' '}
                            <span className="font-mono tabular-nums">
                              {m.candidates?.total_experience_years ?? '—'} yrs
                            </span>
                          </span>
                        </div>

                        <div className="flex items-center gap-4">
                          <ScoreBar
                            score={m.final_score}
                            isOverridden={m.override_score !== null}
                          />
                          {alreadySubmitted ? (
                            <Badge tone="success">Submitted</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSubmitTarget(m);
                                setSubmitNotes('');
                              }}
                            >
                              Review & submit
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="pl-9 flex flex-wrap gap-1.5">
                        {(m.matched_skills || []).map((sk) => (
                          <span
                            key={`m-${sk}`}
                            className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
                          >
                            {sk}
                          </span>
                        ))}
                        {(m.unproven_skills || []).map((sk) => (
                          <span
                            key={`u-${sk}`}
                            title="Not in resume; not proof of absence"
                            className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] text-[var(--text-tertiary)]"
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {activeTab === 'submissions' && (
            !mySubmissions.length ? (
              <EmptyState
                title="No submissions for this requirement yet"
                description="Select a candidate from Matching candidates to submit."
              />
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Stage</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mySubmissions.map((sub) => (
                      <tr
                        key={sub.id}
                        onClick={() => setDrawerSubId(sub.id)}
                        className="cursor-pointer"
                      >
                        <td className="font-medium text-[var(--text-primary)]">
                          {sub.candidates?.full_name || sub.candidate_id}
                        </td>
                        <td>
                          <StageBadge stage={sub.stage} />
                        </td>
                        <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                          {formatLocalDateTime(sub.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'overview' && (
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
            </div>
          )}
        </div>

        {/* Right key-facts rail (320px) */}
        <aside className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-6 lg:pt-0 lg:pl-6 space-y-4">
          <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">
            Key facts
          </h3>
          <dl className="divide-y divide-[var(--border)] text-[13px]">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Vendor budget</dt>
              <dd className="text-right">
                <div className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {budgetInfo.formatted}
                </div>
                {budgetInfo.subtitle && (
                  <div className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
                    {budgetInfo.subtitle}
                  </div>
                )}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">SLA due</dt>
              <dd className="font-mono tabular-nums text-[var(--text-primary)]">
                {formatLocalDateTime(share?.due_at)}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Acknowledged</dt>
              <dd className="font-mono tabular-nums text-[var(--text-secondary)]">
                {share?.acknowledged_at ? formatLocalDateTime(share.acknowledged_at) : 'Pending'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Experience</dt>
              <dd className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.min_experience}–{req.max_experience} yrs
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Openings</dt>
              <dd className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.openings}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* Submit Candidate Dialog showing Match Evidence first */}
      <Dialog
        open={Boolean(submitTarget)}
        onClose={() => setSubmitTarget(null)}
        title="Submit candidate to requirement"
        description="Verify match evidence and add submission notes before submitting."
      >
        {submitTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitTarget} />
            <Textarea
              label="Submission notes"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              placeholder="Notice period, availability for interviews, rate confirmation..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSubmit} loading={submitting}>
                Confirm submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_recruiter'}
      />

      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />
    </div>
  );
};

// 4. Vendor Candidate Pool Page (list, add, edit own candidates)
export const VendorCandidatePoolPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'single' | 'bulk'>('single');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_candidates', profile?.org_id, page, search],
    queryFn: () =>
      fetchCandidates({
        page,
        ownerVendorOrgId: profile?.org_id || undefined,
        search,
      }),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div>
      <PageHeader
        title="Candidate pool"
        description="Manage candidates owned by your agency. Resume auto-parsing and SHA-256 deduplication run automatically on upload."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setModalMode('bulk');
                setAddOpen(true);
              }}
            >
              Bulk upload resumes
            </Button>
            <Button
              onClick={() => {
                setModalMode('single');
                setAddOpen(true);
              }}
            >
              Add candidate
            </Button>
          </div>
        }
      />

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search candidate name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No candidates in your agency pool yet"
          description="Add a candidate or bulk-upload resumes to auto-parse skills and start matching against shared requirements."
          actionLabel="Add candidate"
          onAction={() => {
            setModalMode('single');
            setAddOpen(true);
          }}
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Masked contact</th>
                  <th>Skills</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => {
                  const rawContacts = Array.isArray(c.candidate_contacts)
                    ? c.candidate_contacts[0]
                    : (c.candidate_contacts as CandidateContacts | null);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/vendor/candidates/${c.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {c.full_name}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {c.current_title || '—'} ·{' '}
                          <span className="font-mono tabular-nums">
                            {c.total_experience_years ?? '—'} yrs
                          </span>{' '}
                          · {c.location || '—'}
                        </div>
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        <div>{maskEmail(rawContacts?.email)}</div>
                        <div>{maskPhone(rawContacts?.phone)}</div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {(c.skills || []).slice(0, 5).map((sk) => (
                            <span
                              key={sk}
                              className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[12px] text-[var(--text-primary)]"
                            >
                              {sk}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {formatLocalDate(c.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <CandidateFormModal
        open={addOpen}
        defaultMode={modalMode}
        onClose={() => setAddOpen(false)}
        onCreated={(candidateId) => {
          queryClient.invalidateQueries({ queryKey: ['vendor_candidates'] });
          if (modalMode === 'single') {
            navigate(`/vendor/candidates/${candidateId}`);
          }
        }}
      />
    </div>
  );
};

// 5. Vendor Candidate Detail & Edit Page (2-column 1200px layout)
export const VendorCandidateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'matches' | 'submissions' | 'overview'>('matches');
  const [matchesPage, setMatchesPage] = useState(1);
  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [submitTarget, setSubmitTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data: cand, isLoading } = useQuery({
    queryKey: ['vendor_candidate_detail', id],
    queryFn: () => fetchCandidateById(id!),
    enabled: Boolean(id),
  });

  const { data: contacts } = useQuery({
    queryKey: ['vendor_candidate_contacts', id],
    queryFn: () => fetchCandidateContacts(id!),
    enabled: Boolean(id),
  });

  const { data: matchesData } = useQuery({
    queryKey: ['vendor_candidate_matches', id, matchesPage],
    queryFn: () => fetchMatchesForCandidate({ candidateId: id!, page: matchesPage }),
    enabled: Boolean(id),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['vendor_candidate_submissions', id, profile?.org_id],
    queryFn: () =>
      fetchSubmissions({
        candidateId: id!,
        vendorOrgId: profile?.org_id || undefined,
        pageSize: 50,
      }),
    enabled: Boolean(id && profile?.org_id),
  });

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [location, setLocation] = useState('');
  const [expYears, setExpYears] = useState('0');
  const [skills, setSkills] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (!cand) return;
    setFullName(cand.full_name);
    setCurrentTitle(cand.current_title || '');
    setLocation(cand.location || '');
    setExpYears(String(cand.total_experience_years ?? 0));
    setSkills(cand.skills || []);
    setSummary(cand.summary || '');
    setEmail(contacts?.email || '');
    setPhone(contacts?.phone || '');
    setLinkedin(contacts?.linkedin_url || '');
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cand) return;
    setSaving(true);
    try {
      await updateCandidateProfile(cand.id, {
        full_name: fullName.trim(),
        current_title: currentTitle.trim() || null,
        location: location.trim() || null,
        total_experience_years: Number(expYears),
        skills,
        summary: summary.trim() || null,
      });
      await updateCandidateContacts(cand.id, {
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedin_url: linkedin.trim() || null,
      });
      toast({ title: 'Candidate profile updated', tone: 'success' });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_detail', id] });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_contacts', id] });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_matches', id] });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cand) return;
    const err = validateResumeFile(file);
    if (err) {
      toast({ title: 'Invalid resume file', description: err, tone: 'error' });
      return;
    }
    try {
      const hash = await computeFileSha256(file);
      await uploadCandidateResume(cand.id, file, hash);
      toast({ title: 'Resume uploaded', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_detail', id] });
    } catch (uploadErr) {
      toast({
        title: 'Resume upload failed',
        description: mapSupabaseError(uploadErr),
        tone: 'error',
      });
    }
  };

  const handleViewResume = async () => {
    if (!cand?.resume_path) return;
    try {
      const url = await getResumeSignedUrl(cand.resume_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Could not open resume',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const handleSubmitToRequirement = async () => {
    if (!submitTarget || !cand) return;
    setSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: submitTarget.requirement_id,
        p_candidate_id: cand.id,
        p_notes: submitNotes.trim() || null,
      });
      if (res.status === 'duplicate') {
        setDupReason(res.reason);
        setSubmitTarget(null);
        return;
      }
      toast({
        title: 'Candidate submitted to requirement',
        tone: 'success',
      });
      setSubmitTarget(null);
      setSubmitNotes('');
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_submissions', id] });
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !cand) return <TableSkeleton rows={4} cols={4} />;

  const mySubmissions = submissionsData?.data || [];

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title={cand.full_name}
        description={`${cand.current_title || 'Candidate'} · ${cand.location || '—'} · ${
          cand.total_experience_years ?? 0
        } yrs experience`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {cand.resume_path && (
              <Button size="sm" variant="outline" onClick={handleViewResume}>
                View resume
              </Button>
            )}
            <label className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)]">
              <span>{cand.resume_path ? 'Replace resume' : 'Upload resume'}</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleReplaceResume}
                className="hidden"
              />
            </label>
            <Button size="sm" onClick={startEdit}>
              Edit candidate
            </Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 min-w-0 w-full space-y-6">
          <Tabs
            tabs={[
              {
                id: 'matches',
                label: 'Matching requirements',
                count: matchesData?.count || 0,
              },
              {
                id: 'submissions',
                label: 'Submissions',
                count: mySubmissions.length,
              },
              {
                id: 'overview',
                label: 'Overview',
              },
            ]}
            activeTab={activeTab}
            onChange={(t) => setActiveTab(t as 'matches' | 'submissions' | 'overview')}
          />

          {activeTab === 'matches' && (
            <div className="space-y-4">
              {!matchesData?.data.length ? (
                <EmptyState
                  title="No matching shared requirements yet"
                  description="When HireNest HQ shares open requirements matching this candidate's skills, they appear here."
                />
              ) : (
                <div>
                  <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {matchesData.data.map((m, idx) => {
                      const existingSub = mySubmissions.find(
                        (s) => s.requirement_id === m.requirement_id
                      );
                      return (
                        <div key={m.id} className="py-3 flex flex-col gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)] w-6">
                                #{idx + 1}
                              </span>
                              <Link
                                to={`/vendor/requirements/${m.requirement_id}`}
                                className="text-[14px] font-medium text-[var(--text-primary)] hover:underline truncate"
                              >
                                {m.requirements?.title || m.requirement_id}
                              </Link>
                              <span className="text-[13px] text-[var(--text-secondary)]">
                                {m.requirements?.location || '—'} ({m.requirements?.work_mode || '—'})
                              </span>
                              {existingSub ? (
                                <StageBadge stage={existingSub.stage} />
                              ) : (
                                <span className="text-[12px] text-[var(--text-tertiary)]">
                                  Potential match
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <ScoreBar
                                score={m.final_score}
                                isOverridden={m.override_score !== null}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEvidenceTarget(m)}
                              >
                                Evidence
                              </Button>
                              {existingSub ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setDrawerSubId(existingSub.id)}
                                >
                                  View pipeline
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSubmitTarget(m);
                                    setSubmitNotes('');
                                  }}
                                >
                                  Submit
                                </Button>
                              )}
                            </div>
                          </div>

                          <div className="pl-9 flex flex-wrap gap-1.5">
                            {(m.matched_skills || []).map((sk) => (
                              <span
                                key={`m-${sk}`}
                                className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
                              >
                                {sk}
                              </span>
                            ))}
                            {(m.unproven_skills || []).map((sk) => (
                              <span
                                key={`u-${sk}`}
                                title="Not in resume; not proof of absence"
                                className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] text-[var(--text-tertiary)]"
                              >
                                {sk}
                              </span>
                            ))}
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

          {activeTab === 'submissions' && (
            !mySubmissions.length ? (
              <EmptyState
                title="No submissions for this candidate yet"
                description="Select a requirement from Matching requirements to submit this candidate."
              />
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Requirement</th>
                      <th>Stage</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mySubmissions.map((sub) => (
                      <tr
                        key={sub.id}
                        onClick={() => setDrawerSubId(sub.id)}
                        className="cursor-pointer"
                      >
                        <td className="font-medium text-[var(--text-primary)]">
                          {sub.requirements?.title || sub.requirement_id}
                        </td>
                        <td>
                          <StageBadge stage={sub.stage} />
                        </td>
                        <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                          {formatLocalDateTime(sub.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                  Summary
                </h3>
                <p className="text-[14px] leading-[22px] text-[var(--text-primary)] whitespace-pre-line">
                  {cand.summary || 'No summary provided.'}
                </p>
              </div>
              <div className="pt-4 border-t border-[var(--border)]">
                <h3 className="text-[12px] font-medium text-[var(--text-secondary)] mb-2">
                  Skills ({cand.skills?.length || 0})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(cand.skills || []).map((sk) => (
                    <span
                      key={sk}
                      className="inline-flex items-center rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right key-facts rail (320px) */}
        <aside className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-6 lg:pt-0 lg:pl-6 space-y-4">
          <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">
            Key facts
          </h3>
          <dl className="divide-y divide-[var(--border)] text-[13px]">
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Source</dt>
              <dd>
                <SourceBadge
                  source={cand.original_source}
                  vendorName={cand.source_vendor?.name}
                />
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Owner agency</dt>
              <dd className="text-[var(--text-primary)]">
                {cand.owner_vendor?.name || 'My agency'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Email</dt>
              <dd className="font-mono text-[12px] text-[var(--text-primary)]">
                {contacts?.email || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Phone</dt>
              <dd className="font-mono text-[12px] text-[var(--text-primary)]">
                {contacts?.phone || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">LinkedIn</dt>
              <dd className="truncate max-w-[180px] text-[12px] text-[var(--text-secondary)]">
                {contacts?.linkedin_url || '—'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Resume SHA-256</dt>
              <dd className="font-mono text-[12px] text-[var(--text-tertiary)]">
                {cand.resume_hash ? cand.resume_hash.slice(0, 10) : '—'}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* Inspect Match Evidence Modal */}
      <Dialog
        open={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        title="Match evidence"
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

      {/* Submit Candidate to Requirement Modal */}
      <Dialog
        open={Boolean(submitTarget)}
        onClose={() => setSubmitTarget(null)}
        title="Submit candidate to requirement"
        description="Verify match evidence and add submission notes before submitting."
      >
        {submitTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitTarget} />
            <Textarea
              label="Submission notes"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              placeholder="Notice period, availability for interviews, rate confirmation..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitToRequirement} loading={submitting}>
                Confirm submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_recruiter'}
      />

      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit candidate profile"
        maxWidth="max-w-[640px]"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Full name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <Input
              label="Current title"
              value={currentTitle}
              onChange={(e) => setCurrentTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <Input
              label="Total experience (years)"
              type="number"
              step="0.5"
              value={expYears}
              onChange={(e) => setExpYears(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              label="LinkedIn URL"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
            />
          </div>
          <SkillsChipInput skills={skills} onChange={setSkills} />
          <Textarea
            label="Summary"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

// 6. Vendor Submissions Page
export const VendorSubmissionsPage: React.FC = () => {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<SubmissionStage | ''>('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_submissions_list', profile?.org_id, page, stage],
    queryFn: () =>
      fetchSubmissions({
        page,
        vendorOrgId: profile?.org_id || undefined,
        stage,
      }),
    enabled: Boolean(profile?.org_id),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });

  useQuery({
    queryKey: ['submission_validations_vendor'],
    queryFn: fetchAllValidationRecordsFromBackend,
    refetchInterval: 10000,
  });

  return (
    <div>
      <PageHeader
        title="Submissions"
        description="Track pipeline stages, recruiter validation status, skill-gap clarification requests, scheduled interviews, and withdraw submissions with a reason."
      />

      <div className="mb-4 max-w-xs">
        <Select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as SubmissionStage | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All stages' },
            { value: 'applied', label: 'Applied' },
            { value: 'recruiter_review', label: 'Recruiter review' },
            { value: 'client_review', label: 'Client review' },
            { value: 'interviewing', label: 'Interviewing' },
            { value: 'offered', label: 'Offered' },
            { value: 'onboarded', label: 'Onboarded' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'withdrawn', label: 'Withdrawn' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No submissions recorded yet"
          description="Submit candidates from a shared requirement to track their progress here."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Requirement</th>
                  <th>Recruiter validation</th>
                  <th>Follow-up / gap action</th>
                  <th>Stage</th>
                  <th>Compliance</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((sub) => {
                  const validation = getOrBuildValidationRecord(sub, null);
                  const latestFollowUp = validation.follow_up_requests[0];
                  return (
                    <tr
                      key={sub.id}
                      onClick={() => setDrawerSubId(sub.id)}
                      className="cursor-pointer"
                    >
                      <td className="font-medium text-[var(--text-primary)]">
                        <div>{sub.candidates?.full_name || sub.candidate_id}</div>
                        <div className="text-[11px] font-mono text-[var(--text-tertiary)]">
                          JD Match {validation.jd_match_percentage}% · {validation.resume_version_used}
                        </div>
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {sub.requirements?.title || sub.requirement_id}
                      </td>
                      <td>
                        <Badge tone={DECISION_GATE_TONES[validation.decision_gate]}>
                          {DECISION_GATE_LABELS[validation.decision_gate]}
                        </Badge>
                      </td>
                      <td>
                        {latestFollowUp ? (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone={
                                latestFollowUp.status === 'verified'
                                  ? 'emerald'
                                  : latestFollowUp.status === 'responded'
                                    ? 'sky'
                                    : 'amber'
                              }
                            >
                              {latestFollowUp.status === 'requested'
                                ? 'Clarification requested'
                                : latestFollowUp.status === 'responded'
                                  ? 'Response submitted'
                                  : 'Verified'}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[var(--text-tertiary)]">No pending requests</span>
                        )}
                      </td>
                      <td>
                        <StageBadge stage={sub.stage} />
                      </td>
                      <td>
                        {sub.is_valid ? (
                          <Badge tone="success">Valid</Badge>
                        ) : (
                          <Badge tone="danger">Invalid: {sub.invalid_reason}</Badge>
                        )}
                      </td>
                      <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {formatLocalDateTime(sub.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_recruiter'}
      />
    </div>
  );
};

// 7. Vendor Ratings & Performance Page
export const VendorRatingsPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isVendorAdmin = profile?.role === 'vendor_admin';

  const [disputeTarget, setDisputeTarget] = useState<{
    kind: FeedbackKind;
    feedbackId: string;
    summary: string;
  } | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputing, setDisputing] = useState(false);

  const { data: perf, isLoading: loadingPerf } = useQuery({
    queryKey: ['vendor_performance', profile?.org_id],
    queryFn: () => getVendorPerformanceRpc(profile!.org_id!),
    enabled: Boolean(profile?.org_id),
  });

  const { data: sharedInterviewFb } = useQuery({
    queryKey: ['vendor_shared_interview_fb', profile?.org_id],
    queryFn: () => fetchInterviewFeedbackList({ page: 1, pageSize: 25 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: sharedQualityFb } = useQuery({
    queryKey: ['vendor_shared_quality_fb', profile?.org_id],
    queryFn: () => fetchQualityFeedbackList({ page: 1, pageSize: 25 }),
    enabled: Boolean(profile?.org_id),
  });

  const handleRaiseDispute = async () => {
    if (!disputeTarget || disputeReason.trim().length < 20) return;
    setDisputing(true);
    try {
      await raiseRatingDisputeRpc({
        p_kind: disputeTarget.kind,
        p_feedback_id: disputeTarget.feedbackId,
        p_reason: disputeReason.trim(),
      });
      toast({
        title: 'Rating dispute submitted to HireNest HQ',
        description: 'HireNest Admin will review your evidence and resolve the dispute.',
        tone: 'success',
      });
      setDisputeTarget(null);
      setDisputeReason('');
      queryClient.invalidateQueries({ queryKey: ['vendor_performance'] });
    } catch (err) {
      toast({
        title: 'Could not raise dispute',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setDisputing(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ratings & performance"
        description="Three-pillar standing (Timing, Quality, Compliance) and client feedback shared by HireNest HQ."
      />

      {loadingPerf ? (
        <TableSkeleton rows={4} cols={4} />
      ) : perf ? (
        <VendorPerformancePanel performance={perf} />
      ) : null}

      {/* Shared Interview Feedback */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Shared interview feedback ({sharedInterviewFb?.data?.length || 0})
        </h3>
        {!sharedInterviewFb?.data?.length ? (
          <p className="text-[13px] text-[var(--text-secondary)]">
            No interview feedback has been approved for vendor sharing yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {sharedInterviewFb.data.map((fb) => (
              <div
                key={fb.id}
                className="py-3 flex flex-wrap items-start justify-between gap-4"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="text-[14px] font-medium text-[var(--text-primary)]">
                    {fb.interviews?.submissions?.candidates?.full_name || 'Candidate'} ·{' '}
                    <span className="text-[var(--text-secondary)] font-normal">
                      {fb.interviews?.submissions?.requirements?.title || 'Requirement'}
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                    Overall: {fb.overall_rating}/5 · Skill: {fb.skill_rating}/5 · Comm:{' '}
                    {fb.communication_rating}/5 · Decision: {fb.decision}
                  </div>
                  <p className="text-[13px] text-[var(--text-primary)]">{fb.feedback}</p>
                </div>
                {isVendorAdmin && !fb.excluded_from_score && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDisputeTarget({
                        kind: 'interview',
                        feedbackId: fb.id,
                        summary: fb.feedback,
                      });
                      setDisputeReason('');
                    }}
                  >
                    Dispute rating
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shared Candidate Quality Feedback */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Shared candidate quality feedback ({sharedQualityFb?.data?.length || 0})
        </h3>
        {!sharedQualityFb?.data?.length ? (
          <p className="text-[13px] text-[var(--text-secondary)]">
            No candidate quality ratings have been approved for vendor sharing yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {sharedQualityFb.data.map((qf) => (
              <div
                key={qf.id}
                className="py-3 flex flex-wrap items-start justify-between gap-4"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="text-[14px] font-medium text-[var(--text-primary)]">
                    {qf.submissions?.candidates?.full_name || 'Candidate'} ·{' '}
                    <span className="text-[var(--text-secondary)] font-normal">
                      {qf.submissions?.requirements?.title || 'Requirement'}
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                    Overall suitability: {qf.overall_suitability}/5 · JD align:{' '}
                    {qf.jd_skill_alignment}/5 · Experience: {qf.relevant_experience}/5
                  </div>
                  {qf.comments && (
                    <p className="text-[13px] text-[var(--text-primary)]">{qf.comments}</p>
                  )}
                </div>
                {isVendorAdmin && !qf.excluded_from_score && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDisputeTarget({
                        kind: 'quality',
                        feedbackId: qf.id,
                        summary: qf.comments || `Overall suitability ${qf.overall_suitability}/5`,
                      });
                      setDisputeReason('');
                    }}
                  >
                    Dispute rating
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(disputeTarget)}
        onClose={() => setDisputeTarget(null)}
        title="Raise rating dispute"
        description="Provide factual evidence (minimum 20 characters) for HireNest Admin review."
      >
        <div className="space-y-4">
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[13px]">
            <span className="text-[12px] font-medium text-[var(--text-secondary)] block">
              Disputed feedback
            </span>
            <p className="mt-1 text-[var(--text-primary)]">
              {disputeTarget?.summary}
            </p>
          </div>
          <Textarea
            label="Dispute reason (min 20 characters)"
            rows={4}
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Explain factual inaccuracies or process discrepancies..."
            error={
              disputeReason.length > 0 && disputeReason.trim().length < 20
                ? 'Reason must be at least 20 characters.'
                : undefined
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisputeTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRaiseDispute}
              loading={disputing}
              disabled={disputeReason.trim().length < 20}
            >
              Submit dispute
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

// 8. Vendor Match Intelligence Page (/vendor/matches)
export const VendorMatchIntelligencePage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [selectedReqId, setSelectedReqId] = useState<string>('');

  const { data: reqsData, isLoading: loadingReqs } = useQuery({
    queryKey: ['vendor_requirements_for_matches'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 100, forVendor: true }),
  });

  const requirements = reqsData?.data || [];
  const activeReqId = selectedReqId || requirements[0]?.id || '';
  const activeReq = requirements.find((r) => r.id === activeReqId) || null;

  const { data: matchesData, isLoading: loadingMatches } = useQuery({
    queryKey: ['vendor_match_intelligence', activeReqId],
    queryFn: () => fetchMatchesForRequirement({ requirementId: activeReqId, page: 1 }),
    enabled: Boolean(activeReqId),
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['vendor_match_subs', activeReqId, profile?.org_id],
    queryFn: () =>
      fetchSubmissions({
        requirementId: activeReqId,
        vendorOrgId: profile?.org_id || undefined,
        page: 1,
      }),
    enabled: Boolean(activeReqId && profile?.org_id),
  });

  const mySubmissions = submissionsData?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Match intelligence"
        description="Deterministic 6-pillar candidate matching across your agency pool and active open requirements."
      />

      {loadingReqs ? (
        <TableSkeleton rows={4} cols={4} />
      ) : !requirements.length ? (
        <EmptyState
          title="No active requirements available for matching"
          description="Once HQ publishes and shares requirements with your agency, ranked candidate matches will appear here."
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="w-full sm:w-96">
              <Select
                label="Target requirement"
                value={activeReqId}
                onChange={(e) => setSelectedReqId(e.target.value)}
                options={requirements.map((r) => {
                  const b = formatRequirementBudgetWithSubtitle(r);
                  return {
                    value: r.id,
                    label: `${r.title} (${r.location} · ${b.formatted})`,
                  };
                })}
              />
            </div>

            {activeReq && (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/vendor/requirements/${activeReq.id}`)}
                >
                  Open requirement &amp; submit →
                </Button>
              </div>
            )}
          </div>

          {loadingMatches ? (
            <TableSkeleton rows={5} cols={4} />
          ) : !matchesData?.data?.length ? (
            <EmptyState
              title="No matching candidates in your pool for this requirement"
              description="Add candidates with overlapping skills in your Candidate Pool to compute ranked matches."
              actionLabel="Go to Candidates"
              onAction={() => navigate('/vendor/candidates')}
            />
          ) : (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              {matchesData.data.map((m, idx) => {
                const alreadySubmitted = mySubmissions.some(
                  (s) => s.candidate_id === m.candidate_id
                );
                return (
                  <div
                    key={m.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                          #{idx + 1}
                        </span>
                        <Link
                          to={`/vendor/candidates/${m.candidate_id}`}
                          className="text-[14px] font-semibold text-[var(--text-primary)] hover:underline truncate"
                        >
                          {m.candidates?.full_name || m.candidate_id}
                        </Link>
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          {m.candidates?.current_title || '—'} ·{' '}
                          <span className="font-mono tabular-nums">
                            {m.candidates?.total_experience_years ?? '—'} yrs
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(m.matched_skills || []).map((sk) => (
                          <span
                            key={`m-${sk}`}
                            className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]"
                          >
                            {sk}
                          </span>
                        ))}
                        {(m.unproven_skills || []).map((sk) => (
                          <span
                            key={`u-${sk}`}
                            className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]"
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <ScoreBar
                        score={m.final_score}
                        isOverridden={m.override_score !== null}
                      />
                      {alreadySubmitted ? (
                        <Badge tone="success">Submitted</Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => navigate(`/vendor/requirements/${activeReqId}`)}
                        >
                          Review &amp; submit
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 9. Vendor Interviews Page (/vendor/interviews)
export const VendorInterviewsPage: React.FC = () => {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_interviews_page', profile?.org_id, page, statusFilter],
    queryFn: () =>
      fetchInterviews({
        status: (statusFilter as 'scheduled' | 'completed' | 'cancelled' | 'no_show') || undefined,
        page,
      }),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interviews"
        description="Scheduled and completed interview rounds for candidates submitted by your agency."
      />

      <div className="flex items-center gap-2 max-w-xs">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All interview statuses' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'no_show', label: 'No show' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data?.length ? (
        <EmptyState
          title="No interviews scheduled yet"
          description="Interviews scheduled for your agency's submitted candidates will appear here."
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Requirement</th>
                  <th>Round &amp; mode</th>
                  <th>Scheduled at</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((iv) => (
                  <tr
                    key={iv.id}
                    onClick={() => setDrawerSubId(iv.submission_id)}
                    className="cursor-pointer"
                  >
                    <td className="font-medium text-[var(--text-primary)]">
                      {iv.submissions?.candidates?.full_name || 'Candidate'}
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      {iv.submissions?.requirements?.title || 'Requirement'}
                    </td>
                    <td className="capitalize text-[var(--text-secondary)]">
                      Round {iv.round_number} · {iv.round_type.replace(/_/g, ' ')} ({iv.mode.replace(/_/g, ' ')})
                    </td>
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatLocalDateTime(iv.scheduled_at)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          iv.status === 'completed'
                            ? 'emerald'
                            : iv.status === 'scheduled'
                              ? 'sky'
                              : 'neutral'
                        }
                      >
                        {iv.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_admin'}
      />
    </div>
  );
};

