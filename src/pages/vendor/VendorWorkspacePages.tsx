import type { ValidationDecisionStage } from '../../lib/recruiterValidation';
import { supabase } from '../../lib/supabase';
import { CandidateEmploymentSummary } from '../../components/domain/CandidateEmploymentSummary';
import { NOTICE_OPTIONS } from '../../lib/onboarding';
import { CandidateEmploymentPanel } from '../../components/domain/CandidateEmploymentPanel';
import React, { useState, useMemo } from 'react';
import { usePersistedState } from '../../lib/usePersistedState';
import { formatExperienceRange } from '../../lib/format';
import { displayClientName } from '../../lib/clientIdentity';
import {
  RequirementRibbon,
  RequirementCategoryFilter,
  matchesRequirementCategory,
  hasBgvRequired,
  type RequirementCategoryFilterValue,
} from '../../components/domain/RequirementRibbon';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Users, CalendarCheck, Send, CheckCircle, Clock, Star, ShieldCheck, CreditCard, FileText } from 'lucide-react';
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
import { FitmentScoreCard } from '../../components/domain/FitmentScoreCard';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { AiScoreCell, AiScoreHeader, useAiInterviewSummaries } from '../../components/domain/AiScore';
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
  getVendorSubmissionCount,
  vendorNdaIsVerified,
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
  formatSlaHours,
  formatRequirementBudgetWithSubtitle,
  maskEmail,
  maskPhone,
} from '../../lib/format';
import {
  computeOfferOnboardingMetrics,
  fetchAllOfferOnboardingRecordsApi,
} from '../../lib/offerOnboarding';
import { parseRequirementMeta } from '../../lib/enterpriseLifecycle';
import { getRequirementBgvChecks, formatBgvSummary } from '../../lib/bgv';
import { computeFineTunedCandidateMatch } from '../../lib/matchingEngine';
import { useToast } from '../../components/ui/Toast';
import type {
  Candidate,
  Requirement,
  CandidateContacts,
  CandidateMatch,
  FeedbackKind,
  SubmissionStage,
} from '../../types/db';

