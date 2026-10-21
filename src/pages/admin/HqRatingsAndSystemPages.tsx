import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, Scale, Check, X } from 'lucide-react';
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
    <div className="space-y-6">
      <PageHeader
        title="Vendor Performance"
        description="Governed three-pillar vendor evaluation: Submission Timing (SLA), Candidate Quality, and Process Compliance."
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No vendor performance records yet"
          description="Approved vendor agencies will appear here as requirements are shared and submissions are evaluated."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Vendor Agency</th>
                  <th className="py-3 px-4">Timing Score</th>
                  <th className="py-3 px-4 text-right">Avg Resp / Turnaround</th>
                  <th className="py-3 px-4 text-right">SLA 90d</th>
                  <th className="py-3 px-4">Quality Score (Avg 1–5)</th>
                  <th className="py-3 px-4">Compliance Score</th>
                  <th className="py-3 px-4">Overall Standing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.map((row) => {
                  const m = row.metrics;
                  const minSample = m?.min_sample_size ?? 5;
                  return (
                    <tr
                      key={row.vendor_org_id}
                      onClick={() => setSelectedRow(row)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {row.vendor_name}
                      </td>
                      <td className="py-3.5 px-4">
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
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {m?.timing?.avg_response_hours !== null &&
                        m?.timing?.avg_response_hours !== undefined
                          ? `${m.timing.avg_response_hours}h`
                          : '—'}{' '}
                        /{' '}
                        {m?.timing?.avg_turnaround_hours !== null &&
                        m?.timing?.avg_turnaround_hours !== undefined
                          ? `${m.timing.avg_turnaround_hours}h`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                        {m?.timing?.sla_compliance_90d_pct !== null &&
                        m?.timing?.sla_compliance_90d_pct !== undefined
                          ? `${m.timing.sla_compliance_90d_pct}%`
                          : 'Not enough data'}
                      </td>
                      <td className="py-3.5 px-4">
                        {m?.quality?.status === 'not_enough_data' ||
                        m?.quality?.score === null ? (
                          <NotEnoughData
                            sampleCount={m?.quality?.rated_submissions}
                            minSampleSize={minSample}
                          />
                        ) : (
                          <div className="space-y-0.5">
                            <ScoreBar score={m?.quality?.score} size="sm" />
                            <span className="text-[10px] font-mono text-slate-500">
                              Avg: {m.quality.avg_rating_1_to_5 ?? '—'}/5
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
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
                      <td className="py-3.5 px-4">
                        {m?.overall?.status === 'weights_not_approved' ? (
                          <Badge tone="amber">Weights not approved</Badge>
                        ) : m?.overall?.status === 'not_enough_data' ||
                          m?.overall?.score === null ? (
                          <Badge tone="slate">Not enough data</Badge>
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
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3 text-xs">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={data.length < pageSize}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Detail Drawer with the Six Quality Dimensions as Bars */}
      <Drawer
        open={Boolean(selectedRow)}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `Vendor Performance · ${selectedRow.vendor_name}` : ''}
        subtitle="Three-pillar metrics and 6-dimension candidate quality breakdown"
        widthClass="max-w-3xl"
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
    <div className="space-y-6">
      <PageHeader
        title="Feedback Moderation"
        description="Review client interview and candidate quality ratings and explicitly approve vendor visibility."
      />

      <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 flex items-center gap-3 text-xs text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <span>
          <strong>Governance Notice:</strong> Client feedback is never shared with vendors
          automatically. Vendors only see feedback items where HireNest Admin has explicitly
          enabled &ldquo;Share with vendor&rdquo;.
        </span>
      </div>

      <Tabs
        tabs={[
          { id: 'interview', label: 'Interview Round Feedback' },
          { id: 'quality', label: 'Candidate Quality Feedback (6D)' },
        ]}
        activeTab={activeTab}
        onChange={(id) => {
          setActiveTab(id as 'interview' | 'quality');
          setPage(1);
        }}
      />

      {activeTab === 'interview' ? (
        loadingIv ? (
          <TableSkeleton rows={5} cols={6} />
        ) : !interviewFbData?.data.length ? (
          <EmptyState
            title="No interview feedback submitted yet"
            description="Completed interview ratings will appear here for vendor-sharing moderation."
          />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Candidate & Requirement</th>
                  <th className="py-3 px-4">Ratings (S / C / O)</th>
                  <th className="py-3 px-4">Decision</th>
                  <th className="py-3 px-4">Feedback & Evidence</th>
                  <th className="py-3 px-4">Score Status</th>
                  <th className="py-3 px-4 text-right">Share with Vendor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {interviewFbData.data.map((fb) => (
                  <tr key={fb.id}>
                    <td className="py-3 px-4">
                      <div className="font-semibold">
                        {fb.interviews?.submissions?.candidates?.full_name || 'Candidate'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {fb.interviews?.submissions?.requirements?.title || 'Requirement'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {fb.skill_rating}/5 · {fb.communication_rating}/5 ·{' '}
                      <strong>{fb.overall_rating}/5</strong>
                    </td>
                    <td className="py-3 px-4">
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
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <p className="text-slate-800 dark:text-slate-200">{fb.feedback}</p>
                      {fb.evidence && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Evidence: {fb.evidence}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {fb.excluded_from_score ? (
                        <Badge tone="red">Excluded (Dispute Upheld)</Badge>
                      ) : (
                        <Badge tone="emerald">Included</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
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
                        <Eye className="h-3.5 w-3.5" />
                        {fb.visible_to_vendor ? 'Shared with Vendor' : 'Share with Vendor'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalCount={interviewFbData.count}
              onPageChange={setPage}
            />
          </Card>
        )
      ) : loadingQual ? (
        <TableSkeleton rows={5} cols={6} />
      ) : !qualityFbData?.data.length ? (
        <EmptyState
          title="No candidate quality ratings submitted yet"
          description="Client 6-dimension candidate quality ratings will appear here."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Candidate & Requirement</th>
                <th className="py-3 px-4">Suitability & 6D Scores</th>
                <th className="py-3 px-4">Comments</th>
                <th className="py-3 px-4">Score Status</th>
                <th className="py-3 px-4 text-right">Share with Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {qualityFbData.data.map((qf) => (
                <tr key={qf.id}>
                  <td className="py-3 px-4">
                    <div className="font-semibold">
                      {qf.submissions?.candidates?.full_name || 'Candidate'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {qf.submissions?.requirements?.title || 'Requirement'}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    <div>
                      Overall Suitability: <strong>{qf.overall_suitability}/5</strong>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      JD:{qf.jd_skill_alignment} · Exp:{qf.relevant_experience} · Res:
                      {qf.resume_accuracy} · Comm:{qf.communication} · Ready:
                      {qf.interview_readiness}
                    </div>
                  </td>
                  <td className="py-3 px-4 max-w-md">{qf.comments || '—'}</td>
                  <td className="py-3 px-4">
                    {qf.excluded_from_score ? (
                      <Badge tone="red">Excluded (Dispute Upheld)</Badge>
                    ) : (
                      <Badge tone="emerald">Included</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant={qf.visible_to_vendor ? 'primary' : 'outline'}
                      onClick={() =>
                        handleToggleVisibility('quality', qf.id, !qf.visible_to_vendor)
                      }
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {qf.visible_to_vendor ? 'Shared with Vendor' : 'Share with Vendor'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            totalCount={qualityFbData.count}
            onPageChange={setPage}
          />
        </Card>
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
    <div className="space-y-6">
      <PageHeader
        title="Rating Disputes"
        description="Review vendor rating disputes alongside original feedback. Upheld disputes exclude the rating from vendor scores."
      />

      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as 'open' | 'upheld' | 'rejected' | '');
            setPage(1);
          }}
          options={[
            { value: 'open', label: 'Open Disputes' },
            { value: 'upheld', label: 'Upheld' },
            { value: 'rejected', label: 'Rejected' },
            { value: '', label: 'All Disputes' },
          ]}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No rating disputes in this view"
          description="Vendor disputes raised on shared feedback will appear here."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Vendor Agency</th>
                <th className="py-3 px-4">Feedback Kind & ID</th>
                <th className="py-3 px-4">Vendor Dispute Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Raised At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((d) => (
                <tr key={d.id}>
                  <td className="py-3 px-4 font-semibold">
                    {d.organizations?.name || d.vendor_org_id}
                  </td>
                  <td className="py-3 px-4">
                    <span className="capitalize font-medium">{d.feedback_kind}</span>
                    <div className="font-mono text-[10px] text-slate-400">
                      {d.feedback_id}
                    </div>
                  </td>
                  <td className="py-3 px-4 max-w-md">{d.reason}</td>
                  <td className="py-3 px-4">
                    <Badge
                      tone={
                        d.status === 'open'
                          ? 'amber'
                          : d.status === 'upheld'
                            ? 'emerald'
                            : 'red'
                      }
                    >
                      {d.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDateTime(d.created_at)}
                  </td>
                  <td className="py-3 px-4 text-right">
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
                          <Check className="h-3.5 w-3.5" />
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
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-slate-500">{d.resolution_note}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <Dialog
        open={Boolean(selectedDispute)}
        onClose={() => setSelectedDispute(null)}
        title={upheldChoice ? 'Uphold Rating Dispute' : 'Reject Rating Dispute'}
        description={
          upheldChoice
            ? 'Upheld disputes mark excluded_from_score = true on the feedback item and recompute vendor standing.'
            : 'Rejecting keeps the feedback item in the vendor score calculation.'
        }
      >
        {selectedDispute && (
          <div className="space-y-4">
            <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs space-y-1">
              <div className="font-semibold">Vendor Dispute Statement:</div>
              <p className="text-slate-700 dark:text-slate-300">{selectedDispute.reason}</p>
            </div>
            <Textarea
              label="Admin Resolution Note (Required)"
              rows={3}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Explain the governance decision..."
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
                {upheldChoice ? 'Confirm Uphold' : 'Confirm Reject'}
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
        description: 'Timing, Quality, and Compliance weights must sum to exactly 100.',
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
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Platform Settings & Score Weights"
        description="Configure composite vendor scoring weights, minimum sample thresholds, default SLAs, and Phase 2 AI controls."
      />

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-600" />
              Composite Vendor Score Weights (Must Sum to 100)
            </h3>
            <Badge tone={sumValid ? 'emerald' : 'red'}>
              Sum: {weightSum} / 100
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Timing Weight (%)"
              type="number"
              min={0}
              max={100}
              value={timingWeight}
              onChange={(e) => setTimingWeight(Number(e.target.value))}
            />
            <Input
              label="Quality Weight (%)"
              type="number"
              min={0}
              max={100}
              value={qualityWeight}
              onChange={(e) => setQualityWeight(Number(e.target.value))}
            />
            <Input
              label="Compliance Weight (%)"
              type="number"
              min={0}
              max={100}
              value={complianceWeight}
              onChange={(e) => setComplianceWeight(Number(e.target.value))}
            />
          </div>

          {!sumValid && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Weights currently sum to {weightSum}. Adjust them to equal 100 before saving.
            </p>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={weightsApproved}
                onChange={(e) => setWeightsApproved(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
              />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Approve Composite Score Weights
              </span>
            </label>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Warning: Overall vendor scores stay hidden until weights are approved.
            </p>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            SLA & Sampling Thresholds
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Minimum Sample Size (min_sample_size)"
              type="number"
              min={1}
              value={minSampleSize}
              onChange={(e) => setMinSampleSize(Number(e.target.value))}
              hint="Minimum evaluable shares/submissions before a score is displayed"
            />
            <Input
              label="Default Submission SLA (Hours)"
              type="number"
              min={1}
              value={defaultSlaHours}
              onChange={(e) => setDefaultSlaHours(Number(e.target.value))}
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={shareVendorSummary}
                onChange={(e) => setShareVendorSummary(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
              />
              <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                Share Vendor Summary with Clients (share_vendor_summary_with_clients)
              </span>
            </label>

            {/* Disabled switch with "Requires Ollama service, Phase 2" tooltip */}
            <div
              title="Requires Ollama service, Phase 2"
              className="flex items-center justify-between rounded border border-dashed border-slate-300 dark:border-slate-700 p-3 opacity-75"
            >
              <div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Autonomous AI Screening Interviews (ai_screening_enabled)
                </div>
                <div className="text-[11px] text-slate-500">
                  Provider: {settings?.ai_provider || 'ollama'} · Requires Ollama service, Phase 2
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
        </Card>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!sumValid}>
            Save Platform Settings
          </Button>
        </div>
      </form>
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
    <div className="space-y-6">
      <PageHeader
        title="System Audit Log"
        description="Immutable database audit trail across tables, actions, and actors with side-by-side JSON diff inspection."
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
            { value: '', label: 'All Actions' },
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
        <TableSkeleton rows={6} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No audit log entries match filters"
          description="Database mutations are automatically logged by triggers."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Table</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Record ID</th>
                <th className="py-3 px-4">Actor Role / ID</th>
                <th className="py-3 px-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDateTime(log.created_at)}
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold">{log.table_name}</td>
                  <td className="py-3 px-4">
                    <Badge tone="indigo">{log.action}</Badge>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                    {log.record_id}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px]">
                    {log.actor_role || 'system'} {log.actor_id ? `(${log.actor_id.slice(0, 8)}…)` : ''}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button size="sm" variant="outline">
                      JSON Diff
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      {/* JSON Diff Modal */}
      <Dialog
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Audit Log Record Diff"
        description={
          selectedLog
            ? `${selectedLog.table_name} · ${selectedLog.action} · ${formatLocalDateTime(
                selectedLog.created_at
              )}`
            : ''
        }
        maxWidth="max-w-4xl"
      >
        {selectedLog && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Previous State (old_data)
              </h4>
              <pre className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-200 p-3 font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(selectedLog.old_data, null, 2) || 'null'}
              </pre>
            </div>
            <div>
              <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                New State (new_data)
              </h4>
              <pre className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-200 p-3 font-mono text-[11px] overflow-x-auto max-h-96">
                {JSON.stringify(selectedLog.new_data, null, 2) || 'null'}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
