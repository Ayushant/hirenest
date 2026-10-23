import React, { useMemo } from 'react';
import {
  Briefcase,
  Building2,
  Clock,
  FileText,
  MapPin,
  Repeat,
  ArrowDownRight,
  Wallet,
} from 'lucide-react';
import { Badge, EmptyState } from '../ui/kit';
import { SlaBadge } from './DomainBadges';
import { formatRequirementBudgetWithSubtitle } from '../../lib/format';
import type { Requirement, RequirementVendorShare } from '../../types/db';

export type PipelineQuickFilter =
  | 'all'
  | 'active'
  | 'hold'
  | 'remote'
  | 'remote_c2c'
  | 'onsite_fte'
  | 'onsite_contract'
  | 'c2h'
  | 'closed';

export interface PipelineFilterOption {
  id: PipelineQuickFilter;
  label: string;
  dotColor?: string;
  icon?: React.FC<{ className?: string }>;
}

export const PIPELINE_FILTER_OPTIONS: PipelineFilterOption[] = [
  { id: 'all', label: 'All Requirements' },
  { id: 'active', label: 'Active', dotColor: 'bg-emerald-500' },
  { id: 'hold', label: 'Hold', dotColor: 'bg-amber-500' },
  { id: 'remote', label: 'Remote', dotColor: 'bg-sky-400' },
  { id: 'remote_c2c', label: 'Remote C2C', dotColor: 'bg-orange-400' },
  { id: 'onsite_fte', label: 'Onsite FTE', icon: Building2 },
  { id: 'onsite_contract', label: 'Onsite Contract', icon: FileText },
  { id: 'c2h', label: 'C2H', icon: Repeat },
  { id: 'closed', label: 'Closed', dotColor: 'bg-rose-500' },
];

export function matchesPipelineQuickFilter(
  req: Requirement,
  filter: PipelineQuickFilter
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return req.status === 'open' || req.status === 'draft' || req.status === 'pending_approval';
    case 'hold':
      return req.status === 'on_hold';
    case 'remote':
      return req.work_mode === 'remote';
    case 'remote_c2c':
      return (
        req.work_mode === 'remote' &&
        (req.employment_type === 'contract' || req.employment_type === 'contract_to_hire')
      );
    case 'onsite_fte':
      return (
        (req.work_mode === 'onsite' || req.work_mode === 'hybrid') &&
        req.employment_type === 'full_time'
      );
    case 'onsite_contract':
      return (
        (req.work_mode === 'onsite' || req.work_mode === 'hybrid') &&
        req.employment_type === 'contract'
      );
    case 'c2h':
      return req.employment_type === 'contract_to_hire';
    case 'closed':
      return req.status === 'closed' || req.status === 'filled';
    default:
      return true;
  }
}