function buildCandidateMatchRecord(requirement: Requirement, candidate: Candidate): CandidateMatch {
  const fineTuned = computeFineTunedCandidateMatch(requirement, candidate);
  return {
    id: `${requirement.id}_${candidate.id}`,
    requirement_id: requirement.id,
    candidate_id: candidate.id,
    computed_score: fineTuned.computed_score,
    skill_score: fineTuned.skill_score,
    experience_score: fineTuned.experience_score,
    domain_score: fineTuned.domain_score,
    seniority_score: fineTuned.seniority_score,
    override_score: null,
    final_score: fineTuned.final_score,
    matched_skills: fineTuned.matched_skills,
    unproven_skills: fineTuned.unproven_skills,
    experience_note: fineTuned.experience_note,
    evidence: {
      engine: 'v2.2-4d-weighted',
      formula: '0.40*S + 0.25*E + 0.20*D + 0.15*N',
      skill_score: fineTuned.skill_score,
      experience_score: fineTuned.experience_score,
      domain_score: fineTuned.domain_score,
      seniority_score: fineTuned.seniority_score,
      dimensions: fineTuned.dimensions,
    },
    engine_version: 'v2.2-4d-weighted',
    calculated_at: new Date().toISOString(),
    override_reason: null,
    overridden_by: null,
    overridden_at: null,
    candidates: candidate,
    requirements: requirement,
  };
}

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
    { name: 'Shared', value: offerMetrics.candidatesShared, color: '#939084' },
    { name: 'Interviewing', value: interviewsData?.count ?? 0, color: '#C98A4B' },
    { name: 'Offered', value: offerMetrics.offersIssued, color: '#1D5FD1' },
    { name: 'Accepted', value: offerMetrics.offersAccepted, color: '#2A9D8F' },
    { name: 'Onboarded', value: offerMetrics.onboardedCandidates, color: '#17734A' },
  ], [offerMetrics, interviewsData]);

  const clientNameByReqId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of allRequirements) {
      m.set(r.id, displayClientName(r.organizations, 'vendor_admin', r.client_org_id));
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
        <div className="rounded-[12px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-3.5 flex items-center gap-3">
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
            { n: 1, name: 'Shared', value: offerMetrics.candidatesShared, color: '#1A56C2', dwell: dwellByStage.shared,
              rateLabel: 'Offer rate', rate: pct(offerMetrics.offersIssued, offerMetrics.candidatesShared) },
            { n: 2, name: 'Interviewing', value: interviewsData?.count ?? 0, color: '#1D5FD1', dwell: dwellByStage.interviewing,
              rateLabel: null, rate: null },
            { n: 3, name: 'Offered', value: offerMetrics.offersIssued, color: '#38ACEF', dwell: dwellByStage.offered,
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
                          {job && <RequirementRibbon requirement={job} />}
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
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5 text-[13px] text-[var(--text-secondary)]">
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
  // Filters persist (per user) until cleared, even across page refreshes.
  const fk = (name: string) => `hn:filters:vendor-requirements:${profile?.id ?? 'anon'}:${name}`;
  const [search, setSearch] = usePersistedState<string>(fk('search'), '', searchParams.get('search') || null);
  const [quickFilter, setQuickFilter] = usePersistedState<PipelineQuickFilter>(fk('quick'), 'all');
  const [categoryFilter, setCategoryFilter] = usePersistedState<RequirementCategoryFilterValue>(fk('category'), 'all');
  // Default to open requirements, like the HQ list.
  const [statusFilter, setStatusFilter] = usePersistedState<string>(fk('status'), 'open');
  const [workModeFilter, setWorkModeFilter] = usePersistedState<string>(fk('workmode'), '');
  const [employmentFilter, setEmploymentFilter] = usePersistedState<string>(fk('employment'), '');
  const [viewMode, setViewMode] = usePersistedState<'cards' | 'table'>(fk('view'), 'cards');

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
                          {formatExperienceRange(req.min_experience, req.max_experience)} · {req.openings} opening(s)
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

  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'submissions'>('overview');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [acking, setAcking] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);
  const [showNdaAlert, setShowNdaAlert] = useState(false);

  // Manual candidate mapping state (submitting candidate from vendor pool to this requirement)
  const [manualCandOpen, setManualCandOpen] = useState(false);
  const [manualCandList, setManualCandList] = useState<Candidate[]>([]);
  const [manualCandLoading, setManualCandLoading] = useState(false);
  const [manualSelectedCandId, setManualSelectedCandId] = useState('');
  const [manualCandNotes, setManualCandNotes] = useState('');
  const [manualCandSubmitting, setManualCandSubmitting] = useState(false);
  const [manualCandDupReason, setManualCandDupReason] = useState<string | null>(null);

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
        vendorOrgId: profile?.org_id || undefined,
        acknowledgedByUserId: profile?.id,
        acknowledgedByName: profile?.full_name,
        acknowledgedByEmail: profile?.email,
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
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

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
      // NDA soft gate: show nudge after 3rd or 4th submission if NDA not verified
      if (profile?.org_id) {
        const [count, verified] = await Promise.all([
          getVendorSubmissionCount(profile.org_id),
          vendorNdaIsVerified(profile.org_id),
        ]);
        if (!verified && (count === 3 || count === 4)) {
          setShowNdaAlert(true);
        }
      }
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

  const openCandidateMap = async () => {
    setManualCandOpen(true);
    setManualCandLoading(true);
    setManualSelectedCandId('');
    setManualCandNotes('');
    setManualCandDupReason(null);
    try {
      const res = await fetchCandidates({ ownerVendorOrgId: profile?.org_id || undefined, pageSize: 200 });
      setManualCandList(res.data);
    } catch {
      toast({ title: 'Could not load your candidates', tone: 'error' });
    } finally {
      setManualCandLoading(false);
    }
  };

  const handleManualCandSubmit = async () => {
    if (!manualSelectedCandId || !id) return;
    setManualCandSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: id,
        p_candidate_id: manualSelectedCandId,
        p_notes: manualCandNotes.trim() || null,
      });
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

      if (res.status === 'duplicate') {
        setManualCandDupReason(res.reason ?? 'Already submitted to this requirement.');
        return;
      }
      toast({ title: 'Candidate submitted successfully', tone: 'success' });
      setManualCandOpen(false);
      queryClient.invalidateQueries({ queryKey: ['vendor_req_submissions', id] });
      queryClient.invalidateQueries({ queryKey: ['vendor_req_matches', id] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['vendor_req_submissions'] });
      toast({ title: 'Submission failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setManualCandSubmitting(false);
    }
  };

  const availabilityIds = [...new Set([
    ...(matchesData?.data || []).map(m => m.candidate_id),
    ...manualCandList.map(c => c.id),
  ])].sort();
  const availabilityQuery = useQuery({
    queryKey: ['candidate_availability', id, availabilityIds.join(',')],
    enabled: Boolean(id && availabilityIds.length),
    queryFn: async () => {
      const result: Record<string, {status: string; reason: string}> = {};
      for (let offset = 0; offset < availabilityIds.length; offset += 200) {
        const {data, error} = await supabase.rpc('candidate_availability_for_requirement', {
          p_requirement: id, p_candidates: availabilityIds.slice(offset, offset + 200),
        });
        if (error) throw error;
        Object.assign(result, data);
      }
      return result;
    },
  });
  const availability = availabilityQuery.data || {};
  const excludedCount = (matchesData?.data || []).filter(m => availability[m.candidate_id]?.status === 'ineligible').length;

  if (isLoading || !req) return <TableSkeleton rows={5} cols={4} />;

  const mySubmissions = submissionsData?.data || [];
  const budgetInfo = formatRequirementBudgetWithSubtitle(req);
  const reqMeta = parseRequirementMeta(req);

  return (
    <div className="max-w-[1200px]">
      <RequirementRibbon requirement={req} className="mb-1" />
      <PageHeader
        title={req.title}
        description={`${req.location} (${req.work_mode}) · ${formatExperienceRange(req.min_experience, req.max_experience)} · Vendor budget: ${budgetInfo.formatted}${budgetInfo.subtitle ? ` (${budgetInfo.subtitle})` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {share ? (
              <SlaBadge dueAt={share.due_at} showCountdown />
            ) : (
              <Badge tone="neutral">SLA {formatSlaHours(req.submission_sla_hours)}</Badge>
            )}
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
                id: 'overview',
                label: 'Specification',
              },
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
            ]}
            activeTab={activeTab}
            onChange={(t) => setActiveTab(t as 'overview' | 'matches' | 'submissions')}
          />

          {activeTab === 'matches' && <div className="space-y-2 text-[13px]">
            <label className="flex gap-2 items-center"><input type="checkbox" checked={showUnavailable} onChange={e => setShowUnavailable(e.target.checked)} />Show incompatible availability ({excludedCount} filtered)</label>
            <p>Confirmed non-immediate candidates are filtered for explicit immediate-only requirements. Missing availability needs review.</p>
            {availabilityQuery.isLoading && <p>Checking joining availability…</p>}
            {availabilityQuery.error && <p className="text-[var(--status-danger)]">Availability check unavailable. Submission still checks the requirement in the database.</p>}
          </div>}
          {activeTab === 'matches' && (
            !matchesData?.data.length ? (
              <EmptyState
                title="No matching candidates in your pool yet"
                description="Add candidates with matching skills in your Candidate Pool to see ranked matches here."
                actionLabel="Submit a candidate manually"
                onAction={openCandidateMap}
              />
            ) : (
              <>
                <div className="flex justify-end pb-2">
                  <Button size="sm" variant="outline" onClick={openCandidateMap}>
                    + Submit candidate manually
                  </Button>
                </div>
              <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {matchesData.data.filter(m => showUnavailable || availability[m.candidate_id]?.status !== 'ineligible').map((m, idx) => {
                  const alreadySubmitted = mySubmissions.some(
                    (s) => s.candidate_id === m.candidate_id && s.stage !== 'rejected' && s.stage !== 'withdrawn'
                  );
                  return (
                    <div key={m.id} className="py-3 flex flex-col gap-2">
                      {availability[m.candidate_id] && availability[m.candidate_id].status !== 'not_applicable' && <p className={availability[m.candidate_id].status === 'ineligible' ? 'text-[12px] text-[var(--status-danger)]' : 'text-[12px] text-[var(--text-secondary)]'}>{availability[m.candidate_id].reason}</p>}
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
              </>
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
                          <StageBadge stage={sub.stage} vendorView />
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
              {hasBgvRequired(req) && (
                <div className="rounded-[8px] border border-sky-500/30 bg-sky-500/5 p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0 text-sky-600 mt-0.5">
                    <ShieldCheck className="h-5 w-5 stroke-[2.2]" />
                  </div>
                  <div className="space-y-1.5 text-[13px]">
                    <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2 flex-wrap">
                      <span>Background Verification (BGV) Mandatory</span>
                      <span className="rounded-full bg-sky-600 text-white text-[10px] px-2 py-0.5 uppercase tracking-wider font-bold">
                        BGV Process
                      </span>
                    </div>
                    <p className="text-[var(--text-secondary)] text-[12px] leading-relaxed">
                      This requirement requires a strict <strong>Background Verification (BGV)</strong> process prior to onboarding, including:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {getRequirementBgvChecks(req).map((check) => (
                        <span
                          key={check}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-300 dark:border-sky-800"
                        >
                          <ShieldCheck className="h-3 w-3 shrink-0" />
                          {check}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
              {reqMeta.paymentTerms && (
                <div className="pt-4 border-t border-[var(--border)] space-y-2">
                  <h3 className="text-[12px] font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-[var(--text-secondary)]" />
                    <span>Vendor Payment Terms &amp; Commercial Notes</span>
                  </h3>
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 text-[13px] leading-relaxed text-[var(--text-primary)] font-medium">
                    {reqMeta.paymentTerms}
                  </div>
                </div>
              )}
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
              <dt className="text-[12px] text-[var(--text-secondary)]">Submission SLA</dt>
              <dd className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                {formatSlaHours(req.submission_sla_hours)}
              </dd>
            </div>
            {req.vendor_charge_pct != null && (
              <div className="py-2 flex justify-between gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">Vendor service fee</dt>
                <dd className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                  {req.vendor_charge_pct}%{req.employment_type === 'full_time' ? ' of CTC' : ''}
                </dd>
              </div>
            )}
            {reqMeta.paymentTerms && (
              <div className="py-2 flex justify-between items-center gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">Payment terms</dt>
                <dd className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {reqMeta.paymentTerms}
                </dd>
              </div>
            )}
            {reqMeta.joiningTimeline && (
              <div className="py-2 flex justify-between items-center gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">Joining</dt>
                <dd className="font-medium text-[var(--text-primary)] text-right">
                  {reqMeta.joiningTimeline}
                </dd>
              </div>
            )}
            {reqMeta.contractDuration && (
              <div className="py-2 flex justify-between items-center gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">Contract period</dt>
                <dd className="font-medium text-[var(--text-primary)] text-right">
                  {reqMeta.contractDuration}
                </dd>
              </div>
            )}
            {reqMeta.travelRequirement && (
              <div className="py-2 flex justify-between items-start gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">Travel / Work</dt>
                <dd className="font-medium text-[var(--text-primary)] text-right max-w-[170px] leading-snug">
                  {reqMeta.travelRequirement}
                </dd>
              </div>
            )}
            {hasBgvRequired(req) && (
              <div className="py-2 flex justify-between items-start gap-2">
                <dt className="text-[12px] text-[var(--text-secondary)]">BGV check</dt>
                <dd className="text-right space-y-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-600 px-2.5 py-0.5 text-[11px] font-semibold border border-sky-500/20">
                    <ShieldCheck className="h-3 w-3 stroke-[2.5]" />
                    {formatBgvSummary(getRequirementBgvChecks(req))}
                  </span>
                  {getRequirementBgvChecks(req).length > 0 && (
                    <div className="flex flex-col items-end gap-0.5">
                      {getRequirementBgvChecks(req).map((check) => (
                        <span key={check} className="text-[10px] text-sky-700 dark:text-sky-300 font-medium">
                          · {check}
                        </span>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            )}
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">SLA due</dt>
              <dd className="text-right">
                {share ? (
                  <>
                    <div className="font-mono tabular-nums text-[var(--text-primary)]">
                      {formatLocalDateTime(share.due_at)}
                    </div>
                    <div className="mt-1 flex justify-end">
                      <SlaBadge dueAt={share.due_at} revokedAt={share.revoked_at} showCountdown />
                    </div>
                  </>
                ) : (
                  <span className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                    Starts when this is shared with you
                  </span>
                )}
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
                {formatExperienceRange(req.min_experience, req.max_experience)}
              </dd>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <dt className="text-[12px] text-[var(--text-secondary)]">Openings</dt>
              <dd className="font-mono tabular-nums text-[var(--text-primary)]">
                {req.openings}
              </dd>
            </div>
          </dl>
          {reqMeta.paymentTerms && (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span>Payment terms &amp; notes</span>
              </div>
              <div className="text-[13px] font-medium text-[var(--text-primary)]">
                {reqMeta.paymentTerms}
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                Commercial payment terms applicable to placing vendor agency.
              </p>
            </div>
          )}
          {reqMeta.notes && (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span>Important notes &amp; instructions</span>
              </div>
              <p className="text-[13px] leading-relaxed font-medium text-[var(--text-primary)] whitespace-pre-line">
                {reqMeta.notes}
              </p>
            </div>
          )}
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

      {/* NDA Soft-Gate Alert — shown after 3rd/4th submission if NDA unverified */}
      <Dialog
        open={showNdaAlert}
        onClose={() => setShowNdaAlert(false)}
        title="NDA Verification Required Soon"
      >
        <div className="space-y-4 text-[13px] text-[var(--text-primary)]">
          <p>
            Your agency has made <strong>3 or more candidate submissions</strong>. To continue
            submitting beyond this point, HireNest requires a verified <strong>Non-Disclosure Agreement (NDA)</strong> on file.
          </p>
          <p className="text-[var(--text-secondary)]">
            Please contact your HireNest account manager or reach out to{' '}
            <a href="mailto:compliance@hirenestworkforce.com" className="underline text-blue-600">
              compliance@hirenestworkforce.com
            </a>{' '}
            to get your NDA executed and verified. This is a one-time process.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowNdaAlert(false)}>
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => {
                window.open('mailto:compliance@hirenestworkforce.com?subject=NDA Verification Request', '_blank');
                setShowNdaAlert(false);
              }}
            >
              Contact Compliance
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Manual Candidate Mapping Dialog */}
      <Dialog
        open={manualCandOpen}
        onClose={() => setManualCandOpen(false)}
        title="Submit a candidate to this requirement"
        description="Pick any candidate from your agency pool to map and submit directly."
        maxWidth="max-w-[560px]"
      >
        {manualCandDupReason ? (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              ⚠️ Already submitted: {manualCandDupReason}
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => { setManualCandDupReason(null); setManualSelectedCandId(''); }}>
                Try another candidate
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManualCandOpen(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {manualCandLoading ? (
              <div className="text-[13px] text-[var(--text-secondary)] py-4 text-center">Loading your candidates…</div>
            ) : (
              <>
                <Select
                  label="Select candidate"
                  value={manualSelectedCandId}
                  onChange={(e) => setManualSelectedCandId(e.target.value)}
                  options={[
                    { value: '', label: '— Choose a candidate from your pool —' },
                    ...manualCandList.map((c) => ({
                      value: c.id,
                      label: `${availability[c.id]?.status === 'ineligible' ? '[Will auto-reject] ' : ''}${c.full_name}${c.current_title ? ` · ${c.current_title}` : ''}${c.total_experience_years != null ? ` · ${c.total_experience_years} yrs` : ''}`,
                    })),
                  ]}
                />
                {(() => {
                  const selCand = manualCandList.find((c) => c.id === manualSelectedCandId);
                  if (!selCand || !req) return null;
                  const previewMatch = buildCandidateMatchRecord(req, selCand);
                  return (
                    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[var(--text-primary)]">Deterministic Fitment Score</span>
                        <span className="font-mono font-bold text-[14px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                          {previewMatch.final_score}/100
                        </span>
                      </div>
                      <div className="text-[var(--text-secondary)]">
                        <strong>Experience:</strong> {selCand.total_experience_years ?? 0} yrs (JD requires {req.min_experience}–{req.max_experience} yrs)
                      </div>
                      {previewMatch.matched_skills.length > 0 && (
                        <div>
                          <span className="text-emerald-700 font-medium">Matched skills ({previewMatch.matched_skills.length}): </span>
                          <span className="text-[var(--text-primary)]">{previewMatch.matched_skills.slice(0, 6).join(', ')}{previewMatch.matched_skills.length > 6 ? '…' : ''}</span>
                        </div>
                      )}
                      {previewMatch.unproven_skills.length > 0 && (
                        <div>
                          <span className="text-amber-700 font-medium">Unproven / Missed skills ({previewMatch.unproven_skills.length}): </span>
                          <span className="text-[var(--text-secondary)]">{previewMatch.unproven_skills.slice(0, 6).join(', ')}{previewMatch.unproven_skills.length > 6 ? '…' : ''}</span>
                        </div>
                      )}
                      {req.employment_type === 'full_time' && req.vendor_charge_pct != null && (
                        <div className="pt-1 text-[11px] font-medium text-emerald-700 border-t border-[var(--border)]">
                          💰 Placement fee: {req.vendor_charge_pct}% of CTC upon successful hire
                        </div>
                      )}
                    </div>
                  );
                })()}
                <Textarea
                  label="Notes (optional)"
                  value={manualCandNotes}
                  onChange={(e) => setManualCandNotes(e.target.value)}
                  placeholder="Add any context for the recruiter…"
                  rows={3}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setManualCandOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={!manualSelectedCandId || manualCandSubmitting}
                    onClick={handleManualCandSubmit}
                  >
                    {manualCandSubmitting ? 'Submitting…' : 'Submit Candidate'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Dialog>
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
  const [employmentFilter, setEmploymentFilter] = useState('');
  const [noticeFilter, setNoticeFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [employmentCandidate, setEmploymentCandidate] = useState<Candidate | null>(null);
  const [modalMode, setModalMode] = useState<'single' | 'bulk'>('single');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_candidates', profile?.org_id, page, search, employmentFilter, noticeFilter],
    queryFn: () =>
      fetchCandidates({
        page,
        ownerVendorOrgId: profile?.org_id || undefined,
        search,
        employmentType: employmentFilter,
        noticePeriod: noticeFilter,
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

      <div className="mb-4 flex flex-wrap gap-3">
        <Select label="Employment type" value={employmentFilter} onChange={e => { setEmploymentFilter(e.target.value); setPage(1); }} options={[{value:'',label:'All employment types'}, ...['FTE','C2C','C2H'].map(value => ({value,label:value}))]} />
        <Select label="Notice period" value={noticeFilter} onChange={e => { setNoticeFilter(e.target.value); setPage(1); }} options={[{value:'',label:'All notice periods'}, ...NOTICE_OPTIONS]} />
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
                  <th>Employment / commercials</th>
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
                      <td><CandidateEmploymentSummary candidate={c} /><Button size="sm" variant="secondary" onClick={event => { event.stopPropagation(); setEmploymentCandidate(c); }}>Edit employment</Button></td>
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

      <Dialog open={Boolean(employmentCandidate)} onClose={() => setEmploymentCandidate(null)} title={`Employment details · ${employmentCandidate?.full_name || ''}`}>
        {employmentCandidate && <CandidateEmploymentPanel key={employmentCandidate.id} candidateId={employmentCandidate.id} />}
      </Dialog>
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

  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'submissions'>('overview');
  const [matchesPage, setMatchesPage] = useState(1);
  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [scorecardTarget, setScorecardTarget] = useState<CandidateMatch | null>(null);
  const [submitTarget, setSubmitTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);
  const [showNdaAlert, setShowNdaAlert] = useState(false);

  // Manual requirement mapping state (submitting this candidate to an open requirement)
  const [manualReqOpen, setManualReqOpen] = useState(false);
  const [manualReqList, setManualReqList] = useState<Requirement[]>([]);
  const [manualReqLoading, setManualReqLoading] = useState(false);
  const [manualSelectedReqId, setManualSelectedReqId] = useState('');
  const [manualReqNotes, setManualReqNotes] = useState('');
  const [manualReqSubmitting, setManualReqSubmitting] = useState(false);
  const [manualReqDupReason, setManualReqDupReason] = useState<string | null>(null);

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
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

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
      // NDA soft gate: show nudge after 3rd or 4th submission if NDA not verified
      if (profile?.org_id) {
        const [count, verified] = await Promise.all([
          getVendorSubmissionCount(profile.org_id),
          vendorNdaIsVerified(profile.org_id),
        ]);
        if (!verified && (count === 3 || count === 4)) {
          setShowNdaAlert(true);
        }
      }
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

  const openManualMap = async () => {
    setManualReqOpen(true);
    setManualReqLoading(true);
    setManualSelectedReqId('');
    setManualReqNotes('');
    setManualReqDupReason(null);
    try {
      const res = await fetchRequirements({ status: 'open', forVendor: true, pageSize: 200 } as Parameters<typeof fetchRequirements>[0]);
      setManualReqList(res.data.filter((r) => r.status === 'open'));
    } catch {
      toast({ title: 'Could not load requirements', tone: 'error' });
    } finally {
      setManualReqLoading(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualSelectedReqId || !id) return;
    setManualReqSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: manualSelectedReqId,
        p_candidate_id: id,
        p_notes: manualReqNotes.trim() || null,
      });
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

      if (res.status === 'duplicate') {
        setManualReqDupReason(res.reason ?? 'Already submitted to this requirement.');
        return;
      }
      toast({ title: 'Candidate submitted successfully', tone: 'success' });
      setManualReqOpen(false);
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_submissions', id] });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_matches', id] });
    } catch (err) {
      toast({ title: 'Submission failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setManualReqSubmitting(false);
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
            <Button size="sm" variant="outline" onClick={openManualMap}>
              Submit to Requirement
            </Button>
          </div>
        }
      />



      <CandidateEmploymentPanel candidateId={cand.id} />

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
                        (s) => s.requirement_id === m.requirement_id && s.stage !== 'rejected' && s.stage !== 'withdrawn'
                      );
                      return (
                        <div key={m.id} className="py-3 flex flex-col gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)] w-6">
                                #{idx + 1}
                              </span>
                              <div className="min-w-0">
                                {m.requirements && <RequirementRibbon requirement={m.requirements} />}
                                <Link
                                  to={`/vendor/requirements/${m.requirement_id}`}
                                  className="block text-[14px] font-medium text-[var(--text-primary)] hover:underline truncate"
                                >
                                  {m.requirements?.title || m.requirement_id}
                                </Link>
                              </div>
                              <span className="text-[13px] text-[var(--text-secondary)]">
                                {m.requirements?.location || '-'} ({m.requirements?.work_mode || '-'})
                              </span>
                              {existingSub ? (
                                <StageBadge stage={existingSub.stage} vendorView />
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
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setScorecardTarget(m)}
                              >
                                Scorecard
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
                          {sub.requirements && <RequirementRibbon requirement={sub.requirements} />}
                          <Link
                            to={`/vendor/requirements/${sub.requirement_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-[var(--accent)] hover:underline block truncate max-w-[320px]"
                            title={`Open requirement details: ${sub.requirements?.title || sub.requirement_id}`}
                          >
                            {sub.requirements?.title || sub.requirement_id}
                          </Link>
                        </td>
                        <td>
                          <StageBadge stage={sub.stage} vendorView />
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

      {/* Fitment Scorecard — Vendor View Only (canDownload=false) */}
      {scorecardTarget && cand && scorecardTarget.requirements && (
        <FitmentScoreCard
          open={Boolean(scorecardTarget)}
          onClose={() => setScorecardTarget(null)}
          match={scorecardTarget}
          candidate={cand}
          requirement={scorecardTarget.requirements}
          clientName={scorecardTarget.requirements.organizations?.name}
          canDownload={false}
        />
      )}

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

      {/* NDA Soft-Gate Alert — shown after 3rd/4th submission if NDA unverified */}
      <Dialog
        open={showNdaAlert}
        onClose={() => setShowNdaAlert(false)}
        title="NDA Verification Required Soon"
      >
        <div className="space-y-4 text-[13px] text-[var(--text-primary)]">
          <p>
            Your agency has made <strong>3 or more candidate submissions</strong>. To continue
            submitting beyond this point, HireNest requires a verified <strong>Non-Disclosure Agreement (NDA)</strong> on file.
          </p>
          <p className="text-[var(--text-secondary)]">
            Please contact your HireNest account manager or reach out to{' '}
            <a href="mailto:compliance@hirenestworkforce.com" className="underline text-blue-600">
              compliance@hirenestworkforce.com
            </a>{' '}
            to get your NDA executed and verified. This is a one-time process.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowNdaAlert(false)}>
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => {
                window.open('mailto:compliance@hirenestworkforce.com?subject=NDA Verification Request', '_blank');
                setShowNdaAlert(false);
              }}
            >
              Contact Compliance
            </Button>
          </div>
        </div>
      </Dialog>

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

      {/* Manual Requirement Mapping Dialog */}
      <Dialog
        open={manualReqOpen}
        onClose={() => setManualReqOpen(false)}
        title="Submit candidate to an open requirement"
        description={`Select any active requirement to map and submit ${cand.full_name} directly.`}
        maxWidth="max-w-[560px]"
      >
        {manualReqDupReason ? (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              ⚠️ Already submitted: {manualReqDupReason}
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => { setManualReqDupReason(null); setManualSelectedReqId(''); }}>
                Try another requirement
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManualReqOpen(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {manualReqLoading ? (
              <div className="text-[13px] text-[var(--text-secondary)] py-4 text-center">Loading open requirements…</div>
            ) : (
              <>
                <Select
                  label="Select open requirement"
                  value={manualSelectedReqId}
                  onChange={(e) => setManualSelectedReqId(e.target.value)}
                  options={[
                    { value: '', label: '— Choose an open requirement —' },
                    ...manualReqList.map((r) => ({
                      value: r.id,
                      label: `${r.title} · ${r.employment_type === 'full_time' ? 'FTE' : r.employment_type.replace(/_/g, ' ')} · ${r.min_experience}–${r.max_experience ?? r.min_experience} yrs`,
                    })),
                  ]}
                />
                {(() => {
                  const selReq = manualReqList.find((r) => r.id === manualSelectedReqId);
                  if (!selReq || !cand) return null;
                  const previewMatch = buildCandidateMatchRecord(selReq, cand);
                  return (
                    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[var(--text-primary)]">Deterministic Fitment Score</span>
                        <span className="font-mono font-bold text-[14px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                          {previewMatch.final_score}/100
                        </span>
                      </div>
                      <div className="text-[var(--text-secondary)]">
                        <strong>Experience:</strong> {cand.total_experience_years ?? 0} yrs (JD requires {selReq.min_experience}–{selReq.max_experience} yrs)
                      </div>
                      {previewMatch.matched_skills.length > 0 && (
                        <div>
                          <span className="text-emerald-700 font-medium">Matched skills ({previewMatch.matched_skills.length}): </span>
                          <span className="text-[var(--text-primary)]">{previewMatch.matched_skills.slice(0, 6).join(', ')}{previewMatch.matched_skills.length > 6 ? '…' : ''}</span>
                        </div>
                      )}
                      {previewMatch.unproven_skills.length > 0 && (
                        <div>
                          <span className="text-amber-700 font-medium">Unproven / Missed skills ({previewMatch.unproven_skills.length}): </span>
                          <span className="text-[var(--text-secondary)]">{previewMatch.unproven_skills.slice(0, 6).join(', ')}{previewMatch.unproven_skills.length > 6 ? '…' : ''}</span>
                        </div>
                      )}
                      {selReq.employment_type === 'full_time' && selReq.vendor_charge_pct != null && (
                        <div className="pt-1 text-[11px] font-medium text-emerald-700 border-t border-[var(--border)]">
                          💰 Placement fee: {selReq.vendor_charge_pct}% of CTC upon successful hire
                        </div>
                      )}
                    </div>
                  );
                })()}
                <Textarea
                  label="Notes (optional)"
                  value={manualReqNotes}
                  onChange={(e) => setManualReqNotes(e.target.value)}
                  placeholder="Add any context for the recruiter…"
                  rows={3}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setManualReqOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={!manualSelectedReqId || manualReqSubmitting}
                    onClick={handleManualSubmit}
                  >
                    {manualReqSubmitting ? 'Submitting…' : 'Submit Candidate'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
};

// 6. Vendor Submissions Page
export const VendorSubmissionsPage: React.FC = () => {
  const { profile } = useAuth();
  const { id: urlSubId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const querySubId = searchParams.get('subId') || searchParams.get('submissionId');
  const initialSubId = urlSubId || querySubId || null;

  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<SubmissionStage | ''>('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(initialSubId);
  const [drawerInitialTab, setDrawerInitialTab] = useState<
    'match_summary' | 'followup' | 'validation_interview' | 'pipeline_history' | undefined
  >(initialSubId ? 'followup' : undefined);

  React.useEffect(() => {
    if (initialSubId) {
      setDrawerSubId(initialSubId);
      setDrawerInitialTab('followup');
    }
  }, [initialSubId]);

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
  const aiSummaries = useAiInterviewSummaries((data?.data || []).map((x) => x.id)).data;

  const subIds = useMemo(() => (data?.data || []).map((x) => x.id), [data?.data]);

  const { data: dbClarifications } = useQuery({
    queryKey: ['vendor_submission_clarifications', profile?.org_id, subIds.join(',')],
    queryFn: async () => {
      if (subIds.length === 0) return [];
      const { data: rows, error: qErr } = await supabase
        .from('submission_clarifications')
        .select('*')
        .in('submission_id', subIds)
        .order('created_at', { ascending: false });
      if (qErr) {
        console.warn('Failed to fetch submission clarifications', qErr);
        return [];
      }
      return rows || [];
    },
    enabled: Boolean(profile?.org_id && subIds.length > 0),
    refetchInterval: 8000,
  });

  const clarificationsBySubId = useMemo(() => {
    const map = new Map<string, { status: string; missing_skills?: string[]; questions?: string }>();
    for (const c of dbClarifications || []) {
      if (!map.has(c.submission_id)) {
        map.set(c.submission_id, c);
      }
    }
    return map;
  }, [dbClarifications]);

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
                  <th>Employment / commercials</th>
                  <th>Requirement</th>
                  <th>Recruiter validation</th>
                  <th>
                    <AiScoreHeader />
                  </th>
                  <th>Follow-up / gap action</th>
                  <th>Stage</th>
                  <th>Compliance</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((sub) => {
                  const validation = getOrBuildValidationRecord(sub, null);
                  const dbClarification = clarificationsBySubId.get(sub.id);
                  const isClarificationPending =
                    sub.validation_state === 'pending_clarification' ||
                    dbClarification?.status === 'open' ||
                    validation.follow_up_requests[0]?.status === 'requested';
                  const isResponded =
                    dbClarification?.status === 'responded' ||
                    validation.follow_up_requests[0]?.status === 'responded';
                  const isVerified =
                    dbClarification?.status === 'resolved' ||
                    validation.follow_up_requests[0]?.status === 'verified';

                  return (
                    <tr
                      key={sub.id}
                      onClick={() => setDrawerSubId(sub.id)}
                      className="cursor-pointer"
                    >
                      <td className="font-medium text-[var(--text-primary)]">
                        <div>{sub.candidates?.full_name || sub.candidate_id}</div>
                        {sub.rejection_reason && <div className="text-[12px] text-[var(--status-danger)]">{sub.rejection_reason}</div>}
                        <div className="text-[12px] font-mono text-[var(--text-tertiary)]">
                          JD Match {validation.jd_match_percentage}% · {validation.resume_version_used}
                        </div>
                      </td>
                      <td><CandidateEmploymentSummary candidate={sub.candidates} /></td>
                      <td className="text-[var(--text-secondary)]">
                        <Link
                          to={`/vendor/requirements/${sub.requirement_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-[var(--accent)] hover:underline block font-medium text-[var(--text-primary)] truncate max-w-[280px]"
                          title={`Open requirement details: ${sub.requirements?.title || sub.requirement_id}`}
                        >
                          {sub.requirements?.title || sub.requirement_id}
                        </Link>
                      </td>
                      <td>
                        {(() => {
                          const effectiveDecisionGate: ValidationDecisionStage =
                            sub.stage === 'rejected'
                              ? 'rejected'
                              : sub.stage === 'withdrawn'
                                ? 'withdrawn'
                                : validation.decision_gate;
                          return (
                            <Badge tone={DECISION_GATE_TONES[effectiveDecisionGate]}>
                              {DECISION_GATE_LABELS[effectiveDecisionGate]}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td>
                        <AiScoreCell
                          submissionId={sub.id}
                          summary={aiSummaries?.[sub.id]}
                          viewer="vendor"
                          candidateName={sub.candidates?.full_name || 'Candidate'}
                          roleTitle={sub.requirements?.title}
                        />
                      </td>
                      <td>
                        {sub.stage === 'rejected' || sub.stage === 'withdrawn' ? (
                          <span className="text-[12px] text-[var(--text-tertiary)]">-</span>
                        ) : isClarificationPending ? (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone="amber"
                              className="cursor-pointer hover:opacity-85 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawerSubId(sub.id);
                                setDrawerInitialTab('followup');
                              }}
                              title="Click to view and respond to clarification request"
                            >
                              • Clarification requested
                            </Badge>
                          </div>
                        ) : isResponded ? (
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone="sky"
                              className="cursor-pointer hover:opacity-85 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawerSubId(sub.id);
                                setDrawerInitialTab('followup');
                              }}
                              title="Clarification response submitted - awaiting recruiter review"
                            >
                              Response submitted
                            </Badge>
                          </div>
                        ) : isVerified ? (
                          <div className="flex items-center gap-1.5">
                            <Badge tone="emerald">Verified</Badge>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[var(--text-tertiary)]">No pending requests</span>
                        )}
                      </td>
                      <td>
                        <StageBadge stage={sub.stage} vendorView />
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
        onClose={() => {
          setDrawerSubId(null);
          setDrawerInitialTab(undefined);
        }}
        initialTab={drawerInitialTab}
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

// 8. Vendor Match Requirements Page (/vendor/matches)
export const VendorMatchIntelligencePage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [matchMode, setMatchMode] = useState<'by_candidate' | 'by_requirement'>('by_candidate');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [selectedReqId, setSelectedReqId] = useState<string>('');
  const [candReqSearch, setCandReqSearch] = useState<string>('');

  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [scorecardTarget, setScorecardTarget] = useState<CandidateMatch | null>(null);
  const [submitMatchTarget, setSubmitMatchTarget] = useState<{ match: CandidateMatch; notes: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);

  // Manual candidate modal for "by_requirement" mode
  const [manualCandModalOpen, setManualCandModalOpen] = useState(false);
  const [manualModalCandId, setManualModalCandId] = useState('');
  const [manualModalNotes, setManualModalNotes] = useState('');

  // 1. Fetch all vendor-visible open requirements
  const { data: reqsData, isLoading: loadingReqs } = useQuery({
    queryKey: ['vendor_requirements_for_matches'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 200, status: 'open', forVendor: true }),
  });
  const requirements = useMemo(() => {
    return (reqsData?.data || []).filter((r) => r.status === 'open');
  }, [reqsData?.data]);

  // 2. Fetch all candidates owned by this vendor
  const { data: candsData, isLoading: loadingCands } = useQuery({
    queryKey: ['vendor_candidates_for_matches', profile?.org_id],
    queryFn: () => fetchCandidates({ ownerVendorOrgId: profile?.org_id || undefined, pageSize: 200 }),
    enabled: Boolean(profile?.org_id),
  });
  const candidates = candsData?.data || [];

  // Active selections
  const activeCandId = selectedCandidateId || candidates[0]?.id || '';
  const activeCandidate = candidates.find((c) => c.id === activeCandId) || null;

  const activeReqId = selectedReqId || requirements[0]?.id || '';
  const activeReq = requirements.find((r) => r.id === activeReqId) || null;

  // 3. Fetch submissions for current vendor to track "Already Submitted"
  const { data: allSubmissionsData } = useQuery({
    queryKey: ['vendor_all_submissions_for_matches', profile?.org_id],
    queryFn: () => fetchSubmissions({ vendorOrgId: profile?.org_id || undefined, pageSize: 500 }),
    enabled: Boolean(profile?.org_id),
  });
  const allSubmissions = allSubmissionsData?.data || [];
  const submittedPairSet = useMemo(() => {
    const s = new Set<string>();
    for (const sub of allSubmissions) {
      s.add(`${sub.requirement_id}_${sub.candidate_id}`);
    }
    return s;
  }, [allSubmissions]);

  // Matches for By-Requirement mode (AI ranked)
  const { data: reqMatchesData, isLoading: loadingReqMatches } = useQuery({
    queryKey: ['vendor_match_intelligence', activeReqId],
    queryFn: () => fetchMatchesForRequirement({ requirementId: activeReqId, page: 1 }),
    enabled: Boolean(activeReqId && matchMode === 'by_requirement'),
  });

  // Matches for By-Candidate mode: deterministic real-time matching against all open requirements
  const candidateRequirementMatches = useMemo(() => {
    if (!activeCandidate) return [];
    return requirements
      .filter((r) => {
        if (!candReqSearch.trim()) return true;
        const q = candReqSearch.toLowerCase();
        return (
          r.title.toLowerCase().includes(q) ||
          (r.skills || []).some((sk) => sk.toLowerCase().includes(q)) ||
          r.location.toLowerCase().includes(q)
        );
      })
      .map((r) => buildCandidateMatchRecord(r, activeCandidate))
      .sort((a, b) => b.final_score - a.final_score);
  }, [requirements, activeCandidate, candReqSearch]);

  const handleConfirmSubmit = async () => {
    if (!submitMatchTarget) return;
    setSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: submitMatchTarget.match.requirement_id,
        p_candidate_id: submitMatchTarget.match.candidate_id,
        p_notes: submitMatchTarget.notes.trim() || null,
      });
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

      if (res.status === 'duplicate') {
        setDupReason(res.reason ?? 'Already submitted to this requirement.');
        setSubmitMatchTarget(null);
        return;
      }
      toast({ title: 'Candidate submitted successfully', tone: 'success' });
      setSubmitMatchTarget(null);
      queryClient.invalidateQueries({ queryKey: ['vendor_all_submissions_for_matches'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_req_submissions'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_submissions'] });
    } catch (err) {
      toast({ title: 'Submission failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualModalSubmit = async () => {
    if (!manualModalCandId || !activeReqId) return;
    setSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: activeReqId,
        p_candidate_id: manualModalCandId,
        p_notes: manualModalNotes.trim() || null,
      });
      if (res.status === 'created' && res.auto_rejected) {
        await queryClient.invalidateQueries();
        toast({ title: 'Submission automatically rejected', description: res.rejection_reason || 'Joining availability does not meet this requirement.', tone: 'error' });
        return;
      }

      if (res.status === 'duplicate') {
        setDupReason(res.reason ?? 'Already submitted to this requirement.');
        setManualCandModalOpen(false);
        return;
      }
      toast({ title: 'Candidate submitted successfully', tone: 'success' });
      setManualCandModalOpen(false);
      setManualModalCandId('');
      setManualModalNotes('');
      queryClient.invalidateQueries({ queryKey: ['vendor_all_submissions_for_matches'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_match_intelligence', activeReqId] });
    } catch (err) {
      toast({ title: 'Submission failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Match requirements"
        description="Select any candidate to map directly to open jobs with deterministic fitment scoring and instant submission."
      />

      {/* Mode Selector Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setMatchMode('by_candidate')}
          className={`pb-2.5 px-4 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
            matchMode === 'by_candidate'
              ? 'border-[var(--brand-primary)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          Select candidate → Match to open jobs ({candidates.length})
        </button>
        <button
          type="button"
          onClick={() => setMatchMode('by_requirement')}
          className={`pb-2.5 px-4 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
            matchMode === 'by_requirement'
              ? 'border-[var(--brand-primary)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          Select requirement → View matches ({requirements.length})
        </button>
      </div>

      {/* ── MODE 1: BY CANDIDATE ────────────────────────────────────────────── */}
      {matchMode === 'by_candidate' && (
        <div className="space-y-5">
          {loadingCands ? (
            <TableSkeleton rows={3} cols={4} />
          ) : !candidates.length ? (
            <EmptyState
              title="No candidates in your agency pool yet"
              description="Add candidates to your pool first, then match them to open jobs here."
              actionLabel="Add candidate"
              onAction={() => navigate('/vendor/candidates')}
            />
          ) : (
            <>
              {/* Candidate Selection Bar */}
              <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="w-full sm:w-96">
                    <Select
                      label="Select candidate to map"
                      value={activeCandId}
                      onChange={(e) => setSelectedCandidateId(e.target.value)}
                      options={candidates.map((c) => ({
                        value: c.id,
                        label: `${c.full_name}${c.current_title ? ` · ${c.current_title}` : ''} (${c.total_experience_years ?? 0} yrs · ${c.location || '-'})`,
                      }))}
                    />
                  </div>

                  <div className="w-full sm:w-72">
                    <Input
                      label="Filter open jobs"
                      placeholder="Search title, skill, location…"
                      value={candReqSearch}
                      onChange={(e) => setCandReqSearch(e.target.value)}
                    />
                  </div>
                </div>

                {activeCandidate && (
                  <div className="pt-2 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <div className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">{activeCandidate.full_name}</strong>
                      {activeCandidate.current_title && ` · ${activeCandidate.current_title}`}
                      {` · ${activeCandidate.total_experience_years ?? 0} yrs exp`}
                      {activeCandidate.location && ` · ${activeCandidate.location}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/vendor/candidates/${activeCandidate.id}`)}
                      >
                        View candidate profile →
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Requirements Match List */}
              {loadingReqs ? (
                <TableSkeleton rows={5} cols={4} />
              ) : !candidateRequirementMatches.length ? (
                <EmptyState
                  title="No matching open jobs found"
                  description="Try clearing your search query or check back when new requirements are shared."
                />
              ) : (
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
                  {candidateRequirementMatches.map((m, idx) => {
                    const reqItem = m.requirements;
                    const isSubmitted = submittedPairSet.has(`${m.requirement_id}_${m.candidate_id}`);
                    const budgetInfo = reqItem ? formatRequirementBudgetWithSubtitle(reqItem) : { formatted: '-' };

                    return (
                      <div
                        key={m.id}
                        className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)] w-6">
                              #{idx + 1}
                            </span>
                            <Link
                              to={`/vendor/requirements/${m.requirement_id}`}
                              className="text-[14px] font-semibold text-[var(--text-primary)] hover:underline truncate"
                            >
                              {reqItem?.title || m.requirement_id}
                            </Link>
                            <span className="text-[12px] text-[var(--text-secondary)]">
                              {reqItem?.location || '-'} ({reqItem?.work_mode || '-'}) · {formatExperienceRange(reqItem?.min_experience ?? 0, reqItem?.max_experience ?? 0)}
                            </span>
                            {reqItem?.employment_type === 'full_time' && reqItem.vendor_charge_pct != null && (
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                💰 {reqItem.vendor_charge_pct}% CTC Placement fee
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--text-secondary)]">
                            <span>Vendor budget: <strong className="text-[var(--text-primary)]">{budgetInfo.formatted}</strong></span>
                            <span>•</span>
                            <span>{m.experience_note || `${activeCandidate?.total_experience_years ?? 0} yrs experience`}</span>
                          </div>

                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {(m.matched_skills || []).map((sk) => (
                              <span
                                key={`m-${sk}`}
                                className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]"
                              >
                                ✓ {sk}
                              </span>
                            ))}
                            {(m.unproven_skills || []).map((sk) => (
                              <span
                                key={`u-${sk}`}
                                title="Not verified from candidate profile; recruiter screening will verify"
                                className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]"
                              >
                                ? {sk}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 shrink-0">
                          <ScoreBar score={m.final_score} />

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setScorecardTarget(m)}
                          >
                            Scorecard
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEvidenceTarget(m)}
                          >
                            Evidence
                          </Button>

                          {isSubmitted ? (
                            <Badge tone="success">Submitted</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => setSubmitMatchTarget({ match: m, notes: '' })}
                            >
                              Submit candidate
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── MODE 2: BY REQUIREMENT ─────────────────────────────────────────── */}
      {matchMode === 'by_requirement' && (
        <div className="space-y-5">
          {loadingReqs ? (
            <TableSkeleton rows={4} cols={4} />
          ) : !requirements.length ? (
            <EmptyState
              title="No active requirements available for matching"
              description="Once HQ publishes and shares requirements with your agency, ranked candidate matches will appear here."
            />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="w-full sm:w-96">
                  <Select
                    label="Target requirement"
                    value={activeReqId}
                    onChange={(e) => setSelectedReqId(e.target.value)}
                    options={requirements.map((r) => {
                      const b = formatRequirementBudgetWithSubtitle(r);
                      const feeInfo = r.employment_type === 'full_time' && r.vendor_charge_pct != null ? ` · ${r.vendor_charge_pct}% CTC fee` : '';
                      return {
                        value: r.id,
                        label: `${r.title} (${r.location} · ${b.formatted}${feeInfo})`,
                      };
                    })}
                  />
                </div>

                {activeReq && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setManualCandModalOpen(true)}
                    >
                      + Map candidate manually
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/vendor/requirements/${activeReq.id}`)}
                    >
                      Open requirement →
                    </Button>
                  </div>
                )}
              </div>

              {loadingReqMatches ? (
                <TableSkeleton rows={5} cols={4} />
              ) : !reqMatchesData?.data?.length ? (
                <EmptyState
                  title="No auto-matching candidates for this requirement"
                  description="Use the '+ Map candidate manually' button above to submit any candidate directly from your pool."
                  actionLabel="+ Map candidate manually"
                  onAction={() => setManualCandModalOpen(true)}
                />
              ) : (
                <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
                  {reqMatchesData.data.map((m, idx) => {
                    const isSubmitted = submittedPairSet.has(`${m.requirement_id}_${m.candidate_id}`);
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

                        <div className="flex items-center gap-3 shrink-0">
                          <ScoreBar
                            score={m.final_score}
                            isOverridden={m.override_score !== null}
                          />

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setScorecardTarget(m)}
                          >
                            Scorecard
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEvidenceTarget(m)}
                          >
                            Evidence
                          </Button>

                          {isSubmitted ? (
                            <Badge tone="success">Submitted</Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => setSubmitMatchTarget({ match: m, notes: '' })}
                            >
                              Submit
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
      )}

      {/* ── MODAL: Match Evidence ── */}
      <Dialog
        open={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        title="Match evidence"
        description="Deterministic 4-pillar score breakdown: Skills (40%), Experience (25%), Domain (20%), Seniority (15%)."
        maxWidth="max-w-[700px]"
      >
        {evidenceTarget && <MatchEvidencePanel match={evidenceTarget} />}
      </Dialog>

      {/* ── MODAL: Fitment ScoreCard (View Only for Vendor) ── */}
      {scorecardTarget && scorecardTarget.candidates && scorecardTarget.requirements && (
        <FitmentScoreCard
          open={Boolean(scorecardTarget)}
          onClose={() => setScorecardTarget(null)}
          match={scorecardTarget}
          candidate={scorecardTarget.candidates}
          requirement={scorecardTarget.requirements}
          canDownload={false}
        />
      )}

      {/* ── MODAL: Submit Candidate with Notes ── */}
      <Dialog
        open={Boolean(submitMatchTarget)}
        onClose={() => setSubmitMatchTarget(null)}
        title="Submit candidate to requirement"
        description="Review candidate fitment before submitting."
        maxWidth="max-w-[560px]"
      >
        {submitMatchTarget && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] space-y-1">
              <div>
                <strong>Candidate:</strong> {submitMatchTarget.match.candidates?.full_name || submitMatchTarget.match.candidate_id}
              </div>
              <div>
                <strong>Requirement:</strong> {submitMatchTarget.match.requirements?.title || submitMatchTarget.match.requirement_id}
              </div>
              <div>
                <strong>Fitment Score:</strong> {submitMatchTarget.match.final_score}/100
              </div>
              {submitMatchTarget.match.requirements?.employment_type === 'full_time' &&
                submitMatchTarget.match.requirements?.vendor_charge_pct != null && (
                  <div className="text-emerald-700 font-medium">
                    💰 Placement fee: {submitMatchTarget.match.requirements.vendor_charge_pct}% of CTC
                  </div>
                )}
            </div>

            <Textarea
              label="Submission notes (optional)"
              placeholder="Add key highlights or recruiter notes..."
              rows={3}
              value={submitMatchTarget.notes}
              onChange={(e) =>
                setSubmitMatchTarget((prev) => (prev ? { ...prev, notes: e.target.value } : null))
              }
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSubmitMatchTarget(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={submitting}
                onClick={handleConfirmSubmit}
              >
                Confirm submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── MODAL: Map Candidate Manually in By-Requirement mode ── */}
      <Dialog
        open={manualCandModalOpen}
        onClose={() => setManualCandModalOpen(false)}
        title="Map candidate to this requirement"
        description="Select any candidate from your agency pool to compute fitment and submit."
        maxWidth="max-w-[560px]"
      >
        <div className="space-y-4">
          <Select
            label="Select candidate"
            value={manualModalCandId}
            onChange={(e) => setManualModalCandId(e.target.value)}
            options={[
              { value: '', label: '— Choose a candidate —' },
              ...candidates.map((c) => ({
                value: c.id,
                label: `${c.full_name}${c.current_title ? ` · ${c.current_title}` : ''} (${c.total_experience_years ?? 0} yrs)`,
              })),
            ]}
          />

          {(() => {
            const selCand = candidates.find((c) => c.id === manualModalCandId);
            if (!selCand || !activeReq) return null;
            const previewMatch = buildCandidateMatchRecord(activeReq, selCand);
            return (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text-primary)]">Fitment score</span>
                  <span className="font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    {previewMatch.final_score}/100
                  </span>
                </div>
                <div className="text-[var(--text-secondary)]">
                  {selCand.total_experience_years ?? 0} yrs experience vs {formatExperienceRange(activeReq.min_experience, activeReq.max_experience)} required
                </div>
                {previewMatch.matched_skills.length > 0 && (
                  <div>
                    <span className="text-emerald-700 font-medium">Matched skills: </span>
                    <span>{previewMatch.matched_skills.join(', ')}</span>
                  </div>
                )}
                {activeReq.employment_type === 'full_time' && activeReq.vendor_charge_pct != null && (
                  <div className="text-emerald-700 font-medium pt-1 border-t border-[var(--border)]">
                    💰 Placement fee: {activeReq.vendor_charge_pct}% of CTC
                  </div>
                )}
              </div>
            );
          })()}

          <Textarea
            label="Notes (optional)"
            placeholder="Add any context for the recruiter..."
            rows={3}
            value={manualModalNotes}
            onChange={(e) => setManualModalNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualCandModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!manualModalCandId || submitting}
              loading={submitting}
              onClick={handleManualModalSubmit}
            >
              Submit candidate
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Duplicate Alert Dialog */}
      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />
    </div>
  );
};

// 9. Vendor Interviews Page (/vendor/interviews)
export const VendorInterviewsPage: React.FC = () => {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const querySubmissionId = searchParams.get('submissionId');
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

  React.useEffect(() => {
    if (!querySubmissionId || !data?.data?.some((iv) => iv.submission_id === querySubmissionId)) return;
    setDrawerSubId(querySubmissionId);
  }, [querySubmissionId, data?.data]);

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

