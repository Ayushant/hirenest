import React from 'react';
import { Badge } from '../ui/kit';
import { NotEnoughData, ScoreBar } from './DomainBadges';
import type { VendorPerformanceResult } from '../../types/db';

const QUALITY_DIMENSION_LABELS: Record<
  keyof VendorPerformanceResult['quality']['dimensions'],
  string
> = {
  jd_skill_alignment: 'JD skill alignment',
  relevant_experience: 'Relevant experience',
  resume_accuracy: 'Resume accuracy & completeness',
  communication: 'Communication & professionalism',
  interview_readiness: 'Interview readiness',
  overall_suitability: 'Overall candidate suitability',
};

export const VendorPerformancePanel: React.FC<{
  performance: VendorPerformanceResult;
  clientSummaryOnly?: boolean;
}> = ({ performance, clientSummaryOnly = false }) => {
  const minSample = performance.min_sample_size ?? 5;
  const { timing, quality, compliance, overall } = performance;

  if (clientSummaryOnly) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 flex items-center justify-between">
        <div>
          <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
            Overall vendor standing
          </h3>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] mt-0.5">
            Composite score across timing, quality, and process compliance.
          </p>
        </div>
        <div>
          {overall.status === 'weights_not_approved' ? (
            <Badge tone="warning">Pending approval</Badge>
          ) : overall.status === 'not_enough_data' || overall.score === null ? (
            <NotEnoughData />
          ) : (
            <ScoreBar score={overall.score} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Three equal columns (Timing #1F4CC4, Quality #4F95DB, Compliance #2A9D8F) + Overall composite */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)]">
        {/* 1. Timing */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[#1F4CC4] shrink-0" />
              <span>Timing</span>
            </span>
            <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {timing.evaluable_shares} of {minSample} samples
            </span>
          </div>
          <div>
            {timing.status === 'not_enough_data' || timing.score === null ? (
              <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">
                Not enough data
              </div>
            ) : (
              <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
                {Math.round(timing.score)}
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">SLA met / evaluable</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {timing.sla_met} / {timing.evaluable_shares}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">90d SLA compliance</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {timing.sla_compliance_90d_pct !== null
                  ? `${timing.sla_compliance_90d_pct}%`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Avg response speed</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {timing.avg_response_hours !== null
                  ? `${timing.avg_response_hours}h`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Avg turnaround</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {timing.avg_turnaround_hours !== null
                  ? `${timing.avg_turnaround_hours}h`
                  : 'Not enough data'}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Quality */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[#4F95DB] shrink-0" />
              <span>Quality</span>
            </span>
            <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {quality.rated_submissions} of {minSample} samples
            </span>
          </div>
          <div>
            {quality.status === 'not_enough_data' || quality.score === null ? (
              <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">
                Not enough data
              </div>
            ) : (
              <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
                {Math.round(quality.score)}
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Rated submissions</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {quality.rated_submissions}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Avg quality (1–5)</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {quality.avg_rating_1_to_5 !== null
                  ? `${quality.avg_rating_1_to_5} / 5`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Avg interview (1–5)</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {quality.avg_interview_overall_1_to_5 !== null
                  ? `${quality.avg_interview_overall_1_to_5} / 5`
                  : 'Not enough data'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Compliance */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[#2A9D8F] shrink-0" />
              <span>Compliance</span>
            </span>
            <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {compliance.submissions} of {minSample} samples
            </span>
          </div>
          <div>
            {compliance.status === 'not_enough_data' || compliance.score === null ? (
              <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">
                Not enough data
              </div>
            ) : (
              <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
                {Math.round(compliance.score)}
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Compliant submissions</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {compliance.compliant} / {compliance.submissions}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Min sample threshold</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {minSample}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Composite */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[#384959] shrink-0" />
              <span>Overall composite</span>
            </span>
            {overall.status === 'weights_not_approved' ? (
              <Badge tone="warning">Pending approval</Badge>
            ) : overall.status === 'not_enough_data' ? (
              <Badge tone="neutral">Not enough data</Badge>
            ) : (
              <Badge tone="success">Approved</Badge>
            )}
          </div>
          <div>
            {overall.status === 'weights_not_approved' ? (
              <div className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-1">
                Platform weights pending admin approval
              </div>
            ) : overall.status === 'not_enough_data' || overall.score === null ? (
              <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">
                Not enough data
              </div>
            ) : (
              <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
                {Math.round(overall.score)}
              </div>
            )}
          </div>
          {overall.weights && (
            <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Weights (T / Q / C)</span>
                <span className="font-mono tabular-nums text-[var(--text-primary)]">
                  {overall.weights.timing}% / {overall.weights.quality}% /{' '}
                  {overall.weights.compliance}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Weights status</span>
                <span className="text-[var(--text-primary)]">
                  {overall.weights.approved ? 'Approved' : 'Unapproved'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Six Quality Dimensions Breakdown */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h4 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] mb-4">
          Quality dimensions (1–5 scale)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
          {(
            Object.keys(QUALITY_DIMENSION_LABELS) as Array<
              keyof VendorPerformanceResult['quality']['dimensions']
            >
          ).map((key) => {
            const val = quality.dimensions?.[key];
            const pct = val !== null && val !== undefined ? Math.round((val / 5) * 100) : null;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 py-1.5 border-b border-[var(--border)]"
              >
                <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  {QUALITY_DIMENSION_LABELS[key]}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {val !== null && val !== undefined ? (
                    <>
                      <span className="font-mono tabular-nums text-[13px] leading-[20px] font-medium text-[var(--text-primary)]">
                        {val} / 5
                      </span>
                      <div className="w-14 h-1 rounded-[2px] bg-[var(--track)] overflow-hidden">
                        <div
                          className="h-full bg-[#2F63DE]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                      Not enough data
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
