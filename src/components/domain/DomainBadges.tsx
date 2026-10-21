import React from 'react';
import { parseISO, isAfter } from 'date-fns';
import { AlertCircle, CheckCircle2, Clock, Sparkles, Lock } from 'lucide-react';
import { Badge } from '../ui/kit';
import {
  CANDIDATE_STAGE_LABELS,
  REQUIREMENT_STATUS_LABELS,
  STAGE_LABELS,
  formatSlaCountdown,
} from '../../lib/format';
import type {
  CandidateSource,
  RequirementStatus,
  SubmissionStage,
} from '../../types/db';

// SourceBadge: Vendor · <name> / Direct applicant / HireNest sourced
// Rule 7: Source attribution must always be correct and visible:
// vendor (shows vendor agency name), direct (never show a vendor), internal (HireNest sourced).
export const SourceBadge: React.FC<{
  source: CandidateSource;
  vendorName?: string | null;
}> = ({ source, vendorName }) => {
  if (source === 'vendor') {
    return (
      <Badge tone="indigo">
        Vendor · {vendorName || 'Partner Agency'}
      </Badge>
    );
  }
  if (source === 'direct') {
    return <Badge tone="emerald">Direct applicant</Badge>;
  }
  return <Badge tone="slate">HireNest sourced</Badge>;
};

// StageBadge: one colour per stage
export const StageBadge: React.FC<{
  stage: SubmissionStage;
  candidateView?: boolean;
}> = ({ stage, candidateView = false }) => {
  const label = candidateView ? CANDIDATE_STAGE_LABELS[stage] : STAGE_LABELS[stage];
  const toneMap: Record<SubmissionStage, 'slate' | 'indigo' | 'emerald' | 'amber' | 'red'> = {
    applied: 'slate',
    recruiter_review: 'indigo',
    client_review: 'amber',
    interviewing: 'indigo',
    offered: 'emerald',
    offer_accepted: 'emerald',
    onboarded: 'emerald',
    offer_declined: 'red',
    rejected: 'red',
    withdrawn: 'slate',
  };
  return <Badge tone={toneMap[stage] || 'slate'}>{label}</Badge>;
};

export const RequirementStatusBadge: React.FC<{
  status: RequirementStatus;
}> = ({ status }) => {
  const toneMap: Record<RequirementStatus, 'slate' | 'indigo' | 'emerald' | 'amber' | 'red'> = {
    draft: 'slate',
    pending_approval: 'amber',
    open: 'emerald',
    on_hold: 'amber',
    closed: 'red',
    filled: 'indigo',
  };
  return <Badge tone={toneMap[status]}>{REQUIREMENT_STATUS_LABELS[status]}</Badge>;
};

// SlaBadge: On time / Late / Pending / Missed or live countdown
export const SlaBadge: React.FC<{
  dueAt: string | null | undefined;
  firstSubmissionAt?: string | null;
  revokedAt?: string | null;
  showCountdown?: boolean;
}> = ({ dueAt, firstSubmissionAt, revokedAt, showCountdown = false }) => {
  if (revokedAt) {
    return <Badge tone="slate">Revoked</Badge>;
  }
  if (!dueAt) {
    return <Badge tone="slate">No SLA</Badge>;
  }

  if (firstSubmissionAt) {
    try {
      const subDate = parseISO(firstSubmissionAt);
      const dueDate = parseISO(dueAt);
      const onTime = !isAfter(subDate, dueDate);
      return onTime ? (
        <Badge tone="emerald">
          <CheckCircle2 className="h-3 w-3" />
          On time
        </Badge>
      ) : (
        <Badge tone="red">
          <AlertCircle className="h-3 w-3" />
          Late
        </Badge>
      );
    } catch {
      return <Badge tone="slate">—</Badge>;
    }
  }

  const countdown = formatSlaCountdown(dueAt);
  if (countdown.tone === 'red') {
    return (
      <Badge tone="red">
        <AlertCircle className="h-3 w-3" />
        {showCountdown ? countdown.label : 'Missed'}
      </Badge>
    );
  }

  return (
    <Badge tone={countdown.tone}>
      <Clock className="h-3 w-3" />
      {showCountdown ? countdown.label : 'Pending'}
    </Badge>
  );
};

// ScoreBar (0–100 with the number; never show 0 instead of null)
export const ScoreBar: React.FC<{
  score: number | null | undefined;
  isOverridden?: boolean;
  size?: 'sm' | 'md';
}> = ({ score, isOverridden = false, size = 'md' }) => {
  if (score === null || score === undefined) {
    return <NotEnoughData />;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const barColor =
    clamped >= 75
      ? 'bg-emerald-600 dark:bg-emerald-500'
      : clamped >= 50
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-red-500 dark:bg-red-400';

  return (
    <div className="flex items-center gap-2.5 min-w-[110px]">
      <div
        className={`flex-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden ${
          size === 'sm' ? 'h-1.5' : 'h-2'
        }`}
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
        {clamped}
      </span>
      {isOverridden && (
        <span
          title="Overridden by recruiter"
          className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400"
        >
          Override
        </span>
      )}
    </div>
  );
};

export const NotEnoughData: React.FC<{
  sampleCount?: number;
  minSampleSize?: number;
}> = ({ sampleCount, minSampleSize }) => (
  <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
    Not enough data
    {sampleCount !== undefined && minSampleSize !== undefined
      ? ` (${sampleCount} of ${minSampleSize})`
      : ''}
  </span>
);

// Mandatory AI Attribution Label: "AI suggestion: review before use"
export const AiSuggestionBanner: React.FC<{
  label?: string;
  onDismiss?: () => void;
}> = ({ label = 'AI suggestion: review before use', onDismiss }) => (
  <div className="flex items-center justify-between gap-2 rounded border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-1.5 text-xs text-indigo-800 dark:text-indigo-300">
    <span className="inline-flex items-center gap-1.5 font-medium">
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs underline hover:no-underline cursor-pointer"
      >
        Dismiss
      </button>
    )}
  </div>
);

// Phase 2 Coming Soon Card (AI resume parsing / AI screening via Ollama)
export const Phase2ComingSoonCard: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/50 p-4 flex items-start gap-3">
    <div className="rounded bg-slate-200/80 dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-400 shrink-0">
      <Lock className="h-4 w-4" />
    </div>
    <div>
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        <Badge tone="slate">Coming soon · Phase 2 (Ollama)</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  </div>
);
