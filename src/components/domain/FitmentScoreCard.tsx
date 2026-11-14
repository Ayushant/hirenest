/**
 * FitmentScoreCard.tsx
 *
 * Downloadable (admin/recruiter) / view-only (vendor) candidate fitment scorecard.
 *
 * Shows:
 *  • Candidate name, title, location, experience years
 *  • Matched JD title + min-max exp range + experience gap note
 *  • AI match score breakdown (4 dimensions, weighted total)
 *  • Matched skills  vs  Missed/Unproven skills
 *  • Recruiter screening assessment: re-verified skills, still-missing skills,
 *    recruiter notes, and updated recruiter fitment score
 *  • Download as PNG (uses html2canvas) for admin/recruiter
 *  • Vendor can VIEW but not download
 */
import React, { useRef, useState } from 'react';
import { Download, ShieldCheck, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Badge, Dialog } from '../ui/kit';
import type { CandidateMatch, SubmissionAssessment, Candidate, Requirement } from '../../types/db';
import { formatLocalDate } from '../../lib/format';

// ─── helpers ─────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 80) return '#17734A';
  if (s >= 65) return '#1D5FD1';
  if (s >= 50) return '#D99A2B';
  return '#C0392B';
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = scoreColor(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative flex h-16 w-16 items-center justify-center rounded-full text-white font-bold text-[18px]"
        style={{ background: `conic-gradient(${color} ${score * 3.6}deg, #e5e7eb ${score * 3.6}deg)` }}
      >
        <div className="absolute inset-[6px] rounded-full bg-white flex items-center justify-center">
          <span className="text-[16px] font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-[11px] text-[#6b7280] font-medium">{label}</span>
    </div>
  );
}

