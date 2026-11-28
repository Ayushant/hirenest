import { CandidateEmploymentPanel } from '../../components/domain/CandidateEmploymentPanel';
import React, { useState, useEffect, useMemo } from 'react';
import { RequirementRibbon } from '../../components/domain/RequirementRibbon';
import { formatExperienceRange } from '../../lib/format';
import { displayClientName } from '../../lib/clientIdentity';
import {
  classifyCandidate,
  classifyRequirement,
  REQUIREMENT_CATEGORY_LABEL,
  type RequirementCategory,
} from '../../lib/requirementCategory';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Briefcase, Wallet, CheckCircle2, ChevronDown, ArrowRight, Compass, FileText, UserRound } from 'lucide-react';
import {
  PageHeader,
  Button,
  Input,
  Badge,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Pagination,
  Dialog,
  Textarea,
  SkillsChipInput,
  MatchScoreRing,
  Avatar,
} from '../../components/ui/kit';
import { StageBadge } from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  fetchMyCandidateProfile,
  fetchCandidateContacts,
  fetchCandidateEvidenceHistory,
  updateCandidateProfile,
  updateCandidateContacts,
  uploadCandidateResume,
  getResumeSignedUrl,
  fetchMatchesForCandidate,
} from '../../api/candidates';
import { fetchRequirements } from '../../api/requirements';
import {
  fetchSubmissions,
  applyToRequirementRpc,
} from '../../api/submissions';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import { recordPrivacyAcknowledgementApi } from '../../lib/dpdpPrivacy';
import { parseRequirementMeta } from '../../lib/enterpriseLifecycle';
import {
  formatLocalDate,
  formatRelativeTime,
  formatRequirementBudgetWithSubtitle,
  CANDIDATE_STAGE_LABELS,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type { CandidateMatch, Requirement } from '../../types/db';

// Section 9 Copy Rule: Use "Job" (not "Requirement") in the candidate view.

// 1. Candidate Jobs for Me Page (with Onboarding Wizard if no candidate profile exists)
export const CandidateJobsForMePage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [filterMode, setFilterMode] = useState<'top' | 'recent' | 'remote' | 'budget'>('top');
  const [expandedMatchIds, setExpandedMatchIds] = useState<Set<string>>(new Set());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<{
    requirementId: string;
    title: string;
    match?: CandidateMatch;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);

  const { data: myCandidate, isLoading: loadingProfile } = useQuery({
    queryKey: ['my_candidate_profile', profile?.id],
    queryFn: () => fetchMyCandidateProfile(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const { data: matchesData, isLoading: loadingMatches } = useQuery({
    queryKey: ['my_candidate_matches', myCandidate?.id, page],
    queryFn: () =>
      fetchMatchesForCandidate({ candidateId: myCandidate!.id, page }),
    enabled: Boolean(myCandidate?.id),
  });

  const { data: myApplications } = useQuery({
    queryKey: ['my_candidate_applications', myCandidate?.id],
    queryFn: () =>
      fetchSubmissions({ candidateId: myCandidate!.id, page: 1, pageSize: 100 }),
    enabled: Boolean(myCandidate?.id),
  });

  const handleConfirmApply = async () => {
    if (!applyTarget) return;
    setApplying(true);
    try {
      const res = await applyToRequirementRpc(applyTarget.requirementId);
      if (res.status === 'duplicate') {
        setDupReason(res.reason || 'You have already applied or been submitted to this job.');
        setApplyTarget(null);
        return;
      }
      toast({
        title: 'Application submitted',
        description: `Applied to ${applyTarget.title}`,
        tone: 'success',
      });
      setApplyTarget(null);
      queryClient.invalidateQueries({ queryKey: ['my_candidate_applications'] });
    } catch (err) {
      toast({
        title: 'Could not submit application',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setApplying(false);
    }
  };

  if (loadingProfile) return <TableSkeleton rows={4} cols={4} />;

  // Section 6.4 Onboarding: if there is no candidate profile, run the "Create my profile" wizard
  if (!myCandidate) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Welcome to HireNestOS"
          description="Complete your candidate profile and upload your resume to discover matched open jobs."
        />
        <div className="py-6 border-y border-[var(--border)] space-y-3 max-w-xl">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Create your candidate profile
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Enter your experience, skills, and upload your resume. If an agency or recruiter
            previously registered your profile, HireNest HQ will link it to your account.
          </p>
          <Button onClick={() => setOnboardingOpen(true)}>
            Create my profile
          </Button>
        </div>

        <CandidateFormModal
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['my_candidate_profile'] });
          }}
          isSelfOnboarding
          defaultEmail={profile?.email || ''}
          defaultName={profile?.full_name || ''}
        />
      </div>
    );
  }

  const appliedByReqId = new Map(
    (myApplications?.data || []).map((s) => [s.requirement_id, s])
  );
  const appliedReqIds = new Set(appliedByReqId.keys());

  const candCategory = classifyCandidate(myCandidate);
  const candidatePd = (myCandidate?.parsed_data || {}) as Record<string, unknown>;
  const openToContract = Boolean(candidatePd.open_to_contract);
  const candidateSkills = Array.isArray(myCandidate?.skills) ? myCandidate.skills : [];

  const eligibleMatches = useMemo(() => {
    const list = matchesData?.data ? [...matchesData.data] : [];
    return list.filter((m) => {
      const job = m.requirements;
      if (!job) return false;
      // 1. Employment type: only FTE unless candidate explicitly opened to contract
      if (!openToContract && job.employment_type !== 'full_time') {
        return false;
      }
      // 2. IT vs Non-IT: candidate only sees jobs in their domain track
      if (classifyRequirement(job) !== candCategory) {
        return false;
      }
      return true;
    });
  }, [matchesData?.data, openToContract, candCategory]);

  const sortedMatches = useMemo(() => {
    const list = [...eligibleMatches];
    if (filterMode === 'recent') {
      list.sort(
        (a, b) =>
          new Date(b.requirements?.created_at || 0).getTime() -
          new Date(a.requirements?.created_at || 0).getTime()
      );
    } else if (filterMode === 'remote') {
      return list.filter((m) => m.requirements?.work_mode === 'remote');
    } else if (filterMode === 'budget') {
      list.sort(
        (a, b) =>
          (b.requirements?.vendor_visible_budget || 0) -
          (a.requirements?.vendor_visible_budget || 0)
      );
    } else {
      list.sort((a, b) => b.final_score - a.final_score);
    }
    return list;
  }, [eligibleMatches, filterMode]);

  // Profile completeness: real signal from fields actually captured on the candidate record.
  const completenessFields: Array<[string, boolean]> = [
    ['Experience', Boolean(myCandidate?.total_experience_years)],
    ['Relevant experience', myCandidate?.parsed_data?.relevant_experience_years != null],
    ['Current title', Boolean(myCandidate?.current_title)],
    ['Location', Boolean(myCandidate?.location)],
    ['Skills', candidateSkills.length > 0],
    ['Summary', Boolean(myCandidate?.summary)],
    ['Resume', Boolean(myCandidate?.resume_path)],
  ];
  const completenessPct = Math.round(
    (completenessFields.filter(([, ok]) => ok).length / completenessFields.length) * 100
  );
  const topMatch = sortedMatches[0];
  const firstName = (myCandidate.full_name || profile?.full_name || 'there').trim().split(/\s+/)[0];

  return (
    <div>
      <section className="mb-6 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="relative bg-[var(--sidebar-bg)] px-5 py-6 text-[var(--sidebar-text)] sm:px-7 sm:py-8">
          <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-[#1D5FD1]/20 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#B9D1FB]">Your opportunity hub</p>
              <h1 className="font-[var(--font-display)] text-[26px] font-semibold tracking-tight text-[#FFFEFB] sm:text-[32px]">Find your next move, {firstName}</h1>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--sidebar-muted)]">
                Explore jobs matched to your experience, see why they fit, and keep every application in view.
              </p>
            </div>
            <Link to="/candidate/browse" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-[#FFFEFB] px-4 text-[12px] font-semibold text-[#14213D] transition-colors hover:bg-[#EEF4FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8AB3F6]">
              Browse all jobs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 divide-y divide-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Link to="/candidate/profile" className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-subtle)] sm:px-6">
            <span className="rounded-[10px] bg-[#EEF4FF] p-2 text-[#1D5FD1]"><UserRound className="h-4 w-4" /></span>
            <span><span className="block text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{completenessPct}%</span><span className="text-[11px] text-[var(--text-secondary)]">Profile complete</span></span>
            <ArrowRight className="ml-auto h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-1" />
          </Link>
          <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
            <span className="rounded-[10px] bg-[#EEF4FF] p-2 text-[#1D5FD1]"><Compass className="h-4 w-4" /></span>
            <span><span className="block text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{matchesData?.count ?? 0}</span><span className="text-[11px] text-[var(--text-secondary)]">Matched jobs</span></span>
          </div>
          <Link to="/candidate/applications" className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-subtle)] sm:px-6">
            <span className="rounded-[10px] bg-[#EEF4FF] p-2 text-[#1D5FD1]"><FileText className="h-4 w-4" /></span>
            <span><span className="block text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{myApplications?.data.length ?? 0}</span><span className="text-[11px] text-[var(--text-secondary)]">Recent applications</span></span>
            <ArrowRight className="ml-auto h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">Jobs for me</h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Ranked by how well each job aligns with your profile.</p>
        </div>
        <Link to="/candidate/applications" className="text-[12px] font-medium text-[var(--primary-bg)] hover:underline">View my applications →</Link>
      </div>

      {/* Feed Scope Banner: IT/Non-IT & Contract Scope */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[var(--text-primary)]">Feed scope:</span>
          <Badge tone={candCategory === 'it' ? 'rich_blue' : 'neutral'}>
            {REQUIREMENT_CATEGORY_LABEL[candCategory]} Track
          </Badge>
          <Badge tone={openToContract ? 'amber' : 'emerald'}>
            {openToContract ? 'FTE + Contract (C2C/C2H)' : 'FTE Only'}
          </Badge>
          <span className="text-[var(--text-secondary)]">
            {openToContract
              ? 'Showing Full-Time and Contract active jobs'
              : 'Showing Full-Time (FTE) jobs only'}
          </span>
        </div>
        <Link
          to="/candidate/profile"
          className="text-[#1D5FD1] hover:underline font-medium text-[11px]"
        >
          Manage contract &amp; track preferences →
        </Link>
      </div>

      {loadingMatches ? (
        <TableSkeleton rows={5} cols={4} />
      ) : !matchesData?.data?.length ? (
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <EmptyState title="No matched jobs yet" description="Add your latest skills and experience to improve your matches, or explore every open job." />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link to="/candidate/profile" className="inline-flex min-h-9 items-center rounded-[7px] border border-[var(--border-strong)] px-3 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Update profile</Link>
            <Link to="/candidate/browse" className="inline-flex min-h-9 items-center rounded-[7px] bg-[var(--primary-bg)] px-3 text-[12px] font-semibold text-[var(--primary-text)] hover:bg-[var(--primary-hover)]">Browse all jobs</Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['top', 'Top matches'],
                  ['recent', 'Recently added'],
                  ['remote', 'Remote only'],
                  ['budget', 'Highest compensation'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterMode(key)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    filterMode === key
                      ? 'bg-[var(--primary-bg)] text-white border-transparent'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-[var(--text-tertiary)] whitespace-nowrap">
              {sortedMatches.length} ranked job{sortedMatches.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-4">
            {sortedMatches.map((m, idx) => {
              const job = m.requirements;
              const isApplied = appliedReqIds.has(m.requirement_id);
              const application = appliedByReqId.get(m.requirement_id);
              const score = m.final_score;
              const fitLabel =
                score >= 90 ? 'Exceptional fit' : score >= 80 ? 'Strong match' : score >= 70 ? 'Good fit' : 'Potential match';
              const isTopRank = idx === 0 && filterMode === 'top';
              const budgetInfo = job ? formatRequirementBudgetWithSubtitle(job) : null;
              const keySkills = m.matched_skills?.length ? m.matched_skills : job?.skills || [];
              const isExpanded = expandedMatchIds.has(m.id);
              return (
                <article
                  key={m.id}
                  className={`rounded-[14px] border bg-[var(--surface)] p-5 sm:p-6 transition-colors ${
                    isTopRank ? 'border-[var(--primary-bg)]/40' : 'border-[var(--border)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-3.5">
                    <span className="font-mono tabular-nums text-[11px] text-[var(--text-tertiary)]">
                      #{idx + 1}
                    </span>
                    {isTopRank && <Badge tone="emerald">Top match</Badge>}
                    {job?.created_at && (
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        Posted {formatRelativeTime(job.created_at)}
                      </span>
                    )}
                    {job?.id && (
                      <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                        #{job.id.slice(0, 8).toUpperCase()}
                      </span>
                    )}
                    {isApplied && application && (
                      <Badge tone="success">
                        {CANDIDATE_STAGE_LABELS[application.stage]} · {formatRelativeTime(application.created_at)}
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <Avatar name={displayClientName(job?.organizations, 'candidate', job?.client_org_id)} />
                        <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate">
                          {displayClientName(job?.organizations, 'candidate', job?.client_org_id)}
                        </span>
                      </div>
                      {job && <RequirementRibbon requirement={job} />}
                      <h3 className="text-[16px] font-semibold text-[var(--text-primary)] leading-tight">
                        {job?.title || 'Open job'}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)]">
                          <MapPin className="h-3 w-3 text-[var(--text-tertiary)]" />
                          {job?.location || '-'} · <span className="capitalize">{job?.work_mode || '-'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-secondary)]">
                          <Briefcase className="h-3 w-3 text-[var(--text-tertiary)]" />
                          {formatExperienceRange(job?.min_experience ?? 0, job?.max_experience)}
                        </span>
                        {budgetInfo?.formatted && budgetInfo.formatted !== '-' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-[var(--status-success-bg)] border border-[var(--status-success-dot)]/20 text-[11px] font-medium text-[var(--status-success)]">
                            <Wallet className="h-3 w-3" />
                            {budgetInfo.formatted}
                          </span>
                        )}
                      </div>
                      {keySkills.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-3">
                          <span className="text-[11px] font-medium text-[var(--text-tertiary)] mr-0.5">
                            {m.matched_skills?.length ? 'Matched skills:' : 'Skills:'}
                          </span>
                          {keySkills.slice(0, 6).map((skill) => (
                            <span
                              key={skill}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-[6px] bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border)]"
                            >
                              {m.matched_skills?.length ? (
                                <CheckCircle2 className="h-3 w-3 text-[var(--status-success-dot)]" />
                              ) : null}
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-row sm:flex-col items-center gap-2 shrink-0 self-start">
                      <MatchScoreRing score={score} />
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] text-center whitespace-nowrap">
                        {fitLabel}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-[var(--border)] flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMatchIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      {isExpanded ? 'Hide match breakdown' : 'See match breakdown'}
                    </button>

                    {isApplied ? (
                      <Button size="sm" variant="outline" disabled>
                        Applied
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          setApplyTarget({
                            requirementId: m.requirement_id,
                            title: job?.title || 'Job',
                            match: m,
                          })
                        }
                      >
                        Apply to job
                      </Button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-3.5">
                      <MatchEvidencePanel match={m} isCandidateView />
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <Pagination
            page={page}
            totalCount={matchesData?.count ?? 0}
            onPageChange={setPage}
          />
        </div>

        <aside className="lg:col-span-4 space-y-4">
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-[var(--sidebar-muted)]">
                Candidate profile
              </span>
              <span className="font-mono text-[11px] text-[var(--sidebar-muted)]">
                #{myCandidate?.id ? myCandidate.id.slice(0, 8).toUpperCase() : 'PROFILE'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Avatar name={myCandidate?.full_name || 'Candidate'} />
              <div className="min-w-0">
                <p className="text-[14px] font-medium truncate">{myCandidate?.full_name || 'Candidate'}</p>
                <p className="text-[12px] text-[var(--sidebar-muted)] truncate">
                  {myCandidate?.current_title || 'Title not set'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--sidebar-muted)]">Profile completeness</span>
                <span className="font-mono tabular-nums">{completenessPct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full brand-gradient-bg"
                  style={{ width: `${completenessPct}%` }}
                />
              </div>
              {completenessPct < 100 && (
                <p className="text-[11px] text-[var(--sidebar-muted)]">
                  Missing: {completenessFields.filter(([, ok]) => !ok).map(([f]) => f).join(', ')}
                </p>
              )}
            </div>
            {topMatch && (
              <div className="pt-2 border-t border-white/10 space-y-1">
                <p className="text-[11px] text-[var(--sidebar-muted)]">Best current match</p>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium truncate pr-2">
                    {topMatch.requirements?.title || 'Open job'}
                  </span>
                  <span className="font-mono tabular-nums text-[13px] shrink-0">
                    {Math.round(Number(topMatch.final_score || 0))}%
                  </span>
                </div>
              </div>
            )}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-[var(--sidebar-muted)]">
              <span>{sortedMatches.length} ranked job{sortedMatches.length === 1 ? '' : 's'}</span>
              <span>Profile updated {formatRelativeTime(myCandidate?.updated_at)}</span>
            </div>
          </div>

          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] p-4 space-y-3">
            <p className="text-[13px] font-medium text-white">How your match score works</p>
            <p className="text-[12px] text-[var(--sidebar-muted)] leading-relaxed">
              Every score is computed the same way for every job: skill overlap (40%), experience fit (25%),
              domain relevance (20%) and seniority alignment (15%). Open any job below to see the exact breakdown.
            </p>
            <div className="pt-2.5 border-t border-white/10 space-y-2 text-[12px] text-[var(--sidebar-text)]">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#8AB3F6] shrink-0 mt-0.5" />
                <span>No gender or identity fields are stored or used in scoring.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#8AB3F6] shrink-0 mt-0.5" />
                <span>Your data stays scoped to HireNest HQ under DPDP Notice HN-DPDP-NOTICE-2026-V2.</span>
              </div>
            </div>
          </div>

          {candidateSkills.length > 0 && (
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
              <p className="text-[13px] font-medium text-[var(--text-primary)]">Your tracked skills</p>
              <div className="flex flex-wrap gap-1.5">
                {candidateSkills.slice(0, 12).map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-0.5 text-[11px] font-mono rounded bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border)]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
              <Link to="/candidate/profile" className="text-[12px] text-[var(--primary-bg)] hover:underline inline-block">
                Update skills on My profile
              </Link>
            </div>
          )}
        </aside>
        </div>
      )}

      {/* Apply Confirmation Dialog */}
      <Dialog
        open={Boolean(applyTarget)}
        onClose={() => setApplyTarget(null)}
        title={`Apply to ${applyTarget?.title || 'job'}`}
        description="Confirming creates an active application in the HireNestOS recruitment pipeline."
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            Your profile and resume will be submitted directly to HireNest Recruiters as a{' '}
            <strong className="text-[var(--text-primary)]">Direct</strong> applicant.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApplyTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmApply} loading={applying}>
              Confirm application
            </Button>
          </div>
        </div>
      </Dialog>

      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />
    </div>
  );
};

// 2. Browse All Open Jobs Page (/candidate/browse)
export const CandidateBrowseJobsPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedJob, setSelectedJob] = useState<Requirement | null>(null);
  const [applying, setApplying] = useState(false);

  const { data: myCandidate } = useQuery({
    queryKey: ['my_candidate_profile', profile?.id],
    queryFn: () => fetchMyCandidateProfile(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const { data: myApplications } = useQuery({
    queryKey: ['my_candidate_applications', myCandidate?.id],
    queryFn: () =>
      fetchSubmissions({ candidateId: myCandidate!.id, page: 1, pageSize: 100 }),
    enabled: Boolean(myCandidate?.id),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public_open_jobs', page, search],
    queryFn: () =>
      fetchRequirements({
        page,
        pageSize: 100,
        status: 'open',
        isPublic: true,
        search,
      }),
  });

  const appliedReqIds = new Set(
    (myApplications?.data || []).map((s) => s.requirement_id)
  );

  const candCategory = classifyCandidate(myCandidate);
  const candidatePd = (myCandidate?.parsed_data || {}) as Record<string, unknown>;
  const openToContract = Boolean(candidatePd.open_to_contract);

  // Browse filters: defaults to candidate's own track and contract preference
  const [categoryFilter, setCategoryFilter] = useState<'auto' | 'it' | 'non_it' | 'all'>('auto');
  const effectiveCategory = categoryFilter === 'auto' ? candCategory : categoryFilter;

  const [contractFilter, setContractFilter] = useState<'auto' | 'fte_only' | 'all'>('auto');
  const effectiveContract = contractFilter === 'auto' ? (openToContract ? 'all' : 'fte_only') : contractFilter;

  const filteredJobs = useMemo(() => {
    const list = data?.data || [];
    return list.filter((job) => {
      // 1. Employment type: only FTE unless candidate has contract jobs enabled
      if (effectiveContract === 'fte_only' && job.employment_type !== 'full_time') {
        return false;
      }
      // 2. IT vs Non-IT: only show jobs in candidate's domain track
      if (effectiveCategory !== 'all' && classifyRequirement(job) !== effectiveCategory) {
        return false;
      }
      return true;
    });
  }, [data?.data, effectiveContract, effectiveCategory]);

  const handleApply = async () => {
    if (!selectedJob) return;
    setApplying(true);
    try {
      const res = await applyToRequirementRpc(selectedJob.id);
      if (res.status === 'duplicate') {
        toast({
          title: 'Already applied or submitted',
          description: res.reason || 'A submission already exists for this job.',
          tone: 'info',
        });
        setSelectedJob(null);
        return;
      }
      toast({
        title: 'Application submitted',
        description: selectedJob.title,
        tone: 'success',
      });
      setSelectedJob(null);
      queryClient.invalidateQueries({ queryKey: ['my_candidate_applications'] });
    } catch (err) {
      toast({
        title: 'Application failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Browse all open jobs"
        description="Explore public jobs at HireNest partner companies and find the right next step."
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full max-w-md items-center gap-3">
          <Input
            aria-label="Search jobs by title"
            placeholder="Search by job title"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search && (
            <Button size="sm" variant="ghost" onClick={() => setSearch('')}>
              Clear
            </Button>
          )}
        </div>
        <span className="text-[12px] text-[var(--text-secondary)]">{filteredJobs.length} job{filteredJobs.length === 1 ? '' : 's'} on this page</span>
      </div>

      {/* Scope and Track Filter Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-3">
          {/* Track Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[var(--text-secondary)]">Track:</span>
            <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
              <button
                type="button"
                onClick={() => setCategoryFilter('it')}
                aria-pressed={effectiveCategory === 'it'}
                className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                  effectiveCategory === 'it'
                    ? 'bg-[#1D5FD1] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                IT
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('non_it')}
                aria-pressed={effectiveCategory === 'non_it'}
                className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                  effectiveCategory === 'non_it'
                    ? 'bg-[#1D5FD1] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Non-IT
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                aria-pressed={effectiveCategory === 'all'}
                className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                  categoryFilter === 'all'
                    ? 'bg-[#1D5FD1] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                All
              </button>
            </div>
          </div>

          {/* Contract / Employment Filter */}
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[var(--text-secondary)]">Type:</span>
            <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
              <button
                type="button"
                onClick={() => setContractFilter('fte_only')}
                aria-pressed={effectiveContract === 'fte_only'}
                className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                  effectiveContract === 'fte_only'
                    ? 'bg-[#1D5FD1] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Full-time only
              </button>
              <button
                type="button"
                onClick={() => setContractFilter('all')}
                aria-pressed={effectiveContract === 'all'}
                className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                  effectiveContract === 'all'
                    ? 'bg-[#1D5FD1] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Include contracts
              </button>
            </div>
          </div>
        </div>

        <Link
          to="/candidate/profile"
          className="text-[#1D5FD1] hover:underline font-medium text-[11px]"
        >
          Manage profile preferences →
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !filteredJobs.length ? (
        <EmptyState
          title="No open jobs match your current filters"
          description={
            effectiveContract === 'fte_only'
              ? `No active Full-Time (FTE) ${effectiveCategory === 'all' ? '' : REQUIREMENT_CATEGORY_LABEL[effectiveCategory] + ' '}jobs found. Check back soon or enable contract jobs in your profile.`
              : 'No active jobs found for the selected track.'
          }
        />
      ) : (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredJobs.map((job) => {
              const isApplied = appliedReqIds.has(job.id);
              const jobCategory = classifyRequirement(job);
              const budget = formatRequirementBudgetWithSubtitle(job);
              return (
                <article key={job.id} className="flex h-full flex-col rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--border-strong)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            jobCategory === 'it'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-purple-50 text-purple-700 border-purple-200'
                          }`}
                        >
                          {REQUIREMENT_CATEGORY_LABEL[jobCategory]}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                          {job.employment_type === 'full_time' ? 'FTE (Full-Time)' : job.employment_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <RequirementRibbon requirement={job} />
                      <h3 className="mt-1 text-[16px] font-semibold leading-snug text-[var(--text-primary)]">
                        {job.title}
                      </h3>
                      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                        {displayClientName(job.organizations, 'candidate', job.client_org_id)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.location || 'Location flexible'} · <span className="capitalize">{job.work_mode || 'On-site'}</span></span>
                    <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{formatExperienceRange(job.min_experience, job.max_experience)}</span>
                    {budget.formatted && budget.formatted !== '-' && <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />{budget.formatted}</span>}
                  </div>
                  <p className="mt-4 line-clamp-3 text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
                    {job.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5 pb-4">
                    {job.skills.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                      >
                        {s}
                      </span>
                    ))}
                    {job.skills.length > 5 && <span className="px-1 py-0.5 text-[11px] text-[var(--text-tertiary)]">+{job.skills.length - 5} more</span>}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
                    <span className="text-[11px] text-[var(--text-tertiary)]">{job.created_at ? `Posted ${formatRelativeTime(job.created_at)}` : 'Open job'}</span>
                    {isApplied ? <Badge tone="success">Applied</Badge> : <Button size="sm" onClick={() => setSelectedJob(job)}>Apply now</Button>}
                  </div>
                </article>
              );
            })}
          </div>

          <Pagination page={page} totalCount={filteredJobs.length} onPageChange={setPage} />
        </div>
      )}

      <Dialog
        open={Boolean(selectedJob)}
        onClose={() => setSelectedJob(null)}
        title={selectedJob ? `Apply to ${selectedJob.title}` : 'Apply to job'}
      >
        {selectedJob && (() => {
          const jobMeta = parseRequirementMeta(selectedJob);
          return (
            <div className="space-y-4">
              {jobMeta.notes && (
                <div className="rounded-[8px] border border-blue-500/30 bg-blue-500/5 p-3 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                    Important Instructions &amp; Requirements
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--text-primary)] whitespace-pre-line">
                    {jobMeta.notes}
                  </p>
                </div>
              )}
              <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-line max-h-60 overflow-y-auto">
                {selectedJob.description}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedJob(null)}>
                  Cancel
                </Button>
                <Button onClick={handleApply} loading={applying}>
                  Confirm application
                </Button>
              </div>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
};

// 3. Candidate My Applications Page (/candidate/applications)
export const CandidateApplicationsPage: React.FC = () => {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data: myCandidate } = useQuery({
    queryKey: ['my_candidate_profile', profile?.id],
    queryFn: () => fetchMyCandidateProfile(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my_applications_list', myCandidate?.id, page],
    queryFn: () =>
      fetchSubmissions({ candidateId: myCandidate!.id, page }),
    enabled: Boolean(myCandidate?.id),
  });

  return (
    <div>
      <PageHeader
        title="My applications"
        description="Track your application stages, view scheduled interviews, or withdraw an application."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="rounded-[9px] bg-[#EEF4FF] p-2 text-[#1D5FD1]"><FileText className="h-4 w-4" /></span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Your application tracker</p>
            <p className="text-[11px] text-[var(--text-secondary)]">{data?.count ?? 0} application{data?.count === 1 ? '' : 's'} submitted</p>
          </div>
        </div>
        <Link to="/candidate/browse" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--primary-bg)] hover:underline">
          Explore jobs <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No applications submitted yet"
          description="Explore Jobs for me or Browse all open jobs to apply."
        />
      ) : (
        <div>
          <div className="space-y-3 sm:hidden">
            {data.data.map((sub) => (
              <article key={sub.id} className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
                {sub.requirements && <RequirementRibbon requirement={sub.requirements} />}
                <h2 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">{sub.requirements?.title || 'Job'}</h2>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <StageBadge stage={sub.stage} candidateView />
                  <span className="text-[11px] text-[var(--text-secondary)]">Applied {formatLocalDate(sub.created_at)}</span>
                </div>
                <button type="button" onClick={() => setDrawerSubId(sub.id)} className="mt-4 flex min-h-10 w-full items-center justify-between border-t border-[var(--border)] pt-3 text-[12px] font-semibold text-[var(--primary-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-border)]">
                  View timeline <ArrowRight className="h-4 w-4" />
                </button>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] sm:block">
            <table>
              <thead>
                <tr>
                  <th>Job title</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => setDrawerSubId(sub.id)}
                    className="cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
                  >
                    <td className="font-medium text-[var(--text-primary)]">
                      {sub.requirements && <RequirementRibbon requirement={sub.requirements} />}
                      <div>{sub.requirements?.title || 'Job'}</div>
                    </td>
                    <td>
                      <StageBadge stage={sub.stage} candidateView />
                    </td>
                    <td className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatLocalDate(sub.created_at)}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost">
                        Timeline
                      </Button>
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
        role="candidate"
      />
    </div>
  );
};

// 4. Candidate My Profile Page (/candidate/profile)
export const CandidateProfilePage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: myCandidate, isLoading } = useQuery({
    queryKey: ['my_candidate_profile', profile?.id],
    queryFn: () => fetchMyCandidateProfile(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const { data: contacts } = useQuery({
    queryKey: ['my_candidate_contacts', myCandidate?.id],
    queryFn: () => fetchCandidateContacts(myCandidate!.id),
    enabled: Boolean(myCandidate?.id),
  });

  const { data: evidenceHistory = [] } = useQuery({
    queryKey: ['my_candidate_evidence_history', myCandidate?.id],
    queryFn: () => fetchCandidateEvidenceHistory(myCandidate!.id),
    enabled: Boolean(myCandidate?.id),
  });

  const [fullName, setFullName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [location, setLocation] = useState('');
  const [expYears, setExpYears] = useState('0');
  const [relevantExpYears, setRelevantExpYears] = useState('');
  const [experienceError, setExperienceError] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [openToContract, setOpenToContract] = useState<boolean>(false);
  const [domainCategory, setDomainCategory] = useState<'it' | 'non_it'>('it');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (myCandidate) {
      setFullName(myCandidate.full_name);
      setCurrentTitle(myCandidate.current_title || '');
      setLocation(myCandidate.location || '');
      setExpYears(String(myCandidate.total_experience_years ?? 0));
      setSkills(myCandidate.skills || []);
      setSummary(myCandidate.summary || '');
      const pd = (myCandidate.parsed_data || {}) as Record<string, unknown>;
      setRelevantExpYears(pd.relevant_experience_years == null ? '' : String(pd.relevant_experience_years));
      setOpenToContract(Boolean(pd.open_to_contract));
      setDomainCategory((pd.domain_category as 'it' | 'non_it') || classifyCandidate(myCandidate));
    }
    if (contacts) {
      setEmail(contacts.email || '');
      setPhone(contacts.phone || '');
      setLinkedin(contacts.linkedin_url || '');
    }
  }, [myCandidate, contacts]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myCandidate) return;
    const currentExperience = Number(expYears);
    const relevantExperience = relevantExpYears.trim() === '' ? null : Number(relevantExpYears);
    if (expYears.trim() === '' || !Number.isFinite(currentExperience) || currentExperience < 0 || currentExperience > 60) {
      setExperienceError('Enter current experience between 0 and 60 years.');
      return;
    }
    if (relevantExperience !== null && (!Number.isFinite(relevantExperience) || relevantExperience < 0 || relevantExperience > currentExperience)) {
      setExperienceError('Relevant experience must be between 0 and your current experience.');
      return;
    }
    setExperienceError(null);
    setSaving(true);
    try {
      const existingPd = (myCandidate.parsed_data || {}) as Record<string, unknown>;
      await updateCandidateProfile(myCandidate.id, {
        full_name: fullName.trim(),
        current_title: currentTitle.trim() || null,
        location: location.trim() || null,
        total_experience_years: currentExperience,
        skills,
        summary: summary.trim() || null,
        parsed_data: {
          ...existingPd,
          relevant_experience_years: relevantExperience,
          open_to_contract: openToContract,
          domain_category: domainCategory,
        },
      });
      await updateCandidateContacts(myCandidate.id, {
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedin_url: linkedin.trim() || null,
      });
      toast({ title: 'Profile updated', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_profile'] });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_contacts'] });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_matches'] });
    } catch (err) {
      toast({
        title: 'Could not save profile',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !myCandidate) return;
    const err = validateResumeFile(file);
    if (err) {
      toast({ title: 'Invalid file', description: err, tone: 'error' });
      return;
    }
    try {
      const hash = await computeFileSha256(file);
      await uploadCandidateResume(myCandidate.id, file, hash);
      await recordPrivacyAcknowledgementApi({
        subjectRef: `cand_${myCandidate.id}`,
        subjectName: myCandidate.full_name || 'Candidate',
        noticeId: 'HN-DPDP-NOTICE-2026-V2',
        version: '2.4.0',
        purpose: 'Resume replacement & updated profile matching under DPDP Notice v2.4.0',
        processingBasis: 'consent',
        action: 'acknowledged',
        captureSource: 'resume_upload',
      }).catch(() => undefined);
      toast({ title: 'Resume uploaded for review', description: 'It will be used as your active resume after an authorised recruiter accepts it.', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_profile'] });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_evidence_history', myCandidate.id] });
    } catch (uploadErr) {
      toast({
        title: 'Resume upload failed',
        description: mapSupabaseError(uploadErr),
        tone: 'error',
      });
    }
  };

  const handleUploadSupportingDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !myCandidate) return;
    const err = validateResumeFile(file);
    if (err) {
      toast({ title: 'Invalid document', description: err, tone: 'error' });
      return;
    }
    try {
      const hash = await computeFileSha256(file);
      await uploadCandidateResume(myCandidate.id, file, hash, { documentKind: 'supporting', reparse: false });
      await queryClient.invalidateQueries({ queryKey: ['my_candidate_evidence_history', myCandidate.id] });
      toast({ title: 'Supporting document uploaded for review', tone: 'success' });
    } catch (uploadErr) {
      toast({ title: 'Document upload failed', description: mapSupabaseError(uploadErr), tone: 'error' });
    }
  };

  const latestResume = evidenceHistory.find((doc) => doc.document_kind === 'resume' && doc.review_status !== 'rejected');
  const resumePathToView = latestResume?.storage_path || myCandidate?.resume_path;

  const handleOpenResume = async () => {
    if (!resumePathToView) return;
    try {
      const signed = await getResumeSignedUrl(resumePathToView);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Could not open resume',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  if (isLoading) return <TableSkeleton rows={4} cols={3} />;
  if (!myCandidate) {
    return (
      <EmptyState
        title="No candidate profile yet"
        description="Go to Jobs for me to run the profile creation wizard."
      />
    );
  }

  const profileChecks: Array<[string, boolean]> = [
    ['Current title', Boolean(myCandidate.current_title)],
    ['Location', Boolean(myCandidate.location)],
    ['Experience', Boolean(myCandidate.total_experience_years)],
    ['Relevant experience', myCandidate.parsed_data?.relevant_experience_years != null],
    ['Skills', Boolean(myCandidate.skills?.length)],
    ['Summary', Boolean(myCandidate.summary)],
    ['Resume', Boolean(resumePathToView)],
  ];
  const profileProgress = Math.round(profileChecks.filter(([, done]) => done).length / profileChecks.length * 100);
  const nextProfileStep = profileChecks.find(([, done]) => !done)?.[0];

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="My profile"
        description="Keep your skills, experience, and resume up to date to improve job match accuracy."
      />

      <section className="mb-5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6" aria-label="Profile overview">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={myCandidate.full_name || 'Candidate'} />
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-[var(--text-primary)]">{myCandidate.full_name || 'Your profile'}</h2>
              <p className="text-[12px] text-[var(--text-secondary)]">{myCandidate.current_title || 'Add your current title'}{myCandidate.location ? ` · ${myCandidate.location}` : ''}</p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Current experience: {myCandidate.total_experience_years == null ? 'Not set' : `${myCandidate.total_experience_years} years`}
                {' · '}Relevant experience: {myCandidate.parsed_data?.relevant_experience_years == null ? 'Not set' : `${myCandidate.parsed_data.relevant_experience_years} years`}
              </p>
              <a href="#candidate-experience" className="mt-1 inline-block text-[11px] font-medium text-[var(--primary-bg)] hover:underline">Edit experience</a>
            </div>
          </div>
          <Link to="/candidate" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--primary-bg)] hover:underline">See matched jobs <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 text-[12px]">
          <span className="font-medium text-[var(--text-primary)]">Profile strength</span>
          <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{profileProgress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--track)]" role="progressbar" aria-label="Profile strength" aria-valuenow={profileProgress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[var(--primary-bg)] transition-[width]" style={{ width: `${profileProgress}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
          {nextProfileStep ? `Next step: add ${nextProfileStep.toLowerCase()} to help recruiters understand your experience.` : 'Your profile has the essentials. Keep it current as your experience grows.'}
        </p>
      </section>

      <section className="mb-5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6" aria-label="Resume">
        <div className="flex items-start gap-3">
          <span className="rounded-[9px] bg-[#EEF4FF] p-2 text-[#1D5FD1]"><FileText className="h-4 w-4" /></span>
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Your resume</h2>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              {latestResume?.review_status === 'pending' ? 'Your latest upload is awaiting review. You can still view it here.' : resumePathToView ? 'View your current resume or upload a newer version.' : 'No resume uploaded yet. Add one to complete your profile.'}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleOpenResume} disabled={!resumePathToView}>
            View resume
          </Button>
          <label className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-border)]">
            {resumePathToView ? 'Upload new version' : 'Upload resume'}
            <input type="file" accept=".pdf,.doc,.docx" onChange={handleReplaceResume} className="sr-only" />
          </label>
          <label className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-border)]">
            Upload supporting document
            <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadSupportingDocument} className="sr-only" />
          </label>
        </div>
      </section>

      <CandidateEmploymentPanel candidateId={myCandidate.id} />

      <section className="mb-5 rounded-[8px] border border-[var(--border)] p-4">
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Resume &amp; document history</h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Uploads are preserved as separate versions. A new resume becomes active only after review.</p>
        </div>
        {evidenceHistory.length === 0 ? (
          <p className="text-[12px] text-[var(--text-tertiary)]">No uploaded versions yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {evidenceHistory.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
                <div>
                  <span className="font-medium text-[var(--text-primary)]">v{doc.version_number} · {doc.file_name}{doc.is_latest_candidate_submitted ? ' · latest upload' : ''}</span>
                  <span className="ml-2 text-[var(--text-secondary)]">{doc.review_status} · {doc.verification_status} · {formatLocalDate(doc.created_at)}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={async () => {
                  try {
                    const url = await getResumeSignedUrl(doc.storage_path);
                    window.open(url, '_blank', 'noopener,noreferrer');
                  } catch (err) {
                    toast({ title: 'Could not open document', description: mapSupabaseError(err), tone: 'error' });
                  }
                }}>View</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-5 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div>
          <span className="font-semibold text-[var(--text-primary)]">
            DPDP Act, 2023 - Personal Data Protection &amp; Rights:
          </span>{' '}
          <span className="text-[var(--text-secondary)]">
            Your profile is governed by Notice HN-DPDP-NOTICE-2026-V2 (v2.4.0). Manage consent, preferences, or request data access/erasure anytime.
          </span>
        </div>
        <Link
          to="/candidate/privacy"
          className="font-medium text-[#1D5FD1] hover:underline shrink-0"
        >
          Open My Privacy &amp; Rights Center →
        </Link>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div id="candidate-experience" className="grid scroll-mt-6 grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Input
            label="Current experience (years)"
            type="number"
            step="0.5"
            min="0"
            max="60"
            value={expYears}
            onChange={(e) => { setExpYears(e.target.value); setExperienceError(null); }}
          />
        </div>
        <div>
          <Input
            label="Relevant experience (years)"
            type="number"
            step="0.5"
            min="0"
            max="60"
            value={relevantExpYears}
            onChange={(e) => { setRelevantExpYears(e.target.value); setExperienceError(null); }}
            error={experienceError || undefined}
          />
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Years in roles similar to the jobs you want. This cannot exceed your current experience.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

        <SkillsChipInput
          label="My skills (used for job matching)"
          skills={skills}
          onChange={setSkills}
        />

        <Textarea
          label="Summary"
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        {/* Job Scope & Matching Preferences */}
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-3">
          <span className="text-[13px] font-semibold text-[var(--text-primary)] block">
            Job Scope &amp; Matching Preferences
          </span>

          <div className="flex items-start gap-2.5">
            <input
              type="checkbox"
              id="pref_open_to_contract"
              checked={openToContract}
              onChange={(e) => setOpenToContract(e.target.checked)}
              className="mt-0.5 rounded border-[var(--border)] h-4 w-4 text-[#1D5FD1]"
            />
            <label htmlFor="pref_open_to_contract" className="text-[12px] cursor-pointer">
              <span className="font-medium text-[var(--text-primary)] block">
                Show Contract (C2C / C2H) jobs in addition to Permanent Full-Time (FTE)
              </span>
              <span className="text-[var(--text-secondary)] block mt-0.5">
                {openToContract
                  ? 'Active: Both FTE and C2C/C2H positions are visible in your browse and match feeds.'
                  : 'FTE Only: Only permanent Full-Time roles are visible. Contract / C2C roles are filtered out.'}
              </span>
            </label>
          </div>

          <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
            <label className="text-[12px] font-medium text-[var(--text-primary)] block">
              Domain / Profile Track
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDomainCategory('it')}
                className={`p-2.5 rounded-[6px] border text-left text-[12px] transition-colors cursor-pointer ${
                  domainCategory === 'it'
                    ? 'border-[#1D5FD1] bg-[#1D5FD1]/10 text-[#1D5FD1] font-semibold'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="block font-medium">💻 IT / Tech Track</span>
                <span className="text-[11px] opacity-80 block mt-0.5">Software, Cloud, Data, QA, DevOps, AI</span>
              </button>
              <button
                type="button"
                onClick={() => setDomainCategory('non_it')}
                className={`p-2.5 rounded-[6px] border text-left text-[12px] transition-colors cursor-pointer ${
                  domainCategory === 'non_it'
                    ? 'border-[#1D5FD1] bg-[#1D5FD1]/10 text-[#1D5FD1] font-semibold'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="block font-medium">🏢 Non-IT Track</span>
                <span className="text-[11px] opacity-80 block mt-0.5">Sales, Operations, HR, Finance, Support</span>
              </button>
            </div>
            <span className="text-[11px] text-[var(--text-tertiary)] block mt-0.5">
              Filters your feed to only show matching {domainCategory === 'it' ? 'IT' : 'Non-IT'} positions.
            </span>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" loading={saving}>
            Save profile
          </Button>
        </div>
      </form>
    </div>
  );
};
