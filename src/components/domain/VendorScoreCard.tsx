import React from 'react';
import { Card, Badge } from '../ui/kit';
import { NotEnoughData, ScoreBar } from './DomainBadges';
import type { VendorPerformanceResult } from '../../types/db';

const QUALITY_DIMENSION_LABELS: Record<
  keyof VendorPerformanceResult['quality']['dimensions'],
  string
> = {
  jd_skill_alignment: 'JD Skill Alignment',
  relevant_experience: 'Relevant Experience',
  resume_accuracy: 'Resume Accuracy & Completeness',
  communication: 'Communication & Professionalism',
  interview_readiness: 'Interview Readiness',
  overall_suitability: 'Overall Candidate Suitability',
};

export const VendorPerformancePanel: React.FC<{
  performance: VendorPerformanceResult;
  clientSummaryOnly?: boolean;
}> = ({ performance, clientSummaryOnly = false }) => {
  const minSample = performance.min_sample_size ?? 5;
  const { timing, quality, compliance, overall } = performance;

  if (clientSummaryOnly) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Overall Vendor Standing
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Governed composite score across timing, quality, and process compliance.
            </p>
          </div>
          <div>
            {overall.status === 'weights_not_approved' ? (
              <Badge tone="amber">Pending approval</Badge>
            ) : overall.status === 'not_enough_data' || overall.score === null ? (
              <NotEnoughData />
            ) : (
              <ScoreBar score={overall.score} />
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Timing Score Card */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Submission Timing (SLA)
            </span>
            <Badge tone={timing.status === 'ok' ? 'emerald' : 'slate'}>
              {timing.status === 'ok' ? 'Active' : 'Insufficient Sample'}
            </Badge>
          </div>
          <div>
            {timing.status === 'not_enough_data' || timing.score === null ? (
              <NotEnoughData
                sampleCount={timing.evaluable_shares}
                minSampleSize={minSample}
              />
            ) : (
              <ScoreBar score={timing.score} />
            )}
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">SLA Met / Evaluable:</span>
              <span className="font-mono tabular-nums">
                {timing.sla_met} / {timing.evaluable_shares}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">90d SLA Compliance:</span>
              <span className="font-mono tabular-nums">
                {timing.sla_compliance_90d_pct !== null
                  ? `${timing.sla_compliance_90d_pct}%`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Avg Response Speed:</span>
              <span className="font-mono tabular-nums">
                {timing.avg_response_hours !== null
                  ? `${timing.avg_response_hours}h`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Avg Turnaround:</span>
              <span className="font-mono tabular-nums">
                {timing.avg_turnaround_hours !== null
                  ? `${timing.avg_turnaround_hours}h`
                  : 'Not enough data'}
              </span>
            </div>
          </div>
        </Card>

        {/* 2. Candidate Quality Card */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Candidate Quality
            </span>
            <Badge tone={quality.status === 'ok' ? 'indigo' : 'slate'}>
              {quality.status === 'ok' ? 'Active' : 'Insufficient Sample'}
            </Badge>
          </div>
          <div>
            {quality.status === 'not_enough_data' || quality.score === null ? (
              <NotEnoughData
                sampleCount={quality.rated_submissions}
                minSampleSize={minSample}
              />
            ) : (
              <ScoreBar score={quality.score} />
            )}
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Rated Submissions:</span>
              <span className="font-mono tabular-nums">
                {quality.rated_submissions} (min {minSample})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Avg Quality (1–5):</span>
              <span className="font-mono tabular-nums">
                {quality.avg_rating_1_to_5 !== null
                  ? `${quality.avg_rating_1_to_5} / 5`
                  : 'Not enough data'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Avg Interview (1–5):</span>
              <span className="font-mono tabular-nums">
                {quality.avg_interview_overall_1_to_5 !== null
                  ? `${quality.avg_interview_overall_1_to_5} / 5`
                  : 'Not enough data'}
              </span>
            </div>
          </div>
        </Card>

        {/* 3. Process Compliance Card */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Process Compliance
            </span>
            <Badge tone={compliance.status === 'ok' ? 'emerald' : 'slate'}>
              {compliance.status === 'ok' ? 'Active' : 'Insufficient Sample'}
            </Badge>
          </div>
          <div>
            {compliance.status === 'not_enough_data' || compliance.score === null ? (
              <NotEnoughData
                sampleCount={compliance.submissions}
                minSampleSize={minSample}
              />
            ) : (
              <ScoreBar score={compliance.score} />
            )}
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Compliant Submissions:</span>
              <span className="font-mono tabular-nums">
                {compliance.compliant} / {compliance.submissions}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Min Sample Size:</span>
              <span className="font-mono tabular-nums">{minSample}</span>
            </div>
          </div>
        </Card>

        {/* 4. Overall Score Card */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Overall Composite
            </span>
            {overall.status === 'weights_not_approved' ? (
              <Badge tone="amber">Pending approval</Badge>
            ) : overall.status === 'not_enough_data' ? (
              <Badge tone="slate">Not enough data</Badge>
            ) : (
              <Badge tone="emerald">Approved</Badge>
            )}
          </div>
          <div>
            {overall.status === 'weights_not_approved' ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                Pending approval (Platform weights not yet approved by HQ Admin)
              </p>
            ) : overall.status === 'not_enough_data' || overall.score === null ? (
              <NotEnoughData />
            ) : (
              <ScoreBar score={overall.score} />
            )}
          </div>
          {overall.weights && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Weights (T / Q / C):</span>
                <span className="font-mono tabular-nums">
                  {overall.weights.timing}% / {overall.weights.quality}% /{' '}
                  {overall.weights.compliance}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Weights Status:</span>
                <span>{overall.weights.approved ? 'Approved' : 'Unapproved'}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Six Quality Dimensions Breakdown Bars */}
      <Card className="p-5">
        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Candidate Quality Dimensions (1–5 Scale)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                className="rounded border border-slate-200 dark:border-slate-800 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {QUALITY_DIMENSION_LABELS[key]}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {val !== null && val !== undefined ? `${val} / 5` : 'Not enough data'}
                  </span>
                </div>
                {pct !== null && (
                  <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};
