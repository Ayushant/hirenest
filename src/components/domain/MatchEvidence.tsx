import React from 'react';
import { Check, HelpCircle, ShieldAlert } from 'lucide-react';
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
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 p-4 space-y-3">
      {/* Top row: Final score + component scores */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-[180px]">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Final Advisory Match Score
          </span>
          <ScoreBar score={match.final_score} isOverridden={isOverridden} />
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Skill Score: </span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {match.skill_score ?? '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Experience Score: </span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {match.experience_score ?? '—'}
            </span>
          </div>
          {isOverridden && (
            <div>
              <span className="text-slate-500 dark:text-slate-400">Computed: </span>
              <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {match.computed_score}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Recruiter Override Banner (Rule 8: Recruiter override wins) */}
      {isOverridden && (
        <div className="rounded border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/80 dark:bg-indigo-950/40 px-3 py-2 flex items-start gap-2 text-xs">
          <ShieldAlert className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-indigo-900 dark:text-indigo-200">
              Overridden by recruiter ({match.override_score}/100)
            </span>
            {match.override_reason && (
              <p className="text-indigo-800 dark:text-indigo-300 mt-0.5">
                Reason: {match.override_reason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Experience Note */}
      {match.experience_note && (
        <p className="text-xs text-slate-700 dark:text-slate-300">
          <span className="font-medium text-slate-500 dark:text-slate-400">
            Experience evaluation:{' '}
          </span>
          {match.experience_note}
        </p>
      )}

      {/* Matched vs Unproven Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div>
          <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Matched Skills ({match.matched_skills?.length || 0})
          </span>
          {match.matched_skills && match.matched_skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {match.matched_skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300"
                >
                  <Check className="h-3 w-3" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-400">None recorded</span>
          )}
        </div>

        <div>
          <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Unproven Skills ({match.unproven_skills?.length || 0})
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
                  className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/40 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400 cursor-help"
                >
                  <HelpCircle className="h-3 w-3 text-slate-400" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-400">All required skills verified</span>
          )}
          {isCandidateView && match.unproven_skills && match.unproven_skills.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Not found on your profile; add it if you have it.
            </p>
          )}
        </div>
      </div>

      {/* Engine metadata footer */}
      <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
        <span>Engine: {match.engine_version || 'deterministic-v1'}</span>
        <span>Calculated: {formatLocalDateTime(match.calculated_at)}</span>
      </div>
    </div>
  );
};
