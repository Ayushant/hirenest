import React from 'react';
import { ScoreBar } from './DomainBadges';
import { formatLocalDateTime } from '../../lib/format';
import type { CandidateMatch } from '../../types/db';

export const MatchEvidencePanel: React.FC<{
  match: CandidateMatch;
  isCandidateView?: boolean;
}> = ({ match, isCandidateView = false }) => {
  const isOverridden =
    match.override_score !== null && match.override_score !== undefined;

  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-3">
      {/* Top row: Final score + component scores */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
            Match score
          </span>
          <ScoreBar score={match.final_score} isOverridden={isOverridden} />
        </div>
        <div className="flex items-center gap-5 text-[12px] leading-[16px]">
          <div>
            <span className="text-[var(--text-secondary)]">Skill: </span>
            <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
              {match.skill_score ?? '—'}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Experience: </span>
            <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
              {match.experience_score ?? '—'}
            </span>
          </div>
          {isOverridden && (
            <div>
              <span className="text-[var(--text-secondary)]">Computed: </span>
              <span className="font-mono tabular-nums text-[var(--text-tertiary)]">
                {match.computed_score}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Single-line Recruiter Override */}
      {isOverridden && (
        <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
          Overridden by recruiter · {match.override_score}
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
                  className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                >
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
        <span>{match.engine_version || 'deterministic-v1'}</span>
        <span>{formatLocalDateTime(match.calculated_at)}</span>
      </div>
    </div>
  );
};
