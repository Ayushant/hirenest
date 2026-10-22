import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  FileText,
  ExternalLink,
  Send,
  Sliders,
  CheckCircle2,
  Edit3,
  Upload,
  Link2,
  Eye,
} from 'lucide-react';
import {
  PageHeader,
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
  SourceBadge,
  StageBadge,
  ScoreBar,
} from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { InterviewFeedbackModal } from '../../components/domain/InterviewModals';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  fetchCandidates,
  fetchCandidateById,
  fetchCandidateContacts,
  getResumeSignedUrl,
  fetchMatchesForCandidate,
  overrideMatchScore,
  updateCandidateProfile,
  updateCandidateContacts,
  uploadCandidateResume,
} from '../../api/candidates';
import {
  fetchSubmissions,
  submitCandidateRpc,
} from '../../api/submissions';
import {
  fetchInterviews,
  fetchMyPendingFeedback,
  updateInterviewStatusRpc,
} from '../../api/interviews';
import {
  fetchOrganizations,
  fetchDuplicateFlags,
  resolveDuplicateFlag,
  fetchAuditLogs,
  adminLinkCandidateAccount,
} from '../../api/admin';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import {
  ROUND_LABELS,
  STAGE_LABELS,
  formatLocalDate,
  formatLocalDateTime,
  maskEmail,
  maskPhone,
} from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  CandidateContacts,
  CandidateMatch,
  CandidateSource,
  DuplicateFlag,
  InterviewRound,
  InterviewStatus,
  SubmissionStage,
} from '../../types/db';

