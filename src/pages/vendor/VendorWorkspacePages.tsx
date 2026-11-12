import React, { useState, useMemo } from 'react';
import {
  RequirementRibbon,
  RequirementCategoryFilter,
  matchesRequirementCategory,
  type RequirementCategoryFilterValue,
} from '../../components/domain/RequirementRibbon';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Users, CalendarCheck, Send, CheckCircle, Clock, Star, ShieldCheck } from 'lucide-react';
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
  DashboardSection,
  SinceLastVisit,
} from '../../components/ui/DashboardKit';
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
  fetchStageTransitions,
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

  const { data: orgPlan } = useQuery({
    queryKey: ['vendor_org_plan', profile?.org_id],
    queryFn: async () => {
      const res = await fetch(`/api/subscriptions/org-plan?orgId=${encodeURIComponent(profile!.org_id!)}`);
      if (!res.ok) throw new Error('Failed to fetch plan');
      return res.json() as Promise<{
        ok: boolean; orgId: string; planId: string; planName: string; subscriptionStatus: string;
      }>;
    },
    enabled: Boolean(profile?.org_id),
  });

  const offerMetrics = useMemo(
    () => computeOfferOnboardingMetrics(subsData?.data || [], offerRecordsMap),
    [subsData?.data, offerRecordsMap]
  );

  const submissionIds = useMemo(() => (subsData?.data || []).map((s) => s.id), [subsData?.data]);

  const { data: transitions = [] } = useQuery({
    queryKey: ['vendor-stage-transitions', profile?.org_id, submissionIds.length],
    queryFn: () => fetchStageTransitions(submissionIds),
    enabled: submissionIds.length > 0,
  });

  const avgTimeToHireDays = useMemo(() => {
    const createdAtById = new Map((subsData?.data || []).map((s) => [s.id, s.created_at]));
    const durations = transitions
      .filter((ev) => ev.to_stage === 'onboarded')
      .map((ev) => {
        const createdAt = createdAtById.get(ev.submission_id);
        if (!createdAt) return null;
        const days = (new Date(ev.created_at).getTime() - new Date(createdAt).getTime()) / 86400000;
        return days >= 0 ? days : null;
      })
      .filter((d): d is number => d !== null);
    if (durations.length === 0) return null;
    return { avg: durations.reduce((a, b) => a + b, 0) / durations.length, count: durations.length };
  }, [transitions, subsData?.data]);

  // Average days spent in each stage, from consecutive real stage-history rows.
  const dwellByStage = useMemo(() => {
    const bySub = new Map<string, typeof transitions>();
    for (const t of transitions) {
      const list = bySub.get(t.submission_id) || [];
      list.push(t);
      bySub.set(t.submission_id, list);
    }
    const acc = new Map<string, number[]>();
    for (const list of bySub.values()) {
      for (let i = 0; i < list.length - 1; i++) {
        const days = (new Date(list[i + 1].created_at).getTime() - new Date(list[i].created_at).getTime()) / 86400000;
        if (days < 0) continue;
        const arr = acc.get(list[i].to_stage) || [];
        arr.push(days);
        acc.set(list[i].to_stage, arr);
      }
    }
    const avgOf = (stages: string[]) => {
      const all = stages.flatMap((s) => acc.get(s) || []);
      return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    };
    return {
      shared: avgOf(['applied', 'recruiter_review', 'client_review']),
      interviewing: avgOf(['interviewing']),
      offered: avgOf(['offered']),
      accepted: avgOf(['offer_accepted']),
    };
  }, [transitions]);

  const urgentCount = useMemo(
    () =>
      shares.filter(
        (s) => !s.revoked_at && new Date(s.due_at).getTime() - Date.now() < 24 * 3600 * 1000
      ).length,
    [shares]
  );

  const nextJoining = useMemo(() => {
    const list = offerMetrics.upcomingJoinings;
    if (!list.length) return null;
    return Math.min(...list.map((j) => j.daysUntilJoining));
  }, [offerMetrics]);

  const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : null);
  const fmtDwell = (d: number | null) => (d == null ? '—' : d < 1 ? `${(d * 24).toFixed(0)}h` : `${d.toFixed(1)}d`);

  const allRequirements = reqsData?.data || [];
  const activeShares = shares.filter((s) => !s.revoked_at);
  const unacknowledged = activeShares.filter((s) => !s.acknowledged_at);
  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const submissionFunnel = useMemo(() => [
    { name: 'Shared', value: offerMetrics.candidatesShared, color: '#6A89A7' },
    { name: 'Interviewing', value: interviewsData?.count ?? 0, color: '#4F95DB' },
    { name: 'Offered', value: offerMetrics.offersIssued, color: '#4F46D8' },
    { name: 'Accepted', value: offerMetrics.offersAccepted, color: '#2A9D8F' },
    { name: 'Onboarded', value: offerMetrics.onboardedCandidates, color: '#17734A' },
  ], [offerMetrics, interviewsData]);

  const clientNameByReqId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of allRequirements) {
      if (r.organizations?.name) m.set(r.id, r.organizations.name);
    }
    return m;
  }, [allRequirements]);

  const submissionCountByReqId = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subsData?.data || []) {
      m.set(s.requirement_id, (m.get(s.requirement_id) || 0) + 1);
    }
    return m;
  }, [subsData]);

  const priorityShares = useMemo(() => {
    return [...activeShares]
      .sort((a, b) => {
        if (!a.acknowledged_at && b.acknowledged_at) return -1;
        if (a.acknowledged_at && !b.acknowledged_at) return 1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      })
      .slice(0, 5);
  }, [activeShares]);

  return (
    <div className="space-y-7" style={{ fontFamily: "'Plus Jakarta Sans', var(--font-sans)" }}>
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Good morning, {firstName}</h1>
          <p className="mt-1 text-xs text-slate-500">Shared requirements, SLA countdowns, and agency performance standing.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/vendor/requirements')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            Open requirements pipeline
          </button>
          <button
            type="button"
            onClick={() => navigate('/vendor/requirements')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:opacity-95 active:scale-95"
          >
            <Send className="h-4 w-4" /> New Submission
          </button>
        </div>
      </div>

      {/* Active Plan Banner */}
      {orgPlan && orgPlan.planId !== 'free_trial' && (
        <div className="rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-3.5 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-[var(--accent)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
              {orgPlan.planName} Plan — Active
            </p>
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
              Your organisation is on the {orgPlan.planName} plan. Contact your HireNest admin to manage or upgrade.
            </p>
          </div>
        </div>
      )}

      <SinceLastVisit
        items={[
          { label: 'new shares', count: unacknowledged.length },
          { label: 'submissions', count: offerMetrics.candidatesShared },
          { label: 'interviews', count: interviewsData?.count ?? 0 },
        ]}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Shared', value: offerMetrics.candidatesShared, icon: <Send className="w-[18px] h-[18px]" />, tile: 'bg-violet-50 text-violet-600', hover: 'hover:border-violet-300',
            hint: `${subsData?.count ?? 0} total submissions`, hintTone: 'text-slate-500', to: '/vendor/submissions' },
          { label: 'Offers issued', value: offerMetrics.offersIssued, icon: <Briefcase className="w-[18px] h-[18px]" />, tile: 'bg-blue-50 text-blue-600', hover: 'hover:border-blue-300',
            hint: pct(offerMetrics.offersIssued, offerMetrics.candidatesShared) ? `${pct(offerMetrics.offersIssued, offerMetrics.candidatesShared)} of shared` : undefined, hintTone: 'text-slate-500', to: '/vendor/offers' },
          { label: 'Accepted', value: offerMetrics.offersAccepted, icon: <CheckCircle className="w-[18px] h-[18px]" />, tile: 'bg-emerald-50 text-emerald-600', hover: 'hover:border-emerald-300',
            hint: pct(offerMetrics.offersAccepted, offerMetrics.offersIssued) ? `${pct(offerMetrics.offersAccepted, offerMetrics.offersIssued)} of offers` : undefined, hintTone: 'text-emerald-600', to: '/vendor/offers' },
          { label: 'Pending', value: offerMetrics.pendingOffers, icon: <Clock className="w-[18px] h-[18px]" />, tile: 'bg-amber-50 text-amber-600', hover: 'hover:border-amber-300',
            hint: 'Awaiting candidate response', hintTone: 'text-amber-700', to: '/vendor/offers' },
          { label: 'Onboarded', value: offerMetrics.onboardedCandidates, icon: <ShieldCheck className="w-[18px] h-[18px]" />, tile: 'bg-cyan-50 text-cyan-600', hover: 'hover:border-cyan-300',
            hint: pct(offerMetrics.onboardedCandidates, offerMetrics.offersAccepted) ? `${pct(offerMetrics.onboardedCandidates, offerMetrics.offersAccepted)} of accepted` : undefined, hintTone: 'text-cyan-700', to: '/vendor/onboarded' },
          { label: 'Upcoming joinings', value: offerMetrics.upcomingJoiningsCount, icon: <CalendarCheck className="w-[18px] h-[18px]" />, tile: 'bg-indigo-50 text-indigo-600', hover: 'hover:border-indigo-300',
            hint: nextJoining != null ? (nextJoining <= 0 ? 'Next: today' : `Next in ${nextJoining}d`) : undefined, hintTone: 'text-indigo-600', to: '/vendor/onboarded' },
        ].map((k) => (
          <div
            key={k.label}
            role="button"
            tabIndex={0}
            onClick={() => navigate(k.to)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(k.to); }}
            className={`cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all ${k.hover} group flex flex-col justify-between`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-['Public_Sans'] text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k.label}</span>
              <div className={`h-8 w-8 shrink-0 rounded-lg ${k.tile} flex items-center justify-center transition-transform group-hover:scale-105`}>{k.icon}</div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900">{k.value}</div>
              <div className={`mt-1 h-4 truncate font-mono text-[11px] font-medium ${k.hintTone}`}>{k.hint ?? ''}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline & funnel velocity */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-slate-900">Candidate Submission Pipeline &amp; Funnel Velocity</h2>
              <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-medium text-indigo-700">All time</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Stage counts, conversion between stages, and average time spent per stage.</p>
          </div>
          <div className="flex items-center gap-4 rounded-lg border border-slate-200/80 bg-slate-50 px-4 py-2">
            <div className="text-right">
              <p className="font-['Public_Sans'] text-[10px] font-semibold uppercase tracking-wider text-slate-400">Shared → onboarded</p>
              <p className="text-sm font-bold text-slate-900">{pct(offerMetrics.onboardedCandidates, offerMetrics.candidatesShared) ?? '—'}</p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-right">
              <p className="font-['Public_Sans'] text-[10px] font-semibold uppercase tracking-wider text-slate-400">Avg time to hire</p>
              <p className="font-mono text-sm font-bold text-slate-900">{avgTimeToHireDays ? `${avgTimeToHireDays.avg.toFixed(1)} Days` : '—'}</p>
            </div>
          </div>
        </div>

        {(() => {
          const total = submissionFunnel.reduce((a, f) => a + f.value, 0);
          const colors = ['bg-violet-500', 'bg-indigo-500', 'bg-blue-500', 'bg-cyan-500', 'bg-emerald-500'];
          return (
            <div className="flex flex-col gap-2">
              <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-slate-100 p-0.5">
                {total === 0 ? null : submissionFunnel.map((f, i) =>
                  f.value > 0 ? (
                    <div key={f.name} className={`h-full rounded-full ${colors[i]}`} style={{ width: `${(f.value / total) * 100}%` }} title={`${f.name}: ${f.value}`} />
                  ) : null
                )}
              </div>
              <div className="flex items-center justify-between px-1 font-mono text-[10px] text-slate-400">
                <span>Shared</span>
                <span className="font-semibold text-indigo-600">Stage distribution</span>
                <span>Onboarded</span>
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {[
            { n: 1, name: 'Shared', value: offerMetrics.candidatesShared, color: '#7C4EE0', dwell: dwellByStage.shared,
              rateLabel: 'Offer rate', rate: pct(offerMetrics.offersIssued, offerMetrics.candidatesShared) },
            { n: 2, name: 'Interviewing', value: interviewsData?.count ?? 0, color: '#4F46D8', dwell: dwellByStage.interviewing,
              rateLabel: null, rate: null },
            { n: 3, name: 'Offered', value: offerMetrics.offersIssued, color: '#3A8EF0', dwell: dwellByStage.offered,
              rateLabel: 'Accepted', rate: pct(offerMetrics.offersAccepted, offerMetrics.offersIssued) },
            { n: 4, name: 'Accepted', value: offerMetrics.offersAccepted, color: '#2A9D8F', dwell: dwellByStage.accepted,
              rateLabel: 'Joined', rate: pct(offerMetrics.onboardedCandidates, offerMetrics.offersAccepted) },
            { n: 5, name: 'Onboarded', value: offerMetrics.onboardedCandidates, color: '#17734A', dwell: null as number | null,
              rateLabel: null, rate: null },
          ].map((st) => (
            <div key={st.name} className={`rounded-xl border p-4 transition-all ${st.n === 5 ? 'border-indigo-200/90 bg-gradient-to-b from-indigo-50/50 to-white shadow-sm' : 'border-slate-200/90 bg-slate-50/80 hover:bg-slate-50'}`}>
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-['Public_Sans'] text-[11px] font-bold uppercase tracking-wider text-slate-700">{st.n}. {st.name}</span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />
              </div>
              <p className="mt-3 flex items-baseline gap-1.5"><span className="text-2xl font-extrabold text-slate-900">{st.value}</span><span className="text-xs text-slate-500">{st.n === 5 ? 'placed' : 'candidates'}</span></p>
              <div className="mt-3 space-y-1.5 text-[12px]">
                {st.n !== 5 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-tertiary)]">Avg dwell</span>
                    <span className="font-mono font-medium text-[var(--text-primary)]">{fmtDwell(st.dwell)}</span>
                  </div>
                )}
                {st.rateLabel && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-tertiary)]">{st.rateLabel}</span>
                    <span className="font-mono font-medium text-[var(--text-primary)]">{st.rate ?? '—'}</span>
                  </div>
                )}
                {st.n === 5 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-tertiary)]">Avg to hire</span>
                    <span className="font-mono font-medium text-[var(--text-primary)]">
                      {avgTimeToHireDays ? `${avgTimeToHireDays.avg.toFixed(1)}d` : '—'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-7">
      <div>
      {/* Priority Requirements & SLA Deadlines */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Clock className="h-[18px] w-[18px]" /></div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Priority Requisitions &amp; SLA Deadlines</h3>
            <p className="text-xs text-slate-500">Submit qualified talent before your SLA windows expire.</p>
          </div>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
          {urgentCount} due within 24h
        </span>
      </div>
      <div>
        <div className="overflow-hidden">
          {priorityShares.length === 0 ? (
            <div className="flex h-12 items-center px-4 text-[13px] text-[var(--text-secondary)]">
              <CheckCircle className="w-4 h-4 mr-2 text-[#17734A]" />
              No active requirement shares right now.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 font-['Public_Sans'] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 px-4">Role &amp; client</th>
                    <th className="py-2.5 px-3">Req ID</th>
                    <th className="py-2.5 px-3">Submissions</th>
                    <th className="py-2.5 px-3">SLA</th>
                    <th className="py-2.5 px-3">Budget</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[13px]">
                  {priorityShares.map((sh) => {
                    const job = sh.requirements;
                    const budgetInfo = job ? formatRequirementBudgetWithSubtitle(job) : null;
                    const subCount = submissionCountByReqId.get(sh.requirement_id) || 0;
                    const clientName = (job && clientNameByReqId.get(job.id)) || '-';
                    return (
                      <tr
                        key={sh.id}
                        onClick={() => navigate(`/vendor/requirements/${sh.requirement_id}`)}
                        className="hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                            {job?.title || sh.requirement_id}
                            {!sh.acknowledged_at && <Badge tone="warning">New</Badge>}
                          </div>
                          <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                            {clientName}{job?.location ? ` · ${job.location}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[var(--text-tertiary)]">
                          #{sh.requirement_id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[var(--text-secondary)]">
                          {subCount}
                        </td>
                        <td className="py-3 px-3">
                          <SlaBadge dueAt={sh.due_at} showCountdown />
                        </td>
                        <td className="py-3 px-3 font-mono text-[var(--text-secondary)]">
                          {budgetInfo?.formatted && budgetInfo.formatted !== '-' ? budgetInfo.formatted : '-'}
                        </td>
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => navigate(`/vendor/requirements/${sh.requirement_id}`)}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                          >
                            Submit →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-b-xl border-t border-slate-100 bg-slate-50 p-4 text-xs">
        <span className="text-slate-500">Showing {priorityShares.length} of {activeShares.length} active requirement shares</span>
        <button type="button" onClick={() => navigate('/vendor/requirements')} className="font-bold text-indigo-600 hover:text-indigo-800">
          View All Requirements ({activeShares.length}) →
        </button>
      </div>
      </div>

      </div>

      <div className="space-y-6">
        {perf ? (
          <DashboardSection title="Agency performance standing">
            <VendorPerformancePanel performance={perf} />
          </DashboardSection>
        ) : (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 text-[13px] text-[var(--text-secondary)]">
            Agency performance standing appears once enough submissions have been rated.
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/vendor/offers')}>Offers ({offerMetrics.offersIssued})</Button>
          <Button size="sm" onClick={() => navigate('/vendor/onboarded')}>Onboarded ({offerMetrics.onboardedCandidates})</Button>
        </div>
      </div>
      </div>

      {/* Active Requirements Pipeline */}
      {allRequirements.length > 0 && (
        <RequirementsPipelineGrid
          requirements={allRequirements}
          shares={shares}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
          onSelectRequirement={(req) => navigate(`/vendor/requirements/${req.id}`)}
        />
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
  const [categoryFilter, setCategoryFilter] = useState<RequirementCategoryFilterValue>('all');
  // Default to open requirements, like the HQ list.
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [workModeFilter, setWorkModeFilter] = useState<string>('');
  const [employmentFilter, setEmploymentFilter] = useState<string>('');
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
  const categoryRequirements = allRequirements.filter(
    (req) =>
      matchesRequirementCategory(req, categoryFilter) &&
      (!statusFilter || req.status === statusFilter) &&
      (!workModeFilter || req.work_mode === workModeFilter) &&
      (!employmentFilter || req.employment_type === employmentFilter)
  );
  const hasActiveFilters =
    categoryFilter !== 'all' ||
    statusFilter !== 'open' ||
    Boolean(workModeFilter) ||
    Boolean(employmentFilter) ||
    quickFilter !== 'all';
  const filteredRows = categoryRequirements.filter((req) =>
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

      {!isLoading && allRequirements.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <RequirementCategoryFilter
            value={categoryFilter}
            onChange={(v) => {
              setCategoryFilter(v);
              setPage(1);
            }}
            requirements={allRequirements}
          />
          <div className="w-40">
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'open', label: 'Open' },
                { value: 'on_hold', label: 'On hold' },
                { value: 'closed', label: 'Closed' },
                { value: 'filled', label: 'Filled' },
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              value={workModeFilter}
              onChange={(e) => {
                setWorkModeFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All work modes' },
                { value: 'remote', label: 'Remote' },
                { value: 'hybrid', label: 'Hybrid' },
                { value: 'onsite', label: 'Onsite' },
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              value={employmentFilter}
              onChange={(e) => {
                setEmploymentFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All engagement types' },
                { value: 'full_time', label: 'Full-time' },
                { value: 'contract', label: 'Contract' },
                { value: 'contract_to_hire', label: 'Contract to hire' },
              ]}
            />
          </div>
          {hasActiveFilters && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCategoryFilter('all');
                setStatusFilter('open');
                setWorkModeFilter('');
                setEmploymentFilter('');
                setQuickFilter('all');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}
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
          requirements={categoryRequirements}
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
                        <RequirementRibbon requirement={req} />
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
                          <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
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
                            {m.candidates?.current_title || '-'} ·{' '}
                            <span className="font-mono tabular-nums">
                              {m.candidates?.total_experience_years ?? '-'} yrs
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
                  <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
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
                          {c.current_title || '-'} ·{' '}
                          <span className="font-mono tabular-nums">
                            {c.total_experience_years ?? '-'} yrs
                          </span>{' '}
                          · {c.location || '-'}
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

  const { data: myShares = [] } = useQuery({
    queryKey: ['vendor_shares', profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(undefined, profile?.org_id || undefined),
    enabled: Boolean(profile?.org_id),
  });
  const sharedReqIds = new Set(myShares.filter((s) => !s.revoked_at).map((s) => s.requirement_id));

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
        description={`${cand.current_title || 'Candidate'} · ${cand.location || '-'} · ${
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
                                {m.requirements?.location || '-'} ({m.requirements?.work_mode || '-'})
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
                                  disabled={!sharedReqIds.has(m.requirement_id)}
                                  title={
                                    sharedReqIds.has(m.requirement_id)
                                      ? undefined
                                      : "This requirement hasn't been shared with your agency yet"
                                  }
                                  onClick={() => {
                                    setSubmitTarget(m);
                                    setSubmitNotes('');
                                  }}
                                >
                                  {sharedReqIds.has(m.requirement_id) ? 'Submit' : 'Not shared'}
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
                {contacts?.email || '-'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Phone</dt>
              <dd className="font-mono text-[12px] text-[var(--text-primary)]">
                {contacts?.phone || '-'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">LinkedIn</dt>
              <dd className="truncate max-w-[180px] text-[12px] text-[var(--text-secondary)]">
                {contacts?.linkedin_url || '-'}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Resume SHA-256</dt>
              <dd className="font-mono text-[12px] text-[var(--text-tertiary)]">
                {cand.resume_hash ? cand.resume_hash.slice(0, 10) : '-'}
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
                        <div className="text-[12px] font-mono text-[var(--text-tertiary)]">
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
                          {m.candidates?.current_title || '-'} ·{' '}
                          <span className="font-mono tabular-nums">
                            {m.candidates?.total_experience_years ?? '-'} yrs
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(m.matched_skills || []).map((sk) => (
                          <span
                            key={`m-${sk}`}
                            className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] font-medium text-[var(--text-primary)]"
                          >
                            {sk}
                          </span>
                        ))}
                        {(m.unproven_skills || []).map((sk) => (
                          <span
                            key={`u-${sk}`}
                            className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] text-[var(--text-tertiary)]"
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

