import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Plus,
  Send,
  Upload,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
  Button,
  Input,
  Select,
  Badge,
  Tabs,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Pagination,
  Dialog,
  Textarea,
  SkillsChipInput,
} from '../../components/ui/kit';
import {
  StageBadge,
  SlaBadge,
  ScoreBar,
} from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  fetchRequirements,
  fetchRequirementById,
  fetchRequirementVendorShares,
  acknowledgeRequirement,
} from '../../api/requirements';
import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateContacts,
  updateCandidateProfile,
  updateCandidateContacts,
  uploadCandidateResume,
  getResumeSignedUrl,
  fetchMatchesForRequirement,
} from '../../api/candidates';
import {
  fetchSubmissions,
  submitCandidateRpc,
} from '../../api/submissions';
import {
  fetchInterviews,
  getVendorPerformanceRpc,
  fetchInterviewFeedbackList,
  fetchQualityFeedbackList,
  raiseRatingDisputeRpc,
} from '../../api/interviews';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import {
  formatCurrency,
  formatLocalDate,
  formatLocalDateTime,
  maskEmail,
  maskPhone,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  CandidateContacts,
  CandidateMatch,
  FeedbackKind,
  SubmissionStage,
} from '../../types/db';

// 1. Vendor Dashboard
export const VendorDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_shares', profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(undefined, profile?.org_id || undefined),
    enabled: Boolean(profile?.org_id),
  });

  const { data: subsData } = useQuery({
    queryKey: ['vendor_submissions_dash', profile?.org_id],
    queryFn: () => fetchSubmissions({ vendorOrgId: profile?.org_id || undefined, page: 1 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: interviewsData } = useQuery({
    queryKey: ['vendor_interviews_dash', profile?.org_id],
    queryFn: () => fetchInterviews({ status: 'scheduled', page: 1 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: perf } = useQuery({
    queryKey: ['vendor_performance', profile?.org_id],
    queryFn: () => getVendorPerformanceRpc(profile!.org_id!),
    enabled: Boolean(profile?.org_id),
  });

  const unacknowledged = shares.filter((s) => !s.acknowledged_at && !s.revoked_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Agency Workspace"
        description="Track shared requirement SLAs, manage your deduplicated candidate pool, and monitor your 3-pillar agency score."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Unacknowledged Requirements"
          value={unacknowledged.length}
          tone={unacknowledged.length > 0 ? 'amber' : 'default'}
          sublabel="Acknowledge to record response speed"
          onClick={() => navigate('/vendor/requirements')}
        />
        <StatCard
          label="Active Shared Requirements"
          value={shares.filter((s) => !s.revoked_at).length}
          sublabel="With active SLA countdowns"
          onClick={() => navigate('/vendor/requirements')}
        />
        <StatCard
          label="My Submissions"
          value={subsData?.count ?? 0}
          sublabel="Submitted across requirements"
          onClick={() => navigate('/vendor/submissions')}
        />
        <StatCard
          label="Upcoming Candidate Interviews"
          value={interviewsData?.count ?? 0}
          sublabel="Scheduled rounds"
          onClick={() => navigate('/vendor/submissions')}
        />
      </div>

      {/* Active SLA Countdowns */}
      {shares.filter((s) => !s.revoked_at).length > 0 && (
        <Card className="p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Active Shared Requirements & SLA Countdowns
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {shares
              .filter((s) => !s.revoked_at)
              .slice(0, 8)
              .map((sh) => (
                <div
                  key={sh.id}
                  onClick={() => navigate(`/vendor/requirements/${sh.requirement_id}`)}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:text-indigo-600"
                >
                  <div>
                    <span className="font-semibold">
                      {sh.requirements?.title || sh.requirement_id}
                    </span>
                    {!sh.acknowledged_at && (
                      <Badge tone="amber" className="ml-2">
                        Unacknowledged
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono tabular-nums text-slate-500">
                      Due: {formatLocalDateTime(sh.due_at)}
                    </span>
                    <SlaBadge dueAt={sh.due_at} showCountdown />
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {perf && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            My Agency Performance Standing
          </h3>
          <VendorPerformancePanel performance={perf} />
        </div>
      )}
    </div>
  );
};

// 2. Vendor Shared Requirements List Page
export const VendorRequirementsPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_requirements', page, search],
    queryFn: () => fetchRequirements({ page, search }),
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_shares', profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(undefined, profile?.org_id || undefined),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requirements Shared with Us"
        description="RLS returns only requirements shared with your agency. Client internal budgets and margins are never exposed."
      />

      <div className="max-w-xs">
        <Input
          placeholder="Search requirement title..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No requirements shared with your agency yet"
          description="HireNest HQ will share open requirements with your agency here."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Requirement Title</th>
                <th className="py-3 px-4">Location & Mode</th>
                <th className="py-3 px-4 text-right">Vendor-Visible Budget</th>
                <th className="py-3 px-4">Acknowledgement</th>
                <th className="py-3 px-4">SLA Due Countdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((req) => {
                const share = shares.find((s) => s.requirement_id === req.id);
                return (
                  <tr
                    key={req.id}
                    onClick={() => navigate(`/vendor/requirements/${req.id}`)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {req.title}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {req.min_experience}–{req.max_experience} yrs · {req.openings} opening(s)
                      </div>
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-500">
                      {req.location} · {req.work_mode}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(req.vendor_visible_budget, req.currency)}
                    </td>
                    <td className="py-3 px-4">
                      {share?.acknowledged_at ? (
                        <Badge tone="emerald">Acknowledged</Badge>
                      ) : (
                        <Badge tone="amber">Needs Acknowledgement</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <SlaBadge dueAt={share?.due_at} showCountdown />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}
    </div>
  );
};

// 3. Vendor Shared Requirement Detail Page (Acknowledge button, My matching candidates, My submissions)
export const VendorRequirementDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'matches' | 'submissions'>('matches');
  const [acking, setAcking] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data: req, isLoading } = useQuery({
    queryKey: ['vendor_req_detail', id],
    queryFn: () => fetchRequirementById(id!),
    enabled: Boolean(id),
  });

  const { data: shares = [] } = useQuery({
    queryKey: ['vendor_req_shares', id, profile?.org_id],
    queryFn: () => fetchRequirementVendorShares(id!, profile?.org_id || undefined),
    enabled: Boolean(id && profile?.org_id),
  });

  const { data: matchesData } = useQuery({
    queryKey: ['vendor_req_matches', id],
    queryFn: () => fetchMatchesForRequirement({ requirementId: id!, page: 1 }),
    enabled: Boolean(id),
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['vendor_req_submissions', id, profile?.org_id],
    queryFn: () =>
      fetchSubmissions({
        requirementId: id!,
        vendorOrgId: profile?.org_id || undefined,
        page: 1,
      }),
    enabled: Boolean(id && profile?.org_id),
  });

  const share = shares[0];

  const handleAcknowledge = async () => {
    if (!id) return;
    setAcking(true);
    try {
      await acknowledgeRequirement({ p_requirement_id: id });
      toast({
        title: 'Requirement acknowledged',
        description: 'Response speed recorded for SLA metrics.',
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['vendor_req_shares'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
    } catch (err) {
      toast({
        title: 'Could not acknowledge',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setAcking(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!submitTarget || !id) return;
    setSubmitting(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: id,
        p_candidate_id: submitTarget.candidate_id,
        p_notes: submitNotes.trim() || null,
      });
      if (res.status === 'duplicate') {
        setDupReason(res.reason);
        setSubmitTarget(null);
        return;
      }
      toast({
        title: 'Candidate submitted to requirement',
        tone: 'success',
      });
      setSubmitTarget(null);
      setSubmitNotes('');
      queryClient.invalidateQueries({ queryKey: ['vendor_req_submissions'] });
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !req) return <TableSkeleton rows={5} cols={4} />;

  const mySubmissions = submissionsData?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={req.title}
        description={`${req.location} (${req.work_mode}) · ${req.min_experience}–${req.max_experience} yrs · Vendor Budget: ${formatCurrency(
          req.vendor_visible_budget,
          req.currency
        )}`}
        actions={
          <div className="flex items-center gap-2">
            {share && <SlaBadge dueAt={share.due_at} showCountdown />}
            {share && !share.acknowledged_at && (
              <Button onClick={handleAcknowledge} loading={acking}>
                <CheckCircle2 className="h-4 w-4" />
                Acknowledge Requirement
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            SLA Due Time:{' '}
            <strong className="font-mono text-slate-900 dark:text-slate-100">
              {formatLocalDateTime(share?.due_at)}
            </strong>
          </span>
          <span>
            Acknowledged:{' '}
            <strong className="font-mono text-slate-900 dark:text-slate-100">
              {share?.acknowledged_at ? formatLocalDateTime(share.acknowledged_at) : 'Pending'}
            </strong>
          </span>
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
          {req.description}
        </p>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {req.skills.map((s) => (
            <Badge key={s} tone="indigo">
              {s}
            </Badge>
          ))}
        </div>
      </Card>

      <Tabs
        tabs={[
          {
            id: 'matches',
            label: 'My Matching Candidates',
            count: matchesData?.count || 0,
          },
          {
            id: 'submissions',
            label: 'My Submissions',
            count: mySubmissions.length,
          },
        ]}
        activeTab={activeTab}
        onChange={(t) => setActiveTab(t as 'matches' | 'submissions')}
      />

      {activeTab === 'matches' ? (
        !matchesData?.data.length ? (
          <EmptyState
            title="No matching candidates in your pool yet"
            description="Add candidates with matching skills in your Candidate Pool to see ranked matches here."
          />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Advisory Match Score</th>
                  <th className="py-3 px-4">Matched / Unproven Skills</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {matchesData.data.map((m) => {
                  const alreadySubmitted = mySubmissions.some(
                    (s) => s.candidate_id === m.candidate_id
                  );
                  return (
                    <tr key={m.id}>
                      <td className="py-3 px-4">
                        <div className="font-semibold">
                          {m.candidates?.full_name || m.candidate_id}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {m.candidates?.current_title || '—'} ·{' '}
                          {m.candidates?.total_experience_years ?? '—'} yrs
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <ScoreBar
                          score={m.final_score}
                          isOverridden={m.override_score !== null}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-emerald-700 font-medium">
                          {m.matched_skills?.length || 0} matched
                        </span>{' '}
                        ·{' '}
                        <span className="text-slate-500">
                          {m.unproven_skills?.length || 0} unproven
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {alreadySubmitted ? (
                          <Badge tone="emerald">Submitted</Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSubmitTarget(m);
                              setSubmitNotes('');
                            }}
                          >
                            <Send className="h-3.5 w-3.5" />
                            Review & Submit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      ) : !mySubmissions.length ? (
        <EmptyState
          title="No submissions for this requirement yet"
          description="Select a candidate from My Matching Candidates to submit."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Candidate</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Submitted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {mySubmissions.map((sub) => (
                <tr
                  key={sub.id}
                  onClick={() => setDrawerSubId(sub.id)}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="py-3 px-4 font-semibold">
                    {sub.candidates?.full_name || sub.candidate_id}
                  </td>
                  <td className="py-3 px-4">
                    <StageBadge stage={sub.stage} />
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDateTime(sub.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Submit Candidate Dialog showing Match Evidence first */}
      <Dialog
        open={Boolean(submitTarget)}
        onClose={() => setSubmitTarget(null)}
        title="Submit Candidate to Requirement"
        description="Verify match evidence and add submission notes before submitting."
        maxWidth="max-w-xl"
      >
        {submitTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitTarget} />
            <Textarea
              label="Vendor Submission Notes"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              placeholder="Notice period, availability for interviews, rate confirmation..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSubmit} loading={submitting}>
                Confirm Submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_recruiter'}
      />

      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />
    </div>
  );
};

// 4. Vendor Candidate Pool Page (list, add, edit own candidates)
export const VendorCandidatePoolPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_candidates', profile?.org_id, page, search],
    queryFn: () =>
      fetchCandidates({
        page,
        ownerVendorOrgId: profile?.org_id || undefined,
        search,
      }),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Agency Candidate Pool"
        description="Add and manage candidates owned by your agency. Resume SHA-256 deduplication runs automatically in browser."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Candidate
          </Button>
        }
      />

      <div className="max-w-xs">
        <Input
          placeholder="Search candidate name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No candidates in your agency pool yet"
          description="Add a candidate with resume upload to start matching against shared requirements."
          actionLabel="Add Candidate"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Candidate</th>
                <th className="py-3 px-4">Masked Contact (List View)</th>
                <th className="py-3 px-4">Skills</th>
                <th className="py-3 px-4">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((c) => {
                const rawContacts = Array.isArray(c.candidate_contacts)
                  ? c.candidate_contacts[0]
                  : (c.candidate_contacts as CandidateContacts | null);
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/vendor/candidates/${c.id}`)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {c.full_name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {c.current_title || '—'} · {c.total_experience_years ?? '—'} yrs ·{' '}
                        {c.location || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      <div>{maskEmail(rawContacts?.email)}</div>
                      <div>{maskPhone(rawContacts?.phone)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(c.skills || []).slice(0, 5).map((sk) => (
                          <Badge key={sk} tone="slate">
                            {sk}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDate(c.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <CandidateFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(candidateId) => {
          queryClient.invalidateQueries({ queryKey: ['vendor_candidates'] });
          navigate(`/vendor/candidates/${candidateId}`);
        }}
      />
    </div>
  );
};

// 5. Vendor Candidate Detail & Edit Page
export const VendorCandidateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cand, isLoading } = useQuery({
    queryKey: ['vendor_candidate_detail', id],
    queryFn: () => fetchCandidateById(id!),
    enabled: Boolean(id),
  });

  const { data: contacts } = useQuery({
    queryKey: ['vendor_candidate_contacts', id],
    queryFn: () => fetchCandidateContacts(id!),
    enabled: Boolean(id),
  });

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [location, setLocation] = useState('');
  const [expYears, setExpYears] = useState('0');
  const [skills, setSkills] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (!cand) return;
    setFullName(cand.full_name);
    setCurrentTitle(cand.current_title || '');
    setLocation(cand.location || '');
    setExpYears(String(cand.total_experience_years ?? 0));
    setSkills(cand.skills || []);
    setSummary(cand.summary || '');
    setEmail(contacts?.email || '');
    setPhone(contacts?.phone || '');
    setLinkedin(contacts?.linkedin_url || '');
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cand) return;
    setSaving(true);
    try {
      await updateCandidateProfile(cand.id, {
        full_name: fullName.trim(),
        current_title: currentTitle.trim() || null,
        location: location.trim() || null,
        total_experience_years: Number(expYears),
        skills,
        summary: summary.trim() || null,
      });
      await updateCandidateContacts(cand.id, {
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedin_url: linkedin.trim() || null,
      });
      toast({ title: 'Candidate profile updated', tone: 'success' });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_detail', id] });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_contacts', id] });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cand) return;
    const err = validateResumeFile(file);
    if (err) {
      toast({ title: 'Invalid resume file', description: err, tone: 'error' });
      return;
    }
    try {
      const hash = await computeFileSha256(file);
      await uploadCandidateResume(cand.id, file, hash);
      toast({ title: 'Resume uploaded', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['vendor_candidate_detail', id] });
    } catch (uploadErr) {
      toast({
        title: 'Resume upload failed',
        description: mapSupabaseError(uploadErr),
        tone: 'error',
      });
    }
  };

  const handleViewResume = async () => {
    if (!cand?.resume_path) return;
    try {
      const url = await getResumeSignedUrl(cand.resume_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Could not open resume',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  if (isLoading || !cand) return <TableSkeleton rows={4} cols={4} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={cand.full_name}
        description={`${cand.current_title || 'Candidate'} · ${cand.location || '—'} · ${
          cand.total_experience_years ?? 0
        } yrs experience`}
        actions={
          <div className="flex items-center gap-2">
            {cand.resume_path && (
              <Button size="sm" variant="outline" onClick={handleViewResume}>
                <FileText className="h-3.5 w-3.5" />
                View Resume
              </Button>
            )}
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5 text-indigo-600" />
              <span>Replace Resume</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleReplaceResume}
                className="hidden"
              />
            </label>
            <Button size="sm" onClick={startEdit}>
              Edit Candidate
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-5 space-y-4 text-xs">
          <div>
            <span className="font-semibold block mb-1">Summary</span>
            <p className="text-slate-600 dark:text-slate-300 whitespace-pre-line">
              {cand.summary || 'No summary provided.'}
            </p>
          </div>
          <div>
            <span className="font-semibold block mb-2">Skills</span>
            <div className="flex flex-wrap gap-1.5">
              {(cand.skills || []).map((sk) => (
                <Badge key={sk} tone="indigo">
                  {sk}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-2 text-xs">
          <h3 className="font-semibold">Contact Details (Owner Vendor Access)</h3>
          <div className="py-1 flex justify-between">
            <span className="text-slate-500">Email:</span>
            <span className="font-mono">{contacts?.email || '—'}</span>
          </div>
          <div className="py-1 flex justify-between">
            <span className="text-slate-500">Phone:</span>
            <span className="font-mono">{contacts?.phone || '—'}</span>
          </div>
          <div className="py-1 flex justify-between">
            <span className="text-slate-500">LinkedIn:</span>
            <span className="truncate max-w-[180px]">{contacts?.linkedin_url || '—'}</span>
          </div>
        </Card>
      </div>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit Candidate Profile"
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Full Name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <Input
              label="Current Title"
              value={currentTitle}
              onChange={(e) => setCurrentTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <Input
              label="Total Experience (Years)"
              type="number"
              step="0.5"
              value={expYears}
              onChange={(e) => setExpYears(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <SkillsChipInput skills={skills} onChange={setSkills} />
          <Textarea
            label="Summary"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

// 6. Vendor Submissions Page
export const VendorSubmissionsPage: React.FC = () => {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<SubmissionStage | ''>('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vendor_submissions_list', profile?.org_id, page, stage],
    queryFn: () =>
      fetchSubmissions({
        page,
        vendorOrgId: profile?.org_id || undefined,
        stage,
      }),
    enabled: Boolean(profile?.org_id),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Agency Submissions"
        description="Track pipeline stages, scheduled interviews, and withdraw submissions with a reason."
      />

      <div className="max-w-xs">
        <Select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as SubmissionStage | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Stages' },
            { value: 'applied', label: 'Applied' },
            { value: 'recruiter_review', label: 'Recruiter Review' },
            { value: 'client_review', label: 'Client Review' },
            { value: 'interviewing', label: 'Interviewing' },
            { value: 'offered', label: 'Offered' },
            { value: 'onboarded', label: 'Onboarded' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'withdrawn', label: 'Withdrawn' },
          ]}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No submissions recorded yet"
          description="Submit candidates from a Shared Requirement to track their progress here."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Candidate</th>
                <th className="py-3 px-4">Requirement</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Compliance</th>
                <th className="py-3 px-4">Submitted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.data.map((sub) => (
                <tr
                  key={sub.id}
                  onClick={() => setDrawerSubId(sub.id)}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="py-3 px-4 font-semibold">
                    {sub.candidates?.full_name || sub.candidate_id}
                  </td>
                  <td className="py-3 px-4">
                    {sub.requirements?.title || sub.requirement_id}
                  </td>
                  <td className="py-3 px-4">
                    <StageBadge stage={sub.stage} />
                  </td>
                  <td className="py-3 px-4">
                    {sub.is_valid ? (
                      <Badge tone="emerald">Valid</Badge>
                    ) : (
                      <Badge tone="red">Invalid: {sub.invalid_reason}</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDateTime(sub.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'vendor_recruiter'}
      />
    </div>
  );
};

// 7. Vendor Ratings & Performance Page (3 score cards + shared feedback + Dispute button for vendor_admin)
export const VendorRatingsPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isVendorAdmin = profile?.role === 'vendor_admin';

  const [disputeTarget, setDisputeTarget] = useState<{
    kind: FeedbackKind;
    feedbackId: string;
    summary: string;
  } | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputing, setDisputing] = useState(false);

  const { data: perf, isLoading: loadingPerf } = useQuery({
    queryKey: ['vendor_performance', profile?.org_id],
    queryFn: () => getVendorPerformanceRpc(profile!.org_id!),
    enabled: Boolean(profile?.org_id),
  });

  // RLS automatically filters interview_feedback & candidate_quality_feedback to visible_to_vendor = true
  const { data: sharedInterviewFb } = useQuery({
    queryKey: ['vendor_shared_interview_fb', profile?.org_id],
    queryFn: () => fetchInterviewFeedbackList({ page: 1, pageSize: 25 }),
    enabled: Boolean(profile?.org_id),
  });

  const { data: sharedQualityFb } = useQuery({
    queryKey: ['vendor_shared_quality_fb', profile?.org_id],
    queryFn: () => fetchQualityFeedbackList({ page: 1, pageSize: 25 }),
    enabled: Boolean(profile?.org_id),
  });

  const handleRaiseDispute = async () => {
    if (!disputeTarget || disputeReason.trim().length < 20) return;
    setDisputing(true);
    try {
      await raiseRatingDisputeRpc({
        p_kind: disputeTarget.kind,
        p_feedback_id: disputeTarget.feedbackId,
        p_reason: disputeReason.trim(),
      });
      toast({
        title: 'Rating dispute submitted to HireNest HQ',
        description: 'HireNest Admin will review your evidence and resolve the dispute.',
        tone: 'success',
      });
      setDisputeTarget(null);
      setDisputeReason('');
      queryClient.invalidateQueries({ queryKey: ['vendor_performance'] });
    } catch (err) {
      toast({
        title: 'Could not raise dispute',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setDisputing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ratings & Agency Performance"
        description="Three-pillar standing (Timing, Quality, Compliance) and client feedback approved for sharing by HireNest HQ."
      />

      {loadingPerf ? (
        <TableSkeleton rows={4} cols={4} />
      ) : perf ? (
        <VendorPerformancePanel performance={perf} />
      ) : null}

      {/* Shared Interview Feedback */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Shared Interview Feedback ({sharedInterviewFb?.data?.length || 0})
        </h3>
        {!sharedInterviewFb?.data?.length ? (
          <p className="text-xs text-slate-500">
            No interview feedback has been approved for vendor sharing yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {sharedInterviewFb.data.map((fb) => (
              <div
                key={fb.id}
                className="py-3 flex flex-wrap items-start justify-between gap-4"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="font-semibold">
                    {fb.interviews?.submissions?.candidates?.full_name || 'Candidate'} ·{' '}
                    {fb.interviews?.submissions?.requirements?.title || 'Requirement'}
                  </div>
                  <div className="font-mono tabular-nums text-slate-500">
                    Overall: {fb.overall_rating}/5 · Skill: {fb.skill_rating}/5 · Comm:{' '}
                    {fb.communication_rating}/5 · Decision: {fb.decision}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{fb.feedback}</p>
                </div>
                {isVendorAdmin && !fb.excluded_from_score && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDisputeTarget({
                        kind: 'interview',
                        feedbackId: fb.id,
                        summary: fb.feedback,
                      });
                      setDisputeReason('');
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Dispute Rating
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Shared Candidate Quality Feedback */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Shared Candidate Quality Feedback ({sharedQualityFb?.data?.length || 0})
        </h3>
        {!sharedQualityFb?.data?.length ? (
          <p className="text-xs text-slate-500">
            No candidate quality ratings have been approved for vendor sharing yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {sharedQualityFb.data.map((qf) => (
              <div
                key={qf.id}
                className="py-3 flex flex-wrap items-start justify-between gap-4"
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="font-semibold">
                    {qf.submissions?.candidates?.full_name || 'Candidate'} ·{' '}
                    {qf.submissions?.requirements?.title || 'Requirement'}
                  </div>
                  <div className="font-mono tabular-nums text-slate-500">
                    Overall Suitability: {qf.overall_suitability}/5 · JD Align:{' '}
                    {qf.jd_skill_alignment}/5 · Experience: {qf.relevant_experience}/5
                  </div>
                  {qf.comments && (
                    <p className="text-slate-700 dark:text-slate-300">{qf.comments}</p>
                  )}
                </div>
                {isVendorAdmin && !qf.excluded_from_score && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDisputeTarget({
                        kind: 'quality',
                        feedbackId: qf.id,
                        summary: qf.comments || `Overall suitability ${qf.overall_suitability}/5`,
                      });
                      setDisputeReason('');
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Dispute Rating
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        open={Boolean(disputeTarget)}
        onClose={() => setDisputeTarget(null)}
        title="Raise Rating Dispute (Vendor Admin)"
        description="Provide factual evidence (minimum 20 characters) for HireNest Admin review."
      >
        <div className="space-y-4">
          <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs">
            <span className="font-semibold block">Disputed Feedback:</span>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              {disputeTarget?.summary}
            </p>
          </div>
          <Textarea
            label="Dispute Reason (Required, min 20 characters)"
            rows={4}
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Explain factual inaccuracies or process discrepancies..."
            error={
              disputeReason.length > 0 && disputeReason.trim().length < 20
                ? 'Reason must be at least 20 characters.'
                : undefined
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisputeTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRaiseDispute}
              loading={disputing}
              disabled={disputeReason.trim().length < 20}
            >
              Submit Dispute
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