export const PipelineQuickFilterBar: React.FC<{
  activeFilter: PipelineQuickFilter;
  onChange: (next: PipelineQuickFilter) => void;
  counts?: Partial<Record<PipelineQuickFilter, number>>;
}> = ({ activeFilter, onChange, counts }) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PIPELINE_FILTER_OPTIONS.map((opt) => {
        const isActive = activeFilter === opt.id;
        const Icon = opt.icon;
        const count = counts?.[opt.id];
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`h-7 px-2.5 rounded-[6px] border text-[11px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              isActive
                ? 'border-[#1F4CC4] bg-[#1F4CC4] text-white shadow-2xs'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.dotColor && (
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  isActive ? 'bg-white' : opt.dotColor
                }`}
              />
            )}
            {Icon && (
              <Icon
                className={`h-3 w-3 shrink-0 ${
                  isActive ? 'text-white' : 'text-[var(--text-tertiary)]'
                }`}
              />
            )}
            <span>{opt.label}</span>
            {typeof count === 'number' && count > 0 && (
              <span
                className={`ml-0.5 font-mono tabular-nums text-[10px] ${
                  isActive ? 'text-white/85' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const RequirementsPipelineGrid: React.FC<{
  requirements: Requirement[];
  shares?: RequirementVendorShare[];
  activeFilter: PipelineQuickFilter;
  onFilterChange: (next: PipelineQuickFilter) => void;
  onSelectRequirement: (req: Requirement) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}> = ({
  requirements,
  shares = [],
  activeFilter,
  onFilterChange,
  onSelectRequirement,
  emptyTitle = 'No requirements matching this filter',
  emptyDescription = 'Switch to All Requirements or adjust your search query.',
  emptyActionLabel,
  onEmptyAction,
}) => {
  const counts = useMemo(() => {
    const map: Partial<Record<PipelineQuickFilter, number>> = {};
    for (const opt of PIPELINE_FILTER_OPTIONS) {
      map[opt.id] = requirements.filter((r) => matchesPipelineQuickFilter(r, opt.id)).length;
    }
    return map;
  }, [requirements]);

  const filteredRequirements = useMemo(
    () => requirements.filter((r) => matchesPipelineQuickFilter(r, activeFilter)),
    [requirements, activeFilter]
  );

  return (
    <div className="space-y-4">
      {/* Pipeline Section Header + Right-Aligned Filter Strip */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] leading-[16px] font-bold uppercase tracking-[0.04em] text-[var(--text-primary)]">
            Active Requirements Pipeline
          </h2>
          <span className="rounded-[4px] bg-[var(--bg-subtle)] border border-[var(--border)] px-1.5 py-0.5 font-mono tabular-nums text-[11px] leading-[14px] text-[var(--text-secondary)]">
            {filteredRequirements.length}
          </span>
        </div>

        <PipelineQuickFilterBar
          activeFilter={activeFilter}
          onChange={onFilterChange}
          counts={counts}
        />
      </div>

      {/* 2-Column Pipeline Cards Grid */}
      {filteredRequirements.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredRequirements.map((req) => {
            const budgetInfo = formatRequirementBudgetWithSubtitle(req);
            const share = shares.find((s) => s.requirement_id === req.id);
            const shortId = req.id.replace(/-/g, '').slice(0, 8).toUpperCase();

            const statusBadge =
              req.status === 'on_hold'
                ? { label: '• HOLD', tone: 'amber' as const }
                : req.status === 'closed' || req.status === 'filled'
                  ? { label: '• CLOSED', tone: 'danger' as const }
                  : { label: '• ACTIVE', tone: 'emerald' as const };

            const isDistributed = req.status === 'open' || Boolean(share);

            const expText =
              req.min_experience !== undefined && req.max_experience !== undefined
                ? req.min_experience === req.max_experience
                  ? `${req.min_experience}+ YRS`
                  : `${req.min_experience}-${req.max_experience} YRS`
                : 'NOT SPECIFIED';

            const locationText =
              req.work_mode === 'remote'
                ? 'REMOTE'
                : (req.location || req.work_mode).toUpperCase();

            const budgetText =
              budgetInfo.formatted && budgetInfo.formatted !== '—'
                ? budgetInfo.formatted.toUpperCase()
                : 'COMPETITIVE';

            return (
              <div
                key={req.id}
                onClick={() => onSelectRequirement(req)}
                className="group rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 hover:border-[var(--border-strong)] transition-all cursor-pointer flex flex-col justify-between gap-4"
              >
                {/* Card Top Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center shrink-0 text-[var(--text-secondary)] group-hover:text-[#1F4CC4] transition-colors">
                      <Briefcase className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[14px] leading-[20px] font-bold uppercase tracking-[-0.01em] text-[var(--text-primary)] truncate">
                        {req.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] leading-[14px]">
                        <span className="font-mono text-[var(--text-tertiary)]">
                          ID: {shortId}
                        </span>
                        <span className="rounded-[4px] bg-[#1F4CC4]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[#1F4CC4]">
                          {budgetInfo.isClientMapped ? 'CLIENT / OS' : 'RECRUITER / OS'}
                        </span>
                        {req.employment_type && (
                          <span className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
                            {req.employment_type === 'contract_to_hire'
                              ? 'C2H'
                              : req.employment_type === 'full_time'
                                ? 'FTE'
                                : req.employment_type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Top-Right Status & Distribution Pills */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
                    <span
                      className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 font-mono text-[10px] leading-[14px] font-semibold uppercase tracking-[0.03em] ${
                        isDistributed
                          ? 'border-[#1F4CC4]/25 bg-[#1F4CC4]/10 text-[#1F4CC4]'
                          : 'border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {isDistributed ? '• DISTRIBUTED' : '• UNPUBLISHED'}
                    </span>
                  </div>
                </div>

                {/* Card Bottom Metadata Bar */}
                <div className="pt-3.5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-5 text-[11px] leading-[16px] font-semibold uppercase tracking-[0.02em] text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                      <Clock className="h-3 w-3 text-[var(--text-tertiary)]" />
                      {expText}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-[var(--text-tertiary)]" />
                      {locationText}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[var(--text-primary)]"
                      title={budgetInfo.subtitle || undefined}
                    >
                      <Wallet className="h-3 w-3 text-[var(--text-tertiary)]" />
                      {budgetText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {share?.due_at && <SlaBadge dueAt={share.due_at} />}
                    {share && !share.acknowledged_at && (
                      <Badge tone="warning">Ack needed</Badge>
                    )}
                    <div className="inline-flex items-center gap-0.5 text-[var(--text-tertiary)] group-hover:text-[#1F4CC4] transition-colors">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      <ArrowDownRight className="h-3.5 w-3.5 -ml-1.5 opacity-75" />
                      <ArrowDownRight className="h-3.5 w-3.5 -ml-1.5 opacity-50" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
