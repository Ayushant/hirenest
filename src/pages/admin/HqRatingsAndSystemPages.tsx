import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Drawer,
  Textarea,
} from '../../components/ui/kit';
import { NotEnoughData, ScoreBar } from '../../components/domain/DomainBadges';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import {
  fetchAdminVendorPerformanceRpc,
  fetchInterviewFeedbackList,
  fetchQualityFeedbackList,
  setFeedbackVendorVisibilityRpc,
  fetchRatingDisputes,
  resolveRatingDisputeRpc,
} from '../../api/interviews';
import {
  fetchPlatformSettings,
  updatePlatformSettings,
  fetchAuditLogs,
} from '../../api/admin';
import { mapSupabaseError } from '../../lib/errors';
import { formatLocalDateTime } from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  AdminVendorPerformanceRow,
  AuditLog,
  RatingDispute,
} from '../../types/db';

// 1. HQ Vendor Performance Leaderboard Page
export const HqVendorPerformancePage: React.FC = () => {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedRow, setSelectedRow] = useState<AdminVendorPerformanceRow | null>(null);

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['admin_vendor_performance', page],
    queryFn: () =>
      fetchAdminVendorPerformanceRpc({
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });

  return (
    <div>
      <PageHeader
        title="Vendor performance"
        description="Three-pillar vendor evaluation: submission timing, candidate quality, and process compliance."
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No vendor performance records yet"
          description="Approved vendor agencies appear here as requirements are shared and submissions are evaluated."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Vendor agency</th>
                  <th>Timing</th>
                  <th className="text-right">Resp / turnaround</th>
                  <th className="text-right">SLA 90d</th>
                  <th>Quality</th>
                  <th>Compliance</th>
                  <th>Composite</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const m = row.metrics;
                  const minSample = m?.min_sample_size ?? 5;
                  return (
                    <tr
                      key={row.vendor_org_id}
                      onClick={() => setSelectedRow(row)}
                      className="cursor-pointer"
                    >
                      <td className="font-medium text-[var(--text-primary)]">
                        {row.vendor_name}
                      </td>
                      <td>
                        {m?.timing?.status === 'not_enough_data' ||
                        m?.timing?.score === null ? (
                          <NotEnoughData
                            sampleCount={m?.timing?.evaluable_shares}
                            minSampleSize={minSample}
                          />
                        ) : (
                          <ScoreBar score={m?.timing?.score} size="sm" />
                        )}
                      </td>
                      <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                        {m?.timing?.avg_response_hours !== null &&
                        m?.timing?.avg_response_hours !== undefined
                          ? `${m.timing.avg_response_hours}h`
                          : '-'}{' '}
                        /{' '}
                        {m?.timing?.avg_turnaround_hours !== null &&
                        m?.timing?.avg_turnaround_hours !== undefined
                          ? `${m.timing.avg_turnaround_hours}h`
                          : '-'}
                      </td>
                      <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                        {m?.timing?.sla_compliance_90d_pct !== null &&
                        m?.timing?.sla_compliance_90d_pct !== undefined
                          ? `${m.timing.sla_compliance_90d_pct}%`
                          : 'Not enough data'}
                      </td>
                      <td>
                        {m?.quality?.status === 'not_enough_data' ||
                        m?.quality?.score === null ? (
                          <NotEnoughData
                            sampleCount={m?.quality?.rated_submissions}
                            minSampleSize={minSample}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <ScoreBar score={m?.quality?.score} size="sm" />
                            <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                              ({m.quality.avg_rating_1_to_5 ?? '-'}/5)
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {m?.compliance?.status === 'not_enough_data' ||
                        m?.compliance?.score === null ? (
                          <NotEnoughData
                            sampleCount={m?.compliance?.submissions}
                            minSampleSize={minSample}
                          />
                        ) : (
                          <ScoreBar score={m?.compliance?.score} size="sm" />
                        )}
                      </td>
                      <td>
                        {m?.overall?.status === 'weights_not_approved' ? (
                          <Badge tone="warning">Weights not approved</Badge>
                        ) : m?.overall?.status === 'not_enough_data' ||
                          m?.overall?.score === null ? (
                          <span className="text-[13px] text-[var(--text-secondary)]">
                            Not enough data
                          </span>
                        ) : (
                          <ScoreBar score={m?.overall?.score} size="sm" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] py-3 text-[12px] text-[var(--text-secondary)]">
            <span className="font-mono tabular-nums">Page {page}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={data.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(selectedRow)}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `${selectedRow.vendor_name}` : ''}
        subtitle="Three-pillar metrics and 6-dimension candidate quality breakdown"
      >
        {selectedRow && <VendorPerformancePanel performance={selectedRow.metrics} />}
      </Drawer>
    </div>
  );
};

// 2. Admin Feedback Moderation Page (set_feedback_vendor_visibility)
export const AdminFeedbackModerationPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'interview' | 'quality'>('interview');
  const [page, setPage] = useState(1);

  const { data: interviewFbData, isLoading: loadingIv } = useQuery({
    queryKey: ['moderation_interview_feedback', page],
    queryFn: () => fetchInterviewFeedbackList({ page }),
    enabled: activeTab === 'interview',
  });

  const { data: qualityFbData, isLoading: loadingQual } = useQuery({
    queryKey: ['moderation_quality_feedback', page],
    queryFn: () => fetchQualityFeedbackList({ page }),
    enabled: activeTab === 'quality',
  });

  const handleToggleVisibility = async (
    kind: 'interview' | 'quality',
    feedbackId: string,
    nextVisible: boolean
  ) => {
    try {
      await setFeedbackVendorVisibilityRpc({
        p_kind: kind,
        p_feedback_id: feedbackId,
        p_visible: nextVisible,
      });
      toast({
        title: nextVisible
          ? 'Feedback approved for vendor visibility'
          : 'Vendor visibility revoked',
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['moderation_interview_feedback'] });
      queryClient.invalidateQueries({ queryKey: ['moderation_quality_feedback'] });
    } catch (err) {
      toast({
        title: 'Could not change visibility',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Feedback moderation"
        description="Client feedback is never shared with vendors automatically. Enable visibility per item."
      />

      <div className="mb-4">
        <Tabs
          tabs={[
            { id: 'interview', label: 'Interview feedback' },
            { id: 'quality', label: 'Candidate quality (6D)' },
          ]}
          activeTab={activeTab}
          onChange={(id) => {
            setActiveTab(id as 'interview' | 'quality');
            setPage(1);
          }}
        />
      </div>

      {activeTab === 'interview' ? (
        loadingIv ? (
          <TableSkeleton rows={5} cols={6} />
        ) : !interviewFbData?.data.length ? (
          <EmptyState
            title="No interview feedback submitted yet"
            description="Completed interview ratings appear here for vendor-sharing moderation."
          />
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Candidate & requirement</th>
                    <th>Ratings (S / C / O)</th>
                    <th>Decision</th>
                    <th>Feedback & evidence</th>
                    <th>Standing</th>
                    <th className="text-right">Vendor visibility</th>
                  </tr>
                </thead>
                <tbody>
                  {interviewFbData.data.map((fb) => (
                    <tr key={fb.id}>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {fb.interviews?.submissions?.candidates?.full_name || 'Candidate'}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {fb.interviews?.submissions?.requirements?.title || 'Requirement'}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {fb.skill_rating}/5 · {fb.communication_rating}/5 ·{' '}
                        <span className="text-[var(--text-primary)] font-medium">
                          {fb.overall_rating}/5
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            fb.decision === 'advance'
                              ? 'success'
                              : fb.decision === 'reject'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {fb.decision}
                        </Badge>
                      </td>
                      <td className="max-w-md">
                        <p className="text-[13px] text-[var(--text-primary)] truncate">
                          {fb.feedback}
                        </p>
                        {fb.evidence && (
                          <p className="text-[12px] text-[var(--text-tertiary)] truncate">
                            Evidence: {fb.evidence}
                          </p>
                        )}
                      </td>
                      <td>
                        {fb.excluded_from_score ? (
                          <Badge tone="danger">Excluded</Badge>
                        ) : (
                          <Badge tone="success">Included</Badge>
                        )}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant={fb.visible_to_vendor ? 'primary' : 'outline'}
                          onClick={() =>
                            handleToggleVisibility(
                              'interview',
                              fb.id,
                              !fb.visible_to_vendor
                            )
                          }
                        >
                          {fb.visible_to_vendor ? 'Shared with vendor' : 'Share with vendor'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalCount={interviewFbData.count}
              onPageChange={setPage}
            />
          </div>
        )
      ) : loadingQual ? (
        <TableSkeleton rows={5} cols={5} />
      ) : !qualityFbData?.data.length ? (
        <EmptyState
          title="No candidate quality ratings submitted yet"
          description="Client 6-dimension candidate quality ratings appear here."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Candidate & requirement</th>
                  <th>Suitability & 6D scores</th>
                  <th>Comments</th>
                  <th>Standing</th>
                  <th className="text-right">Vendor visibility</th>
                </tr>
              </thead>
              <tbody>
                {qualityFbData.data.map((qf) => (
                  <tr key={qf.id}>
                    <td>
                      <div className="font-medium text-[var(--text-primary)]">
                        {qf.submissions?.candidates?.full_name || 'Candidate'}
                      </div>
                      <div className="text-[12px] text-[var(--text-secondary)]">
                        {qf.submissions?.requirements?.title || 'Requirement'}
                      </div>
                    </td>
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      <div>
                        Suitability:{' '}
                        <span className="text-[var(--text-primary)] font-medium">
                          {qf.overall_suitability}/5
                        </span>
                      </div>
                      <div className="text-[12px] text-[var(--text-tertiary)]">
                        JD:{qf.jd_skill_alignment} · Exp:{qf.relevant_experience} · Res:
                        {qf.resume_accuracy} · Comm:{qf.communication} · Ready:
                        {qf.interview_readiness}
                      </div>
                    </td>
                    <td className="max-w-md text-[var(--text-secondary)] truncate">
                      {qf.comments || '-'}
                    </td>
                    <td>
                      {qf.excluded_from_score ? (
                        <Badge tone="danger">Excluded</Badge>
                      ) : (
                        <Badge tone="success">Included</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant={qf.visible_to_vendor ? 'primary' : 'outline'}
                        onClick={() =>
                          handleToggleVisibility('quality', qf.id, !qf.visible_to_vendor)
                        }
                      >
                        {qf.visible_to_vendor ? 'Shared with vendor' : 'Share with vendor'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalCount={qualityFbData.count}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
};

// 3. Admin Disputes Page (resolve_rating_dispute: Uphold excludes from score, or Reject)
export const AdminDisputesPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'open' | 'upheld' | 'rejected' | ''>(
    'open'
  );
  const [selectedDispute, setSelectedDispute] = useState<RatingDispute | null>(null);
  const [upheldChoice, setUpheldChoice] = useState<boolean>(true);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rating_disputes', page, statusFilter],
    queryFn: () => fetchRatingDisputes({ page, status: statusFilter }),
  });

  const handleResolve = async () => {
    if (!selectedDispute || !resolutionNote.trim()) return;
    setResolving(true);
    try {
      await resolveRatingDisputeRpc({
        p_dispute_id: selectedDispute.id,
        p_upheld: upheldChoice,
        p_note: resolutionNote.trim(),
      });
      toast({
        title: upheldChoice
          ? 'Dispute upheld (feedback excluded from vendor score)'
          : 'Dispute rejected',
        tone: 'success',
      });
      setSelectedDispute(null);
      setResolutionNote('');
      queryClient.invalidateQueries({ queryKey: ['rating_disputes'] });
      queryClient.invalidateQueries({ queryKey: ['admin_dashboard_summary'] });
    } catch (err) {
      toast({
        title: 'Could not resolve dispute',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setResolving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Rating disputes"
        description="Review vendor rating disputes alongside original feedback. Upheld disputes exclude the rating from vendor scores."
      />

      <div className="mb-4 max-w-xs">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as 'open' | 'upheld' | 'rejected' | '');
            setPage(1);
          }}
          options={[
            { value: 'open', label: 'Open disputes' },
            { value: 'upheld', label: 'Upheld' },
            { value: 'rejected', label: 'Rejected' },
            { value: '', label: 'All disputes' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No rating disputes in this view"
          description="Vendor disputes raised on shared feedback appear here."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Vendor agency</th>
                  <th>Feedback kind & ID</th>
                  <th>Vendor reason</th>
                  <th>Status</th>
                  <th>Raised</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium text-[var(--text-primary)]">
                      {d.organizations?.name || d.vendor_org_id}
                    </td>
                    <td>
                      <span className="capitalize text-[var(--text-primary)]">
                        {d.feedback_kind}
                      </span>
                      <div className="font-mono text-[12px] text-[var(--text-tertiary)]">
                        {d.feedback_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="max-w-md text-[var(--text-secondary)]">{d.reason}</td>
                    <td>
                      <Badge
                        tone={
                          d.status === 'open'
                            ? 'warning'
                            : d.status === 'upheld'
                              ? 'success'
                              : 'danger'
                        }
                      >
                        {d.status}
                      </Badge>
                    </td>
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatLocalDateTime(d.created_at)}
                    </td>
                    <td className="text-right">
                      {d.status === 'open' ? (
                        <div className="inline-flex gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedDispute(d);
                              setUpheldChoice(true);
                              setResolutionNote('');
                            }}
                          >
                            Uphold
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setSelectedDispute(d);
                              setUpheldChoice(false);
                              setResolutionNote('');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          {d.resolution_note}
                        </span>
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

      <Dialog
        open={Boolean(selectedDispute)}
        onClose={() => setSelectedDispute(null)}
        title={upheldChoice ? 'Uphold rating dispute' : 'Reject rating dispute'}
        description={
          upheldChoice
            ? 'Upheld disputes mark excluded_from_score = true on the feedback item and recompute vendor standing.'
            : 'Rejecting keeps the feedback item in the vendor score calculation.'
        }
      >
        {selectedDispute && (
          <div className="space-y-4">
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[13px] space-y-1">
              <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                Vendor dispute statement
              </div>
              <p className="text-[var(--text-primary)]">{selectedDispute.reason}</p>
            </div>
            <Textarea
              label="Resolution note"
              rows={3}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Explain the decision..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectedDispute(null)}>
                Cancel
              </Button>
              <Button
                variant={upheldChoice ? 'primary' : 'danger'}
                onClick={handleResolve}
                loading={resolving}
                disabled={!resolutionNote.trim()}
              >
                {upheldChoice ? 'Confirm uphold' : 'Confirm reject'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

// 4. Admin Settings & Score Weights Page (platform_settings id = 1)
export const AdminSettingsPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'weights' | 'governance'>('weights');

  const { data: settings, isLoading, error, refetch } = useQuery({
    queryKey: ['platform_settings'],
    queryFn: fetchPlatformSettings,
  });

  const [timingWeight, setTimingWeight] = useState(30);
  const [qualityWeight, setQualityWeight] = useState(50);
  const [complianceWeight, setComplianceWeight] = useState(20);
  const [weightsApproved, setWeightsApproved] = useState(false);
  const [minSampleSize, setMinSampleSize] = useState(5);
  const [defaultSlaHours, setDefaultSlaHours] = useState(48);
  const [shareVendorSummary, setShareVendorSummary] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setTimingWeight(settings.timing_weight);
      setQualityWeight(settings.quality_weight);
      setComplianceWeight(settings.compliance_weight);
      setWeightsApproved(settings.weights_approved);
      setMinSampleSize(settings.min_sample_size);
      setDefaultSlaHours(settings.default_submission_sla_hours);
      setShareVendorSummary(settings.share_vendor_summary_with_clients);
    }
  }, [settings]);

  const weightSum =
    Number(timingWeight || 0) +
    Number(qualityWeight || 0) +
    Number(complianceWeight || 0);
  const sumValid = weightSum === 100;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sumValid) {
      toast({
        title: 'Invalid weights',
        description: 'Timing, Quality, and Compliance weights must sum to 100.',
        tone: 'error',
      });
      return;
    }
    setSaving(true);
    try {
      await updatePlatformSettings({
        timing_weight: Number(timingWeight),
        quality_weight: Number(qualityWeight),
        compliance_weight: Number(complianceWeight),
        weights_approved: weightsApproved,
        min_sample_size: Number(minSampleSize),
        default_submission_sla_hours: Number(defaultSlaHours),
        share_vendor_summary_with_clients: shareVendorSummary,
      });
      toast({
        title: 'Platform settings updated',
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['platform_settings'] });
    } catch (err) {
      toast({
        title: 'Could not save settings',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <TableSkeleton rows={4} cols={3} />;
  if (error) return <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader
        title="Platform settings"
        description="Configure composite vendor scoring weights, SLA thresholds, and architecture governance."
      />

      <div className="mb-6">
        <Tabs
          tabs={[
            { id: 'weights', label: 'Score weights & SLA thresholds' },
            { id: 'governance', label: 'Architecture decisions & AI inventory' },
          ]}
          activeTab={activeTab}
          onChange={(t) => setActiveTab(t as 'weights' | 'governance')}
        />
      </div>

      {activeTab === 'weights' ? (
        <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
          <div className="space-y-4 pb-6 border-b border-[var(--border)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                Composite vendor score weights
              </h3>
              <Badge tone={sumValid ? 'success' : 'danger'}>
                Sum: {weightSum} / 100
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Timing weight (%)"
                type="number"
                min={0}
                max={100}
                value={timingWeight}
                onChange={(e) => setTimingWeight(Number(e.target.value))}
              />
              <Input
                label="Quality weight (%)"
                type="number"
                min={0}
                max={100}
                value={qualityWeight}
                onChange={(e) => setQualityWeight(Number(e.target.value))}
              />
              <Input
                label="Compliance weight (%)"
                type="number"
                min={0}
                max={100}
                value={complianceWeight}
                onChange={(e) => setComplianceWeight(Number(e.target.value))}
              />
            </div>

            {!sumValid && (
              <p className="text-[12px] text-[var(--status-danger)]">
                Weights currently sum to {weightSum}. Adjust them to equal 100 before saving.
              </p>
            )}

            <div className="pt-2 space-y-1.5">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={weightsApproved}
                  onChange={(e) => setWeightsApproved(e.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-[var(--border-strong)] accent-[var(--accent)]"
                />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  Approve composite score weights
                </span>
              </label>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Composite vendor scores remain hidden until weights are approved.
              </p>
            </div>
          </div>

          <div className="space-y-4 pb-6 border-b border-[var(--border)]">
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              SLA & sampling thresholds
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Minimum sample size"
                type="number"
                min={1}
                value={minSampleSize}
                onChange={(e) => setMinSampleSize(Number(e.target.value))}
                hint="Minimum evaluable shares or submissions before a score is displayed"
              />
              <Input
                label="Default submission SLA (hours)"
                type="number"
                min={1}
                value={defaultSlaHours}
                onChange={(e) => setDefaultSlaHours(Number(e.target.value))}
              />
            </div>

            <div className="pt-2 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shareVendorSummary}
                  onChange={(e) => setShareVendorSummary(e.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-[var(--border-strong)] accent-[var(--accent)]"
                />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  Share vendor summary with clients
                </span>
              </label>

              <div
                title="Requires Ollama service, Phase 2"
                className="flex items-center justify-between rounded-[6px] border border-dashed border-[var(--border-strong)] p-3"
              >
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Autonomous AI screening interviews
                  </div>
                  <div className="text-[12px] text-[var(--text-tertiary)]">
                    Provider: {settings?.ai_provider || 'ollama'} · Structured screening runner active via interviews + interview_feedback
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled
                  checked={Boolean(settings?.ai_screening_enabled)}
                  title="Requires Ollama service, Phase 2"
                  className="h-4 w-4 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!sumValid}>
              Save settings
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-8">
          <div>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] mb-3">
              Resolved architecture decisions
            </h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Resolution</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-medium text-[var(--text-primary)]">1. AI provider policy</td>
                    <td className="text-[var(--text-secondary)]">
                      Matching and vendor scoring are deterministic in PostgreSQL (<code className="font-mono">candidate_matches</code>). Optional suggestions run through <code className="font-mono">/api/gemini/suggest</code> with JWT verification, PII stripping, 20 req/hr limit, and offline fallback.
                    </td>
                    <td><Badge tone="success">Enforced</Badge></td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[var(--text-primary)]">2. Direct-candidate schema</td>
                    <td className="text-[var(--text-secondary)]">
                      Direct candidates use <code className="font-mono">original_source = &apos;direct&apos;</code>, <code className="font-mono">source_vendor_org_id = null</code>, <code className="font-mono">owner_vendor_org_id = null</code>, and <code className="font-mono">submissions.vendor_org_id = null</code> via <code className="font-mono">apply_to_requirement</code>.
                    </td>
                    <td><Badge tone="success">Enforced</Badge></td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[var(--text-primary)]">3. Match data canonical source</td>
                    <td className="text-[var(--text-secondary)]">
                      Single canonical <code className="font-mono">public.candidate_matches</code> table backs both <code className="font-mono">Requirement → Candidates</code> and <code className="font-mono">Candidate → Requirements</code> with <code className="font-mono">recompute_matches</code> and <code className="font-mono">override_match</code>.
                    </td>
                    <td><Badge tone="success">Enforced</Badge></td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[var(--text-primary)]">4. Screening interview runner</td>
                    <td className="text-[var(--text-secondary)]">
                      Captures real responses in declared modality (<code className="font-mono">ai_text | video | phone | in_person</code>), separates JD skill vs communication ratings, and persists into <code className="font-mono">interviews</code> + <code className="font-mono">interview_feedback</code>.
                    </td>
                    <td><Badge tone="success">Enforced</Badge></td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[var(--text-primary)]">5. Status vocabulary</td>
                    <td className="text-[var(--text-secondary)]">
                      Canonical <code className="font-mono">submission_stage</code> enum preserved. UI distinguishes unsubmitted matches (<code className="font-mono">Potential match</code>), direct applications (<code className="font-mono">Direct</code>), and agency submissions (<code className="font-mono">Vendor · Name</code>).
                    </td>
                    <td><Badge tone="success">Enforced</Badge></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] mb-3">
              AI call-site inventory (<code className="font-mono text-[14px]">/api/gemini/suggest</code>)
            </h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Component</th>
                    <th>Allowed structured payload</th>
                    <th>Write policy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-mono text-[var(--text-primary)]">suggest_skills</td>
                    <td>RequirementFormModal.tsx</td>
                    <td className="text-[var(--text-secondary)]">Requirement title + JD text (PII scrubbed)</td>
                    <td className="text-[var(--text-secondary)]">Suggestion only; user clicks Use</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-[var(--text-primary)]">improve_jd</td>
                    <td>RequirementFormModal.tsx</td>
                    <td className="text-[var(--text-secondary)]">Requirement title + JD text + skills[]</td>
                    <td className="text-[var(--text-secondary)]">Suggestion only; user clicks Use</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-[var(--text-primary)]">suggest_interview_questions</td>
                    <td>InterviewModals.tsx</td>
                    <td className="text-[var(--text-secondary)]">JD title/skills + candidate skills[], exp_years, current_title</td>
                    <td className="text-[var(--text-secondary)]">Suggestion only; never scores candidate</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-[var(--text-primary)]">tidy_feedback_notes</td>
                    <td>InterviewModals.tsx</td>
                    <td className="text-[var(--text-secondary)]">User-typed draft notes only (no DB records)</td>
                    <td className="text-[var(--text-secondary)]">Suggestion only; user clicks Use</td>
                  </tr>
                  <tr>
                    <td className="font-mono text-[var(--text-primary)]">general_chat</td>
                    <td>AiAssistantDrawer.tsx</td>
                    <td className="text-[var(--text-secondary)]">User question text only (no candidate records)</td>
                    <td className="text-[var(--text-secondary)]">Read-only assistant drawer</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 5. Admin Audit Log Page (paginated, filter by table/action/actor/date, JSON diff viewer)
export const AdminAuditLogsPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit_logs', page, tableName, action, actorId, fromDate],
    queryFn: () =>
      fetchAuditLogs({
        page,
        tableName: tableName || undefined,
        action: action || undefined,
        actorId: actorId.trim() || undefined,
        fromDate: fromDate || undefined,
      }),
  });

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Immutable database audit trail across tables, actions, and actors."
      />

      <div className="mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Input
          placeholder="Table name (e.g. requirements)..."
          value={tableName}
          onChange={(e) => {
            setTableName(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All actions' },
            { value: 'INSERT', label: 'INSERT' },
            { value: 'UPDATE', label: 'UPDATE' },
            { value: 'DELETE', label: 'DELETE' },
          ]}
        />
        <Input
          placeholder="Actor UUID..."
          value={actorId}
          onChange={(e) => {
            setActorId(e.target.value);
            setPage(1);
          }}
        />
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No audit log entries match filters"
          description="Database mutations are automatically logged by triggers."
        />
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Table</th>
                  <th>Action</th>
                  <th>Record ID</th>
                  <th>Actor</th>
                  <th className="text-right">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="cursor-pointer"
                  >
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatLocalDateTime(log.created_at)}
                    </td>
                    <td className="font-mono text-[var(--text-primary)]">{log.table_name}</td>
                    <td>
                      <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {log.action}
                      </span>
                    </td>
                    <td className="font-mono text-[12px] text-[var(--text-tertiary)]">
                      {log.record_id ? log.record_id.slice(0, 8) : '-'}
                    </td>
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {log.actor_role || 'system'}{' '}
                      {log.actor_id ? `(${log.actor_id.slice(0, 8)})` : ''}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost">
                        Diff
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <Dialog
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Audit log record diff"
        description={
          selectedLog
            ? `${selectedLog.table_name} · ${selectedLog.action} · ${formatLocalDateTime(
                selectedLog.created_at
              )}`
            : ''
        }
        maxWidth="max-w-2xl"
      >
        {selectedLog && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]">
            <div>
              <div className="font-medium text-[var(--text-secondary)] mb-1.5">
                Previous state (old_data)
              </div>
              <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] p-3 font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(selectedLog.old_data, null, 2) || 'null'}
              </pre>
            </div>
            <div>
              <div className="font-medium text-[var(--text-secondary)] mb-1.5">
                New state (new_data)
              </div>
              <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] p-3 font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(selectedLog.new_data, null, 2) || 'null'}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