function DimBar({ label, score, weight, color }: { label: string; score: number; weight: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="font-medium text-[#374151]">{label} <span className="text-[#9ca3af]">({weight})</span></span>
        <span className="font-mono font-bold" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-[#f3f4f6]">
        <div className="h-2 rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

function SkillChip({ skill, tone }: { skill: string; tone: 'match' | 'miss' | 'verify' }) {
  const styles = {
    match: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    miss: 'bg-red-50 text-red-700 border-red-200',
    verify: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[tone]}`}>
      {tone === 'match' && <CheckCircle2 className="h-3 w-3" />}
      {tone === 'miss' && <XCircle className="h-3 w-3" />}
      {tone === 'verify' && <AlertCircle className="h-3 w-3" />}
      {skill}
    </span>
  );
}

// ─── card body (the printable region) ────────────────────────────────────────

interface ScoreCardBodyProps {
  match: CandidateMatch;
  candidate: Candidate;
  requirement: Requirement;
  assessment: SubmissionAssessment | null;
  generatedAt: string;
  clientName?: string;
}

export const ScoreCardBody = React.forwardRef<HTMLDivElement, ScoreCardBodyProps>(
  ({ match, candidate, requirement, assessment, generatedAt, clientName }, ref) => {
    const skillScore     = Number(match.skill_score     ?? (match.evidence as Record<string,number> | null)?.skill_score ?? 0);
    const expScore       = Number(match.experience_score ?? (match.evidence as Record<string,number> | null)?.experience_score ?? 0);
    const domainScore    = Number(match.domain_score    ?? Math.round(skillScore * 0.65 + expScore * 0.35));
    const seniorityScore = Number(match.seniority_score ?? Math.round(expScore * 0.75 + skillScore * 0.25));

    const aiTotal = Math.round(
      skillScore * 0.40 + expScore * 0.25 + domainScore * 0.20 + seniorityScore * 0.15
    );

    const recruiterTotal = assessment?.recruiter_match_pct ?? null;
    const finalDisplay = match.override_score ?? recruiterTotal ?? aiTotal;
    const finalColor = scoreColor(finalDisplay);

    // experience gap
    const candExp = candidate.total_experience_years ?? 0;
    const jdMin   = requirement.min_experience;
    const jdMax   = requirement.max_experience;
    const expGap  = candExp - jdMin;
    const expGapLabel =
      expGap >= 0
        ? `${expGap.toFixed(1)} yr${Math.abs(expGap) !== 1 ? 's' : ''} above minimum`
        : `${Math.abs(expGap).toFixed(1)} yr${Math.abs(expGap) !== 1 ? 's' : ''} below minimum`;
    const expGapColor = expGap >= 0 ? '#17734A' : '#C0392B';

    const matchedSkills   = match.matched_skills   ?? [];
    const unprovenSkills  = match.unproven_skills  ?? [];

    const recruiterMatched  = assessment?.recruiter_matched_skills  ?? [];
    const recruiterMissing  = assessment?.recruiter_missing_skills  ?? [];
    const recruiterNotes    = assessment?.recruiter_notes   ?? null;
    const reviewedAt        = assessment?.reviewed_at       ?? null;
    const hasScreening      = !!(recruiterMatched.length || recruiterMissing.length || recruiterNotes);

    return (
      <div
        ref={ref}
        className="bg-white text-[#111827] font-sans"
        style={{ width: 740, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', padding: 32 }}
      >
        {/* ── HEADER ── */}
        <div className="flex items-start justify-between border-b-2 border-[#1D5FD1] pb-4 mb-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#1D5FD1] mb-1">
              HireNest Workforce — Candidate Fitment Scorecard
            </div>
            <h1 className="text-[22px] font-bold text-[#111827] leading-tight">
              {candidate.full_name}
            </h1>
            <div className="text-[13px] text-[#6b7280] mt-0.5 space-x-2">
              <span>{candidate.current_title || '—'}</span>
              {candidate.location && <span>· {candidate.location}</span>}
            </div>
          </div>

          {/* Final Score Badge */}
          <div className="flex flex-col items-center gap-1 ml-4">
            <div
              className="h-20 w-20 rounded-full flex items-center justify-center text-white font-bold text-[26px]"
              style={{
                background: `conic-gradient(${finalColor} ${finalDisplay * 3.6}deg, #e5e7eb ${finalDisplay * 3.6}deg)`,
              }}
            >
              <div className="h-[62px] w-[62px] rounded-full bg-white flex items-center justify-center">
                <span className="text-[22px] font-bold" style={{ color: finalColor }}>{finalDisplay}</span>
              </div>
            </div>
            <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wide">
              {match.override_score != null ? 'Override Score' : recruiterTotal != null ? 'Recruiter Score' : 'AI Score'}
            </span>
            <span className="text-[10px] text-[#9ca3af]">out of 100</span>
          </div>
        </div>

        {/* ── JD + EXPERIENCE MATCH ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg bg-[#f8fafc] border border-[#e5e7eb] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1">Matched Requirement</div>
            <div className="text-[14px] font-semibold text-[#111827]">{requirement.title}</div>
            {clientName && <div className="text-[11px] text-[#6b7280] mt-0.5">{clientName}</div>}
            <div className="text-[11px] text-[#6b7280] mt-1">
              {requirement.location} · {requirement.work_mode}
            </div>
          </div>

          <div className="rounded-lg bg-[#f8fafc] border border-[#e5e7eb] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1">Experience</div>
            <div className="flex items-baseline gap-3">
              <div>
                <div className="text-[11px] text-[#6b7280]">JD Required</div>
                <div className="text-[16px] font-bold text-[#111827]">{jdMin}–{jdMax} yrs</div>
              </div>
              <div>
                <div className="text-[11px] text-[#6b7280]">Candidate</div>
                <div className="text-[16px] font-bold text-[#111827]">{candExp} yrs</div>
              </div>
            </div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: expGapColor }}>
              {expGapLabel}
            </div>
            {match.experience_note && (
              <div className="text-[10px] text-[#9ca3af] mt-0.5 italic">{match.experience_note}</div>
            )}
          </div>
        </div>

        {/* ── DIMENSION BREAKDOWN ── */}
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-3">
            AI Score Breakdown · Formula: 0.40×S + 0.25×E + 0.20×D + 0.15×N = {aiTotal}/100
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <DimBar label="Skills"     score={skillScore}     weight="40%" color="#174DB0" />
            <DimBar label="Experience" score={expScore}       weight="25%" color="#2A9D8F" />
            <DimBar label="Domain"     score={domainScore}    weight="20%" color="#1A56C2" />
            <DimBar label="Seniority"  score={seniorityScore} weight="15%" color="#D99A2B" />
          </div>
          <div className="flex justify-end mt-2">
            <div className="text-[12px] font-bold text-[#111827]">
              Weighted Total: <span style={{ color: scoreColor(aiTotal) }}>{aiTotal}/100</span>
            </div>
          </div>
        </div>

        {/* ── MATCHED vs MISSED SKILLS ── */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="rounded-lg border border-[#e5e7eb] p-3">
            <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-widest mb-2">
              ✓ Matched Skills ({matchedSkills.length})
            </div>
            {matchedSkills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {matchedSkills.map((s) => <SkillChip key={s} skill={s} tone="match" />)}
              </div>
            ) : (
              <span className="text-[11px] text-[#9ca3af]">None verified</span>
            )}
          </div>

          <div className="rounded-lg border border-[#e5e7eb] p-3">
            <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-widest mb-2">
              ? Unproven / Missed Skills ({unprovenSkills.length})
            </div>
            {unprovenSkills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {unprovenSkills.map((s) => <SkillChip key={s} skill={s} tone="verify" />)}
              </div>
            ) : (
              <span className="text-[11px] text-[#9ca3af]">All skills verified</span>
            )}
            {unprovenSkills.length > 0 && (
              <p className="text-[10px] text-[#9ca3af] mt-1 italic">
                Not confirmed from resume; recruiter to cross-check in screening round.
              </p>
            )}
          </div>
        </div>

        {/* ── RECRUITER SCREENING ASSESSMENT ── */}
        <div className={`rounded-lg border-2 ${hasScreening ? 'border-[#1D5FD1]' : 'border-dashed border-[#d1d5db]'} p-4 mb-5`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#1D5FD1]" />
              <span className="text-[12px] font-bold text-[#111827] uppercase tracking-wide">
                Recruiter Screening Assessment
              </span>
            </div>
            {hasScreening && recruiterTotal != null && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#6b7280]">Updated Fitment Score:</span>
                <span className="text-[16px] font-bold" style={{ color: scoreColor(recruiterTotal) }}>
                  {recruiterTotal}/100
                </span>
              </div>
            )}
          </div>

          {!hasScreening ? (
            <p className="text-[12px] text-[#9ca3af] italic">
              Recruiter screening not yet completed. Missed skills above will be cross-checked during the screening call.
            </p>
          ) : (
            <div className="space-y-3">
              {recruiterMatched.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-widest mb-1">
                    Skills Verified in Screening ({recruiterMatched.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {recruiterMatched.map((s) => <SkillChip key={s} skill={s} tone="match" />)}
                  </div>
                </div>
              )}

              {recruiterMissing.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-red-700 uppercase tracking-widest mb-1">
                    Still Missing After Screening ({recruiterMissing.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {recruiterMissing.map((s) => <SkillChip key={s} skill={s} tone="miss" />)}
                  </div>
                </div>
              )}

              {recruiterNotes && (
                <div>
                  <div className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest mb-1">
                    Recruiter Notes
                  </div>
                  <p className="text-[12px] text-[#374151] bg-[#f8fafc] rounded p-2 border border-[#e5e7eb]">
                    {recruiterNotes}
                  </p>
                </div>
              )}

              {reviewedAt && (
                <div className="text-[10px] text-[#9ca3af]">
                  Reviewed on {formatLocalDate(reviewedAt)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="border-t border-[#e5e7eb] pt-3 flex justify-between items-center">
          <div className="text-[10px] text-[#9ca3af]">
            Generated {generatedAt} · Engine {match.engine_version || 'v2.2-4d-weighted'}
          </div>
          <div className="text-[10px] text-[#9ca3af]">
            🔒 Confidential · HireNest Workforce Private Limited
          </div>
        </div>
      </div>
    );
  }
);
ScoreCardBody.displayName = 'ScoreCardBody';

// ─── dialog wrapper (the public API) ─────────────────────────────────────────

interface FitmentScoreCardProps {
  open: boolean;
  onClose: () => void;
  match: CandidateMatch;
  candidate: Candidate;
  requirement: Requirement;
  assessment?: SubmissionAssessment | null;
  clientName?: string;
  /** admin or recruiter → can download; vendor → view only */
  canDownload: boolean;
}

export const FitmentScoreCard: React.FC<FitmentScoreCardProps> = ({
  open,
  onClose,
  match,
  candidate,
  requirement,
  assessment = null,
  clientName,
  canDownload,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `HireNest-Fitment-${candidate.full_name.replace(/\s+/g, '_')}-${requirement.title.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      alert('Could not generate image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fitment Scorecard"
      description={
        canDownload
          ? 'Download and share with the client. Includes AI score, dimension breakdown, skill gaps, and recruiter screening assessment.'
          : 'Candidate fitment scorecard — view only. Download available to HireNest recruiters.'
      }
      maxWidth="max-w-[820px]"
    >
      {/* Scrollable preview */}
      <div className="overflow-auto max-h-[70vh] rounded-lg border border-[var(--border)] bg-white shadow-inner">
        <ScoreCardBody
          ref={cardRef}
          match={match}
          candidate={candidate}
          requirement={requirement}
          assessment={assessment}
          generatedAt={generatedAt}
          clientName={clientName}
        />
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-[var(--border)]">
        <div className="text-[12px] text-[var(--text-secondary)]">
          {canDownload
            ? 'Download as PNG to share with the client via email or portal.'
            : '🔒 Download restricted to HireNest recruiters. Contact your account manager to request a copy.'}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {canDownload && (
            <Button
              size="sm"
              loading={downloading}
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Download Scorecard
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