// 1. HQ Candidates List Page (Candidate 360 List)
export const HqCandidatesListPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const prefix = profile?.role === 'admin' ? '/admin' : '/recruiter';

  const [page, setPage] = useState(1);
  const [originalSource, setOriginalSource] = useState<CandidateSource | ''>(
    (searchParams.get('source') as CandidateSource) || ''
  );
  const [ownerVendorId, setOwnerVendorId] = useState('');
  const [skill, setSkill] = useState('');
  const [minExp, setMinExp] = useState('');
  const [maxExp, setMaxExp] = useState('');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      'candidates',
      page,
      originalSource,
      ownerVendorId,
      skill,
      minExp,
      maxExp,
      search,
    ],
    queryFn: () =>
      fetchCandidates({
        page,
        originalSource,
        ownerVendorOrgId: ownerVendorId || undefined,
        skill: skill || undefined,
        minExp: minExp !== '' ? Number(minExp) : undefined,
        maxExp: maxExp !== '' ? Number(maxExp) : undefined,
        search,
      }),
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['organizations_vendors'],
    queryFn: () => fetchOrganizations({ type: 'vendor', page: 1, pageSize: 100 }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates (Candidate 360)"
        description="Governed talent pool with distinct original source attribution, current vendor ownership, and masked PII in list views."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Candidate
          </Button>
        }
      />

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Input
          placeholder="Search full name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={originalSource}
          onChange={(e) => {
            setOriginalSource(e.target.value as CandidateSource | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Original Sources' },
            { value: 'vendor', label: 'Vendor Sourced' },
            { value: 'direct', label: 'Direct Applicant' },
            { value: 'internal', label: 'HireNest Sourced' },
          ]}
        />
        <Select
          value={ownerVendorId}
          onChange={(e) => {
            setOwnerVendorId(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Owner Vendors' },
            ...(vendorsData?.data || []).map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
        <Input
          placeholder="Skill contains (exact)..."
          value={skill}
          onChange={(e) => {
            setSkill(e.target.value);
            setPage(1);
          }}
        />
        <Input
          placeholder="Min Exp (Yrs)"
          type="number"
          value={minExp}
          onChange={(e) => {
            setMinExp(e.target.value);
            setPage(1);
          }}
        />
        <Input
          placeholder="Max Exp (Yrs)"
          type="number"
          value={maxExp}
          onChange={(e) => {
            setMaxExp(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No candidates found"
          description="Add a candidate to the HireNest pool or clear your active filters."
          actionLabel="Add Candidate"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Original Source</th>
                  <th className="py-3 px-4">Current Vendor Association</th>
                  <th className="py-3 px-4">Masked Contact (List View)</th>
                  <th className="py-3 px-4">Skills</th>
                  <th className="py-3 px-4">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {data.data.map((c) => {
                  const rawContacts = Array.isArray(c.candidate_contacts)
                    ? c.candidate_contacts[0]
                    : (c.candidate_contacts as CandidateContacts | null);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`${prefix}/candidates/${c.id}`)}
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
                      <td className="py-3 px-4">
                        <SourceBadge
                          source={c.original_source}
                          vendorName={c.source_vendor?.name}
                        />
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {c.owner_vendor?.name || 'None (Direct / Internal)'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        <div>{maskEmail(rawContacts?.email)}</div>
                        <div>{maskPhone(rawContacts?.phone)}</div>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {(c.skills || []).slice(0, 4).map((sk) => (
                            <Badge key={sk} tone="slate">
                              {sk}
                            </Badge>
                          ))}
                          {(c.skills?.length || 0) > 4 && (
                            <span className="text-[10px] text-slate-400">
                              +{c.skills.length - 4}
                            </span>
                          )}
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
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <CandidateFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(candidateId) => {
          queryClient.invalidateQueries({ queryKey: ['candidates'] });
          navigate(`${prefix}/candidates/${candidateId}`);
        }}
      />
    </div>
  );
};

// 2. HQ Candidate 360 Detail Page
export const HqCandidateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const role = profile?.role || 'recruiter';
  const isAdmin = role === 'admin';
  const prefix = isAdmin ? '/admin' : '/recruiter';

  const [activeTab, setActiveTab] = useState('matches');
  const [matchesPage, setMatchesPage] = useState(1);
  const [drawerSubmissionId, setDrawerSubmissionId] = useState<string | null>(null);

  // Override, Evidence & Submit modals for Candidate -> Requirements
  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<CandidateMatch | null>(null);
  const [overrideScoreInput, setOverrideScoreInput] = useState('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  const [submitMatchTarget, setSubmitMatchTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);

  // HQ Candidate 360 Edit & Link User Account states
  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [location, setLocation] = useState('');
  const [expYears, setExpYears] = useState('0');
  const [skills, setSkills] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [linkUserOpen, setLinkUserOpen] = useState(false);
  const [linkUserIdInput, setLinkUserIdInput] = useState('');
  const [linkingUser, setLinkingUser] = useState(false);

  const { data: cand, isLoading } = useQuery({
    queryKey: ['candidate_detail', id],
    queryFn: () => fetchCandidateById(id!),
    enabled: Boolean(id),
  });

  const { data: contacts } = useQuery({
    queryKey: ['candidate_contacts', id],
    queryFn: () => fetchCandidateContacts(id!),
    enabled: Boolean(id),
  });

  const { data: matchesData } = useQuery({
    queryKey: ['candidate_matches', id, matchesPage],
    queryFn: () => fetchMatchesForCandidate({ candidateId: id!, page: matchesPage }),
    enabled: Boolean(id),
  });

  const { data: submissionsData } = useQuery({
    queryKey: ['candidate_submissions', id],
    queryFn: () => fetchSubmissions({ candidateId: id!, page: 1, pageSize: 50 }),
    enabled: Boolean(id),
  });

  const { data: auditData } = useQuery({
    queryKey: ['candidate_audit', id],
    queryFn: () => fetchAuditLogs({ recordId: id!, page: 1 }),
    enabled: Boolean(id && isAdmin),
  });

  const handleOpenResume = async () => {
    if (!cand?.resume_path) return;
    try {
      const signedUrl = await getResumeSignedUrl(cand.resume_path);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({
        title: 'Could not open resume',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  const handleSaveOverride = async () => {
    if (!overrideTarget || !overrideReasonInput.trim()) return;
    setOverrideLoading(true);
    try {
      const parsed =
        overrideScoreInput.trim() === '' ? null : Number(overrideScoreInput);
      await overrideMatchScore({
        p_requirement_id: overrideTarget.requirement_id,
        p_candidate_id: cand!.id,
        p_score: parsed,
        p_reason: overrideReasonInput.trim(),
      });
      toast({ title: 'Match override saved', tone: 'success' });
      setOverrideTarget(null);
      queryClient.invalidateQueries({ queryKey: ['candidate_matches', id] });
    } catch (err) {
      toast({
        title: 'Override failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setOverrideLoading(false);
    }
  };

  const handleSubmitCandidate = async () => {
    if (!submitMatchTarget || !cand) return;
    setSubmitLoading(true);
    try {
      const res = await submitCandidateRpc({
        p_requirement_id: submitMatchTarget.requirement_id,
        p_candidate_id: cand.id,
        p_notes: submitNotes.trim() || null,
      });
      if (res.status === 'duplicate') {
        setDupReason(res.reason);
        setSubmitMatchTarget(null);
        return;
      }
      toast({ title: 'Submitted to requirement', tone: 'success' });
      setSubmitMatchTarget(null);
      setSubmitNotes('');
      queryClient.invalidateQueries({ queryKey: ['candidate_submissions', id] });
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitLoading(false);
    }
  };

  const startEditCandidate = () => {
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
    setEditOpen(true);
  };

  const handleSaveCandidateEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cand) return;
    setSavingEdit(true);
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
      toast({ title: 'Candidate 360 profile updated', tone: 'success' });
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ['candidate_detail', id] });
      queryClient.invalidateQueries({ queryKey: ['candidate_contacts', id] });
      queryClient.invalidateQueries({ queryKey: ['candidate_matches', id] });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSavingEdit(false);
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
      toast({ title: 'Resume uploaded & SHA-256 hash recorded', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['candidate_detail', id] });
    } catch (uploadErr) {
      toast({
        title: 'Resume upload failed',
        description: mapSupabaseError(uploadErr),
        tone: 'error',
      });
    }
  };

  const handleLinkUserAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cand || !linkUserIdInput.trim()) return;
    setLinkingUser(true);
    try {
      await adminLinkCandidateAccount({
        p_candidate_id: cand.id,
        p_user_id: linkUserIdInput.trim(),
      });
      toast({
        title: 'Candidate account linked',
        description: 'Linked candidate profile to authenticated user UUID.',
        tone: 'success',
      });
      setLinkUserOpen(false);
      setLinkUserIdInput('');
      queryClient.invalidateQueries({ queryKey: ['candidate_detail', id] });
    } catch (err) {
      toast({
        title: 'Could not link account',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setLinkingUser(false);
    }
  };

  if (isLoading || !cand) {
    return <TableSkeleton rows={6} cols={4} />;
  }

  const submissions = submissionsData?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={cand.full_name}
        description={`${cand.current_title || 'Candidate'} · ${cand.location || '—'} · ${
          cand.total_experience_years ?? 0
        } years experience`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {cand.resume_path ? (
              <Button size="sm" variant="outline" onClick={handleOpenResume}>
                <FileText className="h-3.5 w-3.5" />
                View Resume (5m Signed URL)
              </Button>
            ) : (
              <Badge tone="slate">No resume uploaded</Badge>
            )}
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
              <Upload className="h-3.5 w-3.5 text-indigo-600" />
              <span>{cand.resume_path ? 'Replace Resume' : 'Upload Resume'}</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleReplaceResume}
                className="hidden"
              />
            </label>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLinkUserIdInput(cand.user_id || '');
                  setLinkUserOpen(true);
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
                {cand.user_id ? 'Relink User Account' : 'Link User Account'}
              </Button>
            )}
            <Button size="sm" onClick={startEditCandidate}>
              <Edit3 className="h-3.5 w-3.5" />
              Edit Candidate 360
            </Button>
          </div>
        }
      />

      {/* Candidate 360 Header & Three-Way Attribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-500 block mb-1">1. Original Source</span>
              <SourceBadge
                source={cand.original_source}
                vendorName={cand.source_vendor?.name}
              />
            </div>
            <div>
              <span className="text-slate-500 block mb-1">2. Current Vendor Association</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {cand.owner_vendor?.name || 'None (Direct / Internal)'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">Linked Auth User</span>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {cand.user_id ? cand.user_id.slice(0, 12) + '…' : 'Unlinked'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">Resume SHA-256</span>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {cand.resume_hash ? cand.resume_hash.slice(0, 12) + '…' : '—'}
              </span>
            </div>
          </div>

          {cand.summary && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 block mb-1">
                Summary
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">
                {cand.summary}
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 block mb-2">
              Verified Profile Skills ({cand.skills?.length || 0})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(cand.skills || []).map((sk) => (
                <Badge key={sk} tone="indigo">
                  {sk}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        {/* Unmasked Contacts on Detail Page (HQ / Owner Vendor / Self only) */}
        <Card className="p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Candidate Contact Details (Governed)
          </h3>
          {contacts ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Email:</span>
                <span className="font-mono">{contacts.email || '—'}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Phone:</span>
                <span className="font-mono">{contacts.phone || '—'}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">LinkedIn:</span>
                {contacts.linkedin_url ? (
                  <a
                    href={contacts.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 underline inline-flex items-center gap-1"
                  >
                    Profile <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Contact details are restricted or not recorded.
            </p>
          )}
        </Card>
      </div>

      <Tabs
        tabs={[
          {
            id: 'matches',
            label: 'Matches (Candidate → Requirements)',
            count: matchesData?.count || 0,
          },
          {
            id: 'submissions',
            label: 'Applications & Submissions',
            count: submissions.length,
          },
          ...(isAdmin ? [{ id: 'audit', label: 'Audit Trail' }] : []),
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'matches' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Bidirectional matching (<code className="font-mono">Candidate → Requirements</code>). A{' '}
            <strong>Potential Match</strong> is advisory only and does not create an application or
            vendor submission until explicitly submitted.
          </p>
          {!matchesData?.data.length ? (
            <EmptyState
              title="No matching open requirements"
              description="Potential matches are calculated automatically when open requirements match this candidate's skills."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4">Requirement</th>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Pipeline / Attribution Status</th>
                      <th className="py-3 px-4">Final Score</th>
                      <th className="py-3 px-4">Matched / Unproven Skills</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {matchesData.data.map((m) => {
                      const existingSub = submissions.find(
                        (s) => s.requirement_id === m.requirement_id
                      );
                      return (
                        <tr key={m.id}>
                          <td className="py-3 px-4">
                            <Link
                              to={`${prefix}/requirements/${m.requirement_id}`}
                              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {m.requirements?.title || m.requirement_id}
                            </Link>
                          </td>
                          <td className="py-3 px-4">
                            {m.requirements?.organizations?.name || '—'}
                          </td>
                          <td className="py-3 px-4">
                            {!existingSub ? (
                              <Badge tone="amber">Potential Match (Not Applied)</Badge>
                            ) : existingSub.source === 'direct' ? (
                              <Badge tone="emerald">
                                Direct Applied · {STAGE_LABELS[existingSub.stage]}
                              </Badge>
                            ) : existingSub.source === 'vendor' ? (
                              <Badge tone="indigo">
                                Vendor Submitted · {STAGE_LABELS[existingSub.stage]}
                              </Badge>
                            ) : (
                              <Badge tone="slate">
                                HQ Submitted · {STAGE_LABELS[existingSub.stage]}
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <ScoreBar
                              score={m.final_score}
                              isOverridden={m.override_score !== null}
                            />
                            {m.override_score !== null && (
                              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">
                                Overridden: {m.override_reason}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              {m.matched_skills?.length || 0} matched
                            </span>{' '}
                            ·{' '}
                            <span
                              className="text-slate-500"
                              title="Missing evidence is not proof of missing skill"
                            >
                              {m.unproven_skills?.length || 0} unproven
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEvidenceTarget(m)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Evidence
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setOverrideTarget(m);
                                setOverrideScoreInput(
                                  m.override_score !== null ? String(m.override_score) : ''
                                );
                                setOverrideReasonInput(m.override_reason || '');
                              }}
                            >
                              <Sliders className="h-3.5 w-3.5" />
                              Override
                            </Button>
                            {existingSub ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDrawerSubmissionId(existingSub.id)}
                              >
                                View Pipeline
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSubmitMatchTarget(m);
                                  setSubmitNotes('');
                                }}
                              >
                                <Send className="h-3.5 w-3.5" />
                                Submit
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={matchesPage}
                totalCount={matchesData.count}
                onPageChange={setMatchesPage}
              />
            </Card>
          )}
        </div>
      )}

      {activeTab === 'submissions' && (
        <Card className="overflow-hidden">
          {submissions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No applications or vendor submissions recorded for this candidate.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Requirement</th>
                  <th className="py-3 px-4">Submission Source</th>
                  <th className="py-3 px-4">Submitting Vendor</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {submissions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setDrawerSubmissionId(s.id)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4 font-semibold">
                      {s.requirements?.title || s.requirement_id}
                    </td>
                    <td className="py-3 px-4">
                      <SourceBadge source={s.source} vendorName={s.organizations?.name} />
                    </td>
                    <td className="py-3 px-4">
                      {s.organizations?.name || 'Direct / HireNest'}
                    </td>
                    <td className="py-3 px-4">
                      <StageBadge stage={s.stage} />
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDateTime(s.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {activeTab === 'audit' && isAdmin && (
        <Card className="p-5 space-y-2 text-xs">
          {!auditData?.data.length ? (
            <p className="text-slate-500">No audit records for this candidate.</p>
          ) : (
            auditData.data.map((log) => (
              <div
                key={log.id}
                className="py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between"
              >
                <span>
                  <strong className="uppercase font-mono">{log.action}</strong> by{' '}
                  {log.actor_role || 'system'}
                </span>
                <span className="font-mono tabular-nums text-slate-400">
                  {formatLocalDateTime(log.created_at)}
                </span>
              </div>
            ))
          )}
        </Card>
      )}

      {/* Override Modal */}
      <Dialog
        open={Boolean(overrideTarget)}
        onClose={() => setOverrideTarget(null)}
        title="Override Match Score"
      >
        <div className="space-y-4">
          <Input
            label="Override Score (0–100 or blank to clear)"
            type="number"
            min={0}
            max={100}
            value={overrideScoreInput}
            onChange={(e) => setOverrideScoreInput(e.target.value)}
          />
          <Textarea
            label="Reason (Required)"
            rows={3}
            value={overrideReasonInput}
            onChange={(e) => setOverrideReasonInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveOverride}
              loading={overrideLoading}
              disabled={!overrideReasonInput.trim()}
            >
              Save Override
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Submit Candidate Modal */}
      <Dialog
        open={Boolean(submitMatchTarget)}
        onClose={() => setSubmitMatchTarget(null)}
        title="Submit Candidate to Requirement"
        maxWidth="max-w-xl"
      >
        {submitMatchTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitMatchTarget} />
            <Textarea
              label="Notes (Optional)"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitMatchTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitCandidate} loading={submitLoading}>
                Confirm Submission
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <SubmissionDetailDrawer
        submissionId={drawerSubmissionId}
        onClose={() => setDrawerSubmissionId(null)}
        role={role}
      />

      <DuplicateDialog
        open={Boolean(dupReason)}
        onClose={() => setDupReason(null)}
        reason={dupReason}
      />

      {/* Explainable Match Evidence Inspection Modal */}
      <Dialog
        open={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        title="Explainable Match Evidence Breakdown"
        description="Deterministic score, matched vs unproven skills, experience alignment, and recruiter override."
        maxWidth="max-w-xl"
      >
        {evidenceTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={evidenceTarget} />
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setEvidenceTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* HQ Edit Candidate 360 Modal */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Candidate 360 Profile & Contacts"
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSaveCandidateEdit} className="space-y-3.5">
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
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={savingEdit}>
              Save Candidate 360
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Admin Link Candidate User Account Modal (admin_link_candidate_account) */}
      <Dialog
        open={linkUserOpen}
        onClose={() => setLinkUserOpen(false)}
        title="Link Candidate Profile to User Account"
        description="Calls admin_link_candidate_account(p_candidate_id, p_user_id) to associate this candidate record with an authenticated user."
      >
        <form onSubmit={handleLinkUserAccount} className="space-y-4">
          <Input
            label="Authenticated User UUID (profiles.id)"
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            value={linkUserIdInput}
            onChange={(e) => setLinkUserIdInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setLinkUserOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={linkingUser} disabled={!linkUserIdInput.trim()}>
              Confirm Link
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

// 3. HQ Submissions Global Pipeline Table Page
export const HqSubmissionsPage: React.FC = () => {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<SubmissionStage | ''>(
    (searchParams.get('stage') as SubmissionStage) || ''
  );
  const [source, setSource] = useState<CandidateSource | ''>('');
  const [validFilter, setValidFilter] = useState('');
  const [drawerSubId, setDrawerSubId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['submissions', page, stage, source, validFilter],
    queryFn: () =>
      fetchSubmissions({
        page,
        stage,
        source,
        isValid:
          validFilter === 'true'
            ? true
            : validFilter === 'false'
              ? false
              : undefined,
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Submissions Pipeline"
        description="Inspect all candidate applications and vendor submissions across requirements."
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as SubmissionStage | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Pipeline Stages' },
            { value: 'applied', label: 'Applied' },
            { value: 'recruiter_review', label: 'Recruiter Review' },
            { value: 'client_review', label: 'Client Review' },
            { value: 'interviewing', label: 'Interviewing' },
            { value: 'offered', label: 'Offered' },
            { value: 'offer_accepted', label: 'Offer Accepted' },
            { value: 'offer_declined', label: 'Offer Declined' },
            { value: 'onboarded', label: 'Onboarded' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'withdrawn', label: 'Withdrawn' },
          ]}
        />
        <Select
          value={source}
          onChange={(e) => {
            setSource(e.target.value as CandidateSource | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Sources' },
            { value: 'vendor', label: 'Vendor Sourced' },
            { value: 'direct', label: 'Direct Applicant' },
            { value: 'internal', label: 'HireNest Sourced' },
          ]}
        />
        <Select
          value={validFilter}
          onChange={(e) => {
            setValidFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Compliance States' },
            { value: 'true', label: 'Valid Submissions' },
            { value: 'false', label: 'Marked Invalid' },
          ]}
        />
        {(stage || source || validFilter) && (
          <Button
            variant="ghost"
            onClick={() => {
              setStage('');
              setSource('');
              setValidFilter('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No submissions match your filters"
          description="Submissions are created when a direct candidate applies or a vendor/recruiter submits a candidate."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Requirement & Client</th>
                  <th className="py-3 px-4">Source Attribution</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4">Compliance</th>
                  <th className="py-3 px-4">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.data.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => setDrawerSubId(sub.id)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {sub.candidates?.full_name || sub.candidate_id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">
                        {sub.requirements?.title || sub.requirement_id}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {sub.requirements?.organizations?.name || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <SourceBadge
                        source={sub.source}
                        vendorName={sub.organizations?.name}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <StageBadge stage={sub.stage} />
                    </td>
                    <td className="py-3 px-4">
                      {sub.is_valid ? (
                        <Badge tone="emerald">Valid</Badge>
                      ) : (
                        <Badge tone="red">Invalid</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDateTime(sub.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <SubmissionDetailDrawer
        submissionId={drawerSubId}
        onClose={() => setDrawerSubId(null)}
        role={profile?.role || 'recruiter'}
      />
    </div>
  );
};

// 4. HQ Interviews & Pending Feedback Queue Page
export const HqInterviewsPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const [feedbackModalTarget, setFeedbackModalTarget] = useState<{
    interviewId: string;
    submissionId: string;
    roundType: InterviewRound;
    candidateName?: string;
  } | null>(null);

  const { data: pendingFeedback = [] } = useQuery({
    queryKey: ['my_pending_feedback'],
    queryFn: fetchMyPendingFeedback,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['interviews', page, status],
    queryFn: () => fetchInterviews({ page, status }),
  });

  const handleStatusChange = async (
    interviewId: string,
    nextStatus: 'completed' | 'cancelled' | 'no_show'
  ) => {
    try {
      await updateInterviewStatusRpc({
        p_interview_id: interviewId,
        p_status: nextStatus,
      });
      toast({ title: `Interview marked ${nextStatus}`, tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['interviews'] });
      queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
    } catch (err) {
      toast({
        title: 'Could not update interview',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interviews & Pending Feedback Queue"
        description="Manage scheduled interview rounds and submit mandatory post-interview assessments."
      />

      {/* Pending Feedback Queue (my_pending_feedback) */}
      {pendingFeedback.length > 0 && (
        <Card className="p-5 border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-3">
          <h3 className="text-xs font-semibold text-red-800 dark:text-red-200">
            My Pending Feedback Queue ({pendingFeedback.length})
          </h3>
          <div className="divide-y divide-red-200/60 dark:divide-red-900/40 text-xs">
            {pendingFeedback.map((pf) => (
              <div
                key={pf.interview_id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {pf.candidate_name}
                  </span>{' '}
                  · {pf.requirement_title} ·{' '}
                  <span className="font-mono">
                    Round #{pf.round_number} ({ROUND_LABELS[pf.round_type]})
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setFeedbackModalTarget({
                      interviewId: pf.interview_id,
                      submissionId: pf.submission_id,
                      roundType: pf.round_type,
                      candidateName: pf.candidate_name,
                    })
                  }
                >
                  Complete Feedback Form
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InterviewStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Interview Statuses' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'no_show', label: 'No Show' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No interviews found"
          description="Schedule interviews from a candidate's pipeline submission drawer."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Candidate & Requirement</th>
                  <th className="py-3 px-4">Round</th>
                  <th className="py-3 px-4">Scheduled At</th>
                  <th className="py-3 px-4">Mode</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.data.map((iv) => (
                  <tr key={iv.id}>
                    <td className="py-3 px-4">
                      <div className="font-semibold">
                        {iv.submissions?.candidates?.full_name || 'Candidate'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {iv.submissions?.requirements?.title || 'Requirement'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      Round #{iv.round_number} · {ROUND_LABELS[iv.round_type]}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {formatLocalDateTime(iv.scheduled_at)}
                    </td>
                    <td className="py-3 px-4 uppercase font-mono text-[11px]">
                      {iv.mode}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        tone={
                          iv.status === 'completed'
                            ? 'emerald'
                            : iv.status === 'scheduled'
                              ? 'indigo'
                              : 'red'
                        }
                      >
                        {iv.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5">
                      {iv.status === 'scheduled' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(iv.id, 'completed')}
                          >
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(iv.id, 'no_show')}
                          >
                            No-Show
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(iv.id, 'cancelled')}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {iv.status === 'completed' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            setFeedbackModalTarget({
                              interviewId: iv.id,
                              submissionId: iv.submission_id,
                              roundType: iv.round_type,
                              candidateName: iv.submissions?.candidates?.full_name,
                            })
                          }
                        >
                          Rate Interview
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      {feedbackModalTarget && (
        <InterviewFeedbackModal
          open={Boolean(feedbackModalTarget)}
          onClose={() => setFeedbackModalTarget(null)}
          interviewId={feedbackModalTarget.interviewId}
          submissionId={feedbackModalTarget.submissionId}
          roundType={feedbackModalTarget.roundType}
          candidateName={feedbackModalTarget.candidateName}
          onSubmitted={() => {
            queryClient.invalidateQueries({ queryKey: ['interviews'] });
            queryClient.invalidateQueries({ queryKey: ['my_pending_feedback'] });
          }}
        />
      )}
    </div>
  );
};

// 5. HQ Duplicates & Ownership Page (resolve_duplicate_flag; never auto-merge)
export const HqDuplicatesPage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === 'admin';
  const prefix = isAdmin ? '/admin' : '/recruiter';

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | ''>('open');
  const [selectedFlag, setSelectedFlag] = useState<DuplicateFlag | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [newOwnerVendorId, setNewOwnerVendorId] = useState('');
  const [resolving, setResolving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['duplicate_flags', page, statusFilter],
    queryFn: () => fetchDuplicateFlags({ page, status: statusFilter }),
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['organizations_vendors'],
    queryFn: () => fetchOrganizations({ type: 'vendor', page: 1, pageSize: 100 }),
  });

  const handleResolveFlag = async () => {
    if (!selectedFlag || !resolutionNote.trim()) return;
    setResolving(true);
    try {
      await resolveDuplicateFlag({
        p_flag_id: selectedFlag.id,
        p_note: resolutionNote.trim(),
        ...(isAdmin && newOwnerVendorId
          ? { p_new_owner_vendor_org_id: newOwnerVendorId }
          : {}),
      });
      toast({
        title: 'Duplicate ownership flag resolved',
        description: 'Records remain distinct; ownership resolution logged.',
        tone: 'success',
      });
      setSelectedFlag(null);
      setResolutionNote('');
      setNewOwnerVendorId('');
      queryClient.invalidateQueries({ queryKey: ['duplicate_flags'] });
      queryClient.invalidateQueries({ queryKey: ['admin_dashboard_summary'] });
    } catch (err) {
      toast({
        title: 'Resolution failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duplicates & Ownership Governance"
        description="Review attempted duplicate candidate or submission flags. HireNestOS never auto-merges profiles."
      />

      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as 'open' | 'resolved' | '');
            setPage(1);
          }}
          options={[
            { value: 'open', label: 'Open Flags' },
            { value: 'resolved', label: 'Resolved Flags' },
            { value: '', label: 'All Flags' },
          ]}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No duplicate flags in this view"
          description="All ownership flags have been reviewed."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Kind & Match Type</th>
                  <th className="py-3 px-4">Existing Candidate</th>
                  <th className="py-3 px-4">Attempted Name & Org</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.data.map((fl) => (
                  <tr key={fl.id}>
                    <td className="py-3 px-4">
                      <span className="font-semibold capitalize">{fl.kind}</span> ·{' '}
                      <span className="font-mono text-slate-500">{fl.match_type}</span>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`${prefix}/candidates/${fl.existing_candidate_id}`}
                        className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {fl.candidates?.full_name || fl.existing_candidate_id}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div>{fl.attempted_name || '—'}</div>
                      <div className="text-[11px] text-slate-500">
                        {fl.organizations?.name || 'Direct / HQ'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge tone={fl.status === 'open' ? 'amber' : 'emerald'}>
                        {fl.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDateTime(fl.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {fl.status === 'open' ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedFlag(fl);
                            setResolutionNote('');
                            setNewOwnerVendorId('');
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Resolve
                        </Button>
                      ) : (
                        <span className="text-slate-500">{fl.resolution_note}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <Dialog
        open={Boolean(selectedFlag)}
        onClose={() => setSelectedFlag(null)}
        title="Resolve Duplicate & Ownership Flag"
        description="Resolves the flag with an audit note. Admin may optionally reassign current vendor association."
      >
        <div className="space-y-4">
          <Textarea
            label="Resolution Note (Required)"
            rows={3}
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="Document ownership verification outcome..."
          />
          {isAdmin && (
            <Select
              label="Reassign Current Vendor Association (Admin Only · Optional)"
              value={newOwnerVendorId}
              onChange={(e) => setNewOwnerVendorId(e.target.value)}
              options={[
                { value: '', label: 'Keep current owner unchanged' },
                ...(vendorsData?.data || []).map((v) => ({
                  value: v.id,
                  label: v.name,
                })),
              ]}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSelectedFlag(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleResolveFlag}
              loading={resolving}
              disabled={!resolutionNote.trim()}
            >
              Confirm Resolution
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
