import React from 'react';
import { parseISO, isAfter } from 'date-fns';
import { Badge, Button, type BadgeTone } from '../ui/kit';
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

// SourceBadge: soft-tint chip ("Vendor · Acme Staffing" in storm-blue, "Direct" in sky, "Admin" in rich-blue)
export const SourceBadge: React.FC<{
  source: CandidateSource;
  vendorName?: string | null;
}> = ({ source, vendorName }) => {
  if (source === 'vendor') {
    return (
      <Badge tone="storm_blue">
        Vendor · {vendorName || 'Partner agency'}
      </Badge>
    );
  }
  if (source === 'direct') {
    return <Badge tone="sky">Direct</Badge>;
  }
  return <Badge tone="rich_blue">Admin</Badge>;
};

export const VendorAssociationBadge: React.FC<{
  vendorName?: string | null;
  originalSource?: CandidateSource | null;
  source?: CandidateSource | null;
}> = ({ vendorName, originalSource, source }) => {
  const effectiveSource = originalSource ?? source;
  if (vendorName) {
    return <Badge tone="storm_blue">{vendorName}</Badge>;
  }
  if (effectiveSource === 'direct') {
    return <Badge tone="sky">Direct</Badge>;
  }
  return <Badge tone="rich_blue">Admin</Badge>;
};

// StageBadge: soft-tint chip + 6px dot
// applied Storm neutral · recruiter_review storm-blue · client_review Rich Blue · interviewing Sky · offered teal · offer_accepted/onboarded success · offer_declined/withdrawn Storm neutral · rejected danger
export const StageBadge: React.FC<{
  stage: SubmissionStage;
  candidateView?: boolean;
}> = ({ stage, candidateView = false }) => {
  const label = candidateView ? CANDIDATE_STAGE_LABELS[stage] : STAGE_LABELS[stage];
  const toneMap: Record<SubmissionStage, BadgeTone> = {
    applied: 'neutral',
    recruiter_review: 'storm_blue',
    client_review: 'rich_blue',
    interviewing: 'sky',
    offered: 'teal',
    offer_accepted: 'success',
    onboarded: 'success',
    offer_declined: 'neutral',
    withdrawn: 'neutral',
    rejected: 'danger',
  };
  return <Badge tone={toneMap[stage] || 'neutral'}>{label}</Badge>;
};

export const RequirementStatusBadge: React.FC<{
  status: RequirementStatus;
}> = ({ status }) => {
  const toneMap: Record<RequirementStatus, BadgeTone> = {
    draft: 'neutral',
    pending_approval: 'warning',
    open: 'rich_blue',
    on_hold: 'warning',
    closed: 'neutral',
    filled: 'success',
  };
  return <Badge tone={toneMap[status]}>{REQUIREMENT_STATUS_LABELS[status]}</Badge>;
};

// SlaBadge: on time = success chip · due within 12h = warning chip with mono timer · overdue = danger chip
export const SlaBadge: React.FC<{
  dueAt: string | null | undefined;
  firstSubmissionAt?: string | null;
  revokedAt?: string | null;
  showCountdown?: boolean;
}> = ({ dueAt, firstSubmissionAt, revokedAt, showCountdown = false }) => {
  if (revokedAt) {
    return <Badge tone="neutral">Revoked</Badge>;
  }
  if (!dueAt) {
    return <Badge tone="neutral">No SLA</Badge>;
  }

  if (firstSubmissionAt) {
    try {
      const subDate = parseISO(firstSubmissionAt);
      const dueDate = parseISO(dueAt);
      const onTime = !isAfter(subDate, dueDate);
      return onTime ? (
        <Badge tone="success">On time</Badge>
      ) : (
        <Badge tone="danger">Late</Badge>
      );
    } catch {
      return <Badge tone="neutral">—</Badge>;
    }
  }

  const countdown = formatSlaCountdown(dueAt);
  if (countdown.tone === 'red') {
    return (
      <Badge tone="danger" className="font-mono tabular-nums">
        {showCountdown ? countdown.label : 'Overdue'}
      </Badge>
    );
  }
  if (countdown.tone === 'amber') {
    return (
      <Badge tone="warning" className="font-mono tabular-nums">
        {countdown.label}
      </Badge>
    );
  }

  return (
    <Badge tone="success" className="font-mono tabular-nums">
      {showCountdown ? countdown.label : 'On time'}
    </Badge>
  );
};

// ScoreBar: 4px bar, track Storm 100, fill Rich Blue 500 (below 40: danger), number in mono
export const ScoreBar: React.FC<{
  score: number | null | undefined;
  isOverridden?: boolean;
  size?: 'sm' | 'md';
}> = ({ score, isOverridden = false }) => {
  if (score === null || score === undefined) {
    return <NotEnoughData />;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const barColor =
    clamped < 40 ? 'bg-[var(--status-danger-dot)]' : 'bg-[#2F63DE]';

  return (
    <div className="inline-flex items-center gap-2 min-w-[96px]">
      <span className="font-mono tabular-nums text-[13px] leading-[20px] font-medium text-[var(--text-primary)] w-7 text-right">
        {clamped}
      </span>
      <div className="w-14 h-1 rounded-[2px] bg-[var(--track)] overflow-hidden shrink-0">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {isOverridden && (
        <span
          title="Overridden by recruiter"
          className="text-[12px] leading-[16px] text-[var(--text-tertiary)]"
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
  <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
    Not enough data
    {sampleCount !== undefined && minSampleSize !== undefined && (
      <span className="ml-1 font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
        ({sampleCount} of {minSampleSize})
      </span>
    )}
  </span>
);

// AI Attribution Header: "Suggestion: review before use" with Use / Dismiss ghost buttons
export const AiSuggestionBanner: React.FC<{
  label?: string;
  onUse?: () => void;
  onDismiss?: () => void;
}> = ({ label = 'Suggestion: review before use', onUse, onDismiss }) => (
  <div className="flex items-center justify-between gap-2 text-[12px] leading-[16px] text-[var(--text-secondary)]">
    <span className="font-medium text-[var(--text-secondary)]">
      {label === 'AI suggestion: review before use' ? 'Suggestion: review before use' : label}
    </span>
    <div className="flex items-center gap-1">
      {onUse && (
        <Button type="button" size="sm" variant="ghost" onClick={onUse}>
          Use
        </Button>
      )}
      {onDismiss && (
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  </div>
);

// Phase 2 Note (Ollama local runtime)
export const Phase2ComingSoonCard: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] px-3 py-2 flex items-baseline justify-between gap-3">
    <div className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
      <span className="font-medium text-[var(--text-primary)]">{title}:</span> {description}
    </div>
    <span className="text-[12px] leading-[16px] font-mono text-[var(--text-tertiary)] shrink-0">
      Phase 2
    </span>
  </div>
);
