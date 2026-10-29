import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ScoreBar } from './DomainBadges';
import { formatLocalDateTime } from '../../lib/format';
import type { CandidateMatch } from '../../types/db';

export const MatchEvidencePanel: React.FC<{
  match: CandidateMatch;
  isCandidateView?: boolean;
}> = ({ match, isCandidateView = false }) => {
  const isOverridden =
    match.override_score !== null && match.override_score !== undefined;

  const evidenceObj = (match.evidence || {}) as Record<string, unknown>;

  const skillScore = Number(match.skill_score ?? evidenceObj.skill_score ?? 0);
  const experienceScore = Number(match.experience_score ?? evidenceObj.experience_score ?? 0);
  const domainScore = Number(
    match.domain_score ??
      evidenceObj.domain_score ??
      Math.round(skillScore * 0.65 + experienceScore * 0.35)
  );
  const seniorityScore = Number(
    match.seniority_score ??
      evidenceObj.seniority_score ??
      Math.round(experienceScore * 0.75 + skillScore * 0.25)
  );

  const skillsContribution = Number((skillScore * 0.4).toFixed(2));
  const experienceContribution = Number((experienceScore * 0.25).toFixed(2));
  const domainContribution = Number((domainScore * 0.2).toFixed(2));
  const seniorityContribution = Number((seniorityScore * 0.15).toFixed(2));

  const weightedTotal = Math.round(
    skillsContribution + experienceContribution + domainContribution + seniorityContribution
  );

  const dimensionRows = [
    {
      key: 'skills',
      title: 'Skills match',
      shortLabel: 'Skills',
      weightPct: '40%',
      score: skillScore,
      contribution: skillsContribution,
      subtitle: 'Required technical skills and evidence of their use',
      barColor: '#2F63DE',
    },
    {
      key: 'experience',
      title: 'Experience match',
      shortLabel: 'Experience',
      weightPct: '25%',
      score: experienceScore,
      contribution: experienceContribution,
      subtitle: 'Relevant years and depth of experience',
      barColor: '#2A9D8F',
    },
    {
      key: 'domain',
      title: 'Domain match',
      shortLabel: 'Domain',
      weightPct: '20%',
      score: domainScore,
      contribution: domainContribution,
      subtitle: 'Industry, business domain and project relevance',
      barColor: '#8B5CF6',
    },
    {
      key: 'seniority',
      title: 'Seniority match',
      shortLabel: 'Seniority',
      weightPct: '15%',
      score: seniorityScore,
      contribution: seniorityContribution,
      subtitle: 'Role level, responsibility and seniority',
      barColor: '#D99A2B',
    },
  ];

  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-4">
      {/* Top row: Final score + 4 dimension badges */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
            Match score
          </span>
          <ScoreBar score={match.final_score} isOverridden={isOverridden} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] leading-[16px]">
          <div>
            <span className="text-[var(--text-secondary)]">Skills (40%): </span>
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {skillScore}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Exp (25%): </span>
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {experienceScore}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Domain (20%): </span>
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {domainScore}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Seniority (15%): </span>
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {seniorityScore}
            </span>
          </div>
        </div>
      </div>

      {/* 4-Dimension Progress Bars Card */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
        {dimensionRows.map((dim) => (
          <div key={dim.key} className="space-y-1">
            <div className="flex items-center justify-between text-[13px] leading-[18px]">
              <span className="font-medium text-[var(--text-primary)]">{dim.title}</span>
              <span className="font-mono tabular-nums text-[12px] font-semibold text-[var(--text-primary)]">
                {dim.score}/100 · <span className="text-[var(--text-secondary)]">{dim.weightPct}</span>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--track)] overflow-hidden">
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, dim.score))}%`,
                  backgroundColor: dim.barColor,
                }}
                className="h-full rounded-full transition-all duration-200"
              />
            </div>
            <p className="text-[11px] leading-[15px] text-[var(--text-tertiary)]">
              {dim.subtitle}
            </p>
          </div>
        ))}
      </div>

      {/* Weighted Calculation Table: Match Score = 0.40S + 0.25E + 0.20D + 0.15N */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-3.5 py-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] leading-[15px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
            Weighted Score Breakdown
          </span>
          <span className="font-mono text-[11px] leading-[15px] text-[var(--text-secondary)]">
            Match Score = 0.40S + 0.25E + 0.20D + 0.15N
          </span>
        </div>
        <table className="w-full text-[12px] leading-[18px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-tertiary)]">
              <th className="py-1.5 px-3.5 text-left font-medium">Dimension</th>
              <th className="py-1.5 px-3.5 text-right font-medium">Score</th>
              <th className="py-1.5 px-3.5 text-right font-medium">Weight</th>
              <th className="py-1.5 px-3.5 text-right font-medium">Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {dimensionRows.map((dim) => (
              <tr key={dim.key}>
                <td className="py-1.5 px-3.5 font-medium text-[var(--text-primary)]">
                  {dim.shortLabel}
                </td>
                <td className="py-1.5 px-3.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                  {dim.score}
                </td>
                <td className="py-1.5 px-3.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                  {dim.weightPct}
                </td>
                <td className="py-1.5 px-3.5 text-right font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {dim.contribution.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--bg-subtle)] font-semibold">
              <td className="py-2 px-3.5 text-[var(--text-primary)]">Total</td>
              <td className="py-2 px-3.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                -
              </td>
              <td className="py-2 px-3.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                100%
              </td>
              <td className="py-2 px-3.5 text-right font-mono tabular-nums text-[var(--accent)]">
                {weightedTotal}/100
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Single-line Recruiter Override */}
      {isOverridden && (
        <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
          Overridden by recruiter · {match.override_score} (computed {weightedTotal}/100)
          {match.override_reason ? ` · '${match.override_reason}'` : ''}
        </p>
      )}

      {/* Experience Note */}
      {match.experience_note && (
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          {match.experience_note}
        </p>
      )}

      {/* Matched vs Unproven Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div>
          <span className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1.5">
            Matched skills ({match.matched_skills?.length || 0})
          </span>
          {match.matched_skills && match.matched_skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {match.matched_skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-[6px] border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                >
                  <CheckCircle2 className="h-3 w-3 text-[#2A9D8F] shrink-0" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              None recorded
            </span>
          )}
        </div>

        <div>
          <span className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1.5">
            Unproven skills ({match.unproven_skills?.length || 0})
          </span>
          {match.unproven_skills && match.unproven_skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {match.unproven_skills.map((skill) => (
                <span
                  key={skill}
                  title={
                    isCandidateView
                      ? 'Not found on your profile; add it if you have it'
                      : 'Not found on profile; not proof the skill is missing'
                  }
                  className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              All required skills verified
            </span>
          )}
          {isCandidateView && match.unproven_skills && match.unproven_skills.length > 0 && (
            <p className="mt-1 text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              Not found on your profile; add it if you have it.
            </p>
          )}
        </div>
      </div>

      {/* Engine metadata footer */}
      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
        <span>{match.engine_version || 'v2.2-4d-weighted'}</span>
        <span>{formatLocalDateTime(match.calculated_at)}</span>
      </div>
    </div>
  );
};
