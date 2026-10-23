import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, ExternalLink } from 'lucide-react';
import {
  PageHeader,
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

// 1. HQ Candidates List Page
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
  const [modalMode, setModalMode] = useState<'single' | 'bulk'>('single');

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

  const hasFilters = Boolean(
    originalSource || ownerVendorId || skill || minExp || maxExp || search
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Talent pool with resume auto-parsing, original source attribution, current vendor association, and masked PII in list views."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setModalMode('bulk');
                setAddOpen(true);
              }}
            >
              Bulk upload resumes
            </Button>
            <Button
              onClick={() => {
                setModalMode('single');
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add candidate
            </Button>
          </div>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-52">
          <Input
            placeholder="Search full name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-44">
          <Select
            value={originalSource}
            onChange={(e) => {
              setOriginalSource(e.target.value as CandidateSource | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All sources' },
              { value: 'vendor', label: 'Vendor' },
              { value: 'direct', label: 'Direct' },
              { value: 'internal', label: 'HireNest' },
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            value={ownerVendorId}
            onChange={(e) => {
              setOwnerVendorId(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All vendor owners' },
              ...(vendorsData?.data || []).map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </div>
        <div className="w-40">
          <Input
            placeholder="Skill (exact)..."
            value={skill}
            onChange={(e) => {
              setSkill(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-28">
          <Input
            placeholder="Min exp"
            type="number"
            value={minExp}
            onChange={(e) => {
              setMinExp(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-28">
          <Input
            placeholder="Max exp"
            type="number"
            value={maxExp}
            onChange={(e) => {
              setMaxExp(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setOriginalSource('');
              setOwnerVendorId('');
              setSkill('');
              setMinExp('');
              setMaxExp('');
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
          title="No candidates found"
          description="Add a candidate to the pool or clear your active filters."
          actionLabel="Add candidate"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Original source</th>
                  <th>Vendor association</th>
                  <th>Masked contact</th>
                  <th>Skills</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => {
                  const rawContacts = Array.isArray(c.candidate_contacts)
                    ? c.candidate_contacts[0]
                    : (c.candidate_contacts as CandidateContacts | null);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`${prefix}/candidates/${c.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {c.full_name}
                        </div>
                        <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                          {c.current_title || '—'} ·{' '}
                          <span className="font-mono tabular-nums">
                            {c.total_experience_years ?? '—'}y
                          </span>{' '}
                          · {c.location || '—'}
                        </div>
                      </td>
                      <td>
                        <SourceBadge
                          source={c.original_source}
                          vendorName={c.source_vendor?.name}
                        />
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {c.owner_vendor?.name || 'None'}
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        <div>{maskEmail(rawContacts?.email)}</div>
                        <div>{maskPhone(rawContacts?.phone)}</div>
                      </td>
                      <td className="max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {(c.skills || []).slice(0, 4).map((sk) => (
                            <span
                              key={sk}
                              className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[12px] leading-[16px] text-[var(--text-primary)]"
                            >
                              {sk}
                            </span>
                          ))}
                          {(c.skills?.length || 0) > 4 && (
                            <span className="text-[12px] leading-[16px] font-mono text-[var(--text-tertiary)]">
                              +{c.skills.length - 4}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                        {formatLocalDate(c.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <CandidateFormModal
        open={addOpen}
        defaultMode={modalMode}
        onClose={() => setAddOpen(false)}
        onCreated={(candidateId) => {
          queryClient.invalidateQueries({ queryKey: ['candidates'] });
          if (modalMode === 'single') {
            navigate(`${prefix}/candidates/${candidateId}`);
          }
        }}
      />
    </div>
  );
};

// 2. HQ Candidate 360 Detail Page: Two columns at 1200px (main ~760px + 320px right rail)
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

  const [evidenceTarget, setEvidenceTarget] = useState<CandidateMatch | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<CandidateMatch | null>(null);
  const [overrideScoreInput, setOverrideScoreInput] = useState('');
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  const [submitMatchTarget, setSubmitMatchTarget] = useState<CandidateMatch | null>(null);
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [dupReason, setDupReason] = useState<string | null>(null);

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
      toast({ title: 'Candidate profile updated', tone: 'success' });
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
      toast({ title: 'Resume uploaded', tone: 'success' });
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
        } yrs experience`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {cand.resume_path && (
              <Button size="sm" variant="outline" onClick={handleOpenResume}>
                View resume
              </Button>
            )}
            <label className="inline-flex items-center gap-1.5 h-7 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)]">
              <Upload strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              <span>{cand.resume_path ? 'Replace resume' : 'Upload resume'}</span>
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
                {cand.user_id ? 'Relink user' : 'Link user'}
              </Button>
            )}
            <Button size="sm" onClick={startEditCandidate}>
              Edit profile
            </Button>
          </div>
        }
      />

      {/* Two columns at 1200px: main (~760px) + right rail (320px) */}
      <div className="flex flex-col lg:flex-row items-start gap-8">
        {/* Main Column */}
        <div className="flex-1 min-w-0 w-full space-y-6">
          {/* Summary & Skills */}
          <div className="space-y-4 pb-6 border-b border-[var(--border)]">
            {cand.summary && (
              <div className="space-y-1">
                <span className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)] block">
                  Summary
                </span>
                <p className="text-[14px] leading-[20px] text-[var(--text-primary)] whitespace-pre-line">
                  {cand.summary}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)] block">
                Skills ({cand.skills?.length || 0})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(cand.skills || []).map((sk) => (
                  <span
                    key={sk}
                    className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
                  >
                    {sk}
                  </span>
                ))}
              </div>
            </div>
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
                label: 'Submissions',
                count: submissions.length,
              },
              ...(isAdmin ? [{ id: 'audit', label: 'Audit log' }] : []),
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'matches' && (
            <div className="space-y-4">
              {!matchesData?.data.length ? (
                <EmptyState
                  title="No matching open requirements"
                  description="Potential matches are calculated automatically when open requirements match this candidate's skills."
                />
              ) : (
                <div>
                  <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
                    {matchesData.data.map((m, idx) => {
                      const rank = (matchesPage - 1) * 25 + idx + 1;
                      const existingSub = submissions.find(
                        (s) => s.requirement_id === m.requirement_id
                      );
                      const isOverridden =
                        m.override_score !== null && m.override_score !== undefined;

                      return (
                        <div
                          key={m.id}
                          className="py-3 px-2 hover:bg-[var(--bg-hover)] transition-colors space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono tabular-nums text-[12px] leading-[16px] text-[var(--text-tertiary)] w-6">
                                #{rank}
                              </span>
                              <Link
                                to={`${prefix}/requirements/${m.requirement_id}`}
                                className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] truncate"
                              >
                                {m.requirements?.title || m.requirement_id}
                              </Link>
                              <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                                {m.requirements?.organizations?.name || '—'}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {!existingSub ? (
                                <Badge tone="amber">Potential match</Badge>
                              ) : (
                                <Badge tone="emerald">
                                  {STAGE_LABELS[existingSub.stage]}
                                </Badge>
                              )}
                              <ScoreBar score={m.final_score} isOverridden={isOverridden} />
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEvidenceTarget(m)}
                                >
                                  Evidence
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setOverrideTarget(m);
                                    setOverrideScoreInput(
                                      m.override_score !== null ? String(m.override_score) : ''
                                    );
                                    setOverrideReasonInput(m.override_reason || '');
                                  }}
                                >
                                  Override
                                </Button>
                                {existingSub ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setDrawerSubmissionId(existingSub.id)}
                                  >
                                    Pipeline
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setSubmitMatchTarget(m);
                                      setSubmitNotes('');
                                    }}
                                  >
                                    Submit
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="pl-9 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(m.matched_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  className="inline-flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[12px] leading-[16px] text-[var(--text-primary)]"
                                >
                                  {sk}
                                </span>
                              ))}
                              {(m.unproven_skills || []).map((sk) => (
                                <span
                                  key={sk}
                                  title="Not found on profile; not proof the skill is missing"
                                  className="inline-flex items-center rounded-[6px] border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]"
                                >
                                  {sk}
                                </span>
                              ))}
                            </div>

                            {isOverridden && (
                              <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono tabular-nums">
                                Overridden by recruiter · {m.override_score}
                                {m.override_reason ? ` · '${m.override_reason}'` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Pagination
                    page={matchesPage}
                    totalCount={matchesData.count}
                    onPageChange={setMatchesPage}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'submissions' && (
            <div>
              {submissions.length === 0 ? (
                <EmptyState
                  title="No submissions recorded"
                  description="Submissions appear here when this candidate applies or is submitted to a requirement."
                />
              ) : (
                <div className="overflow-x-auto border-t border-[var(--border)]">
                  <table>
                    <thead>
                      <tr>
                        <th>Requirement</th>
                        <th>Submission source</th>
                        <th>Submitting vendor</th>
                        <th>Stage</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => setDrawerSubmissionId(s.id)}
                          className="cursor-pointer"
                        >
                          <td className="font-medium">
                            {s.requirements?.title || s.requirement_id}
                          </td>
                          <td>
                            <SourceBadge source={s.source} vendorName={s.organizations?.name} />
                          </td>
                          <td className="text-[var(--text-secondary)]">
                            {s.organizations?.name || 'Direct / HireNest'}
                          </td>
                          <td>
                            <StageBadge stage={s.stage} />
                          </td>
                          <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                            {formatLocalDateTime(s.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'audit' && isAdmin && (
            <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
              {!auditData?.data.length ? (
                <p className="py-4 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  No audit records for this candidate.
                </p>
              ) : (
                auditData.data.map((log) => (
                  <div
                    key={log.id}
                    className="h-10 px-3 flex items-center justify-between text-[13px] leading-[20px]"
                  >
                    <span>
                      <strong className="uppercase font-mono">{log.action}</strong> by{' '}
                      {log.actor_role || 'system'}
                    </span>
                    <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDateTime(log.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Rail (320px): Key facts as label/value pairs */}
        <aside className="w-full lg:w-[320px] shrink-0 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-4">
          <span className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)] block">
            Key facts
          </span>

          <div className="divide-y divide-[var(--border)] text-[13px] leading-[20px]">
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Original source</span>
              <SourceBadge
                source={cand.original_source}
                vendorName={cand.source_vendor?.name}
              />
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Vendor owner</span>
              <span className="text-[var(--text-primary)] truncate">
                {cand.owner_vendor?.name || 'None'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Experience</span>
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {cand.total_experience_years ?? 0} yrs
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Location</span>
              <span className="text-[var(--text-primary)]">{cand.location || '—'}</span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Email</span>
              <span className="font-mono text-[12px] text-[var(--text-primary)] truncate">
                {contacts?.email || '—'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Phone</span>
              <span className="font-mono text-[12px] text-[var(--text-primary)]">
                {contacts?.phone || '—'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">LinkedIn</span>
              {contacts?.linkedin_url ? (
                <a
                  href={contacts.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline inline-flex items-center gap-1"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-[var(--text-tertiary)]">—</span>
              )}
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Auth user</span>
              <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                {cand.user_id ? cand.user_id.slice(0, 10) + '…' : 'Unlinked'}
              </span>
            </div>
            <div className="py-2 flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">Resume SHA-256</span>
              <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                {cand.resume_hash ? cand.resume_hash.slice(0, 10) + '…' : '—'}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* Override Modal */}
      <Dialog
        open={Boolean(overrideTarget)}
        onClose={() => setOverrideTarget(null)}
        title="Override match score"
      >
        <div className="space-y-4">
          <Input
            label="Override score (0–100 or blank to clear)"
            type="number"
            min={0}
            max={100}
            value={overrideScoreInput}
            onChange={(e) => setOverrideScoreInput(e.target.value)}
          />
          <Textarea
            label="Reason (required)"
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
              Save override
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Submit Candidate Modal */}
      <Dialog
        open={Boolean(submitMatchTarget)}
        onClose={() => setSubmitMatchTarget(null)}
        title="Submit candidate to requirement"
        maxWidth="max-w-[640px]"
      >
        {submitMatchTarget && (
          <div className="space-y-4">
            <MatchEvidencePanel match={submitMatchTarget} />
            <Textarea
              label="Notes (optional)"
              rows={3}
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitMatchTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitCandidate} loading={submitLoading}>
                Confirm submission
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

      {/* Match Evidence Inspection Modal */}
      <Dialog
        open={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        title="Match evidence"
        description="Deterministic score, matched vs unproven skills, and recruiter override."
        maxWidth="max-w-[640px]"
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
        title="Edit candidate profile"
        maxWidth="max-w-[640px]"
      >
        <form onSubmit={handleSaveCandidateEdit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <Input
              label="Total experience (years)"
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
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={savingEdit}>
              Save changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Admin Link Candidate User Account Modal */}
      <Dialog
        open={linkUserOpen}
        onClose={() => setLinkUserOpen(false)}
        title="Link candidate profile to user account"
        description="Associates this candidate record with an authenticated user UUID."
      >
        <form onSubmit={handleLinkUserAccount} className="space-y-4">
          <Input
            label="User UUID (profiles.id)"
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
              Confirm link
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
        title="Submissions"
        description="All candidate applications and vendor submissions across requirements."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <Select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as SubmissionStage | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All stages' },
              { value: 'applied', label: 'Applied' },
              { value: 'recruiter_review', label: 'Recruiter review' },
              { value: 'client_review', label: 'Client review' },
              { value: 'interviewing', label: 'Interviewing' },
              { value: 'offered', label: 'Offered' },
              { value: 'offer_accepted', label: 'Offer accepted' },
              { value: 'offer_declined', label: 'Offer declined' },
              { value: 'onboarded', label: 'Onboarded' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as CandidateSource | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All sources' },
              { value: 'vendor', label: 'Vendor' },
              { value: 'direct', label: 'Direct' },
              { value: 'internal', label: 'HireNest' },
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            value={validFilter}
            onChange={(e) => {
              setValidFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All compliance' },
              { value: 'true', label: 'Valid' },
              { value: 'false', label: 'Invalid' },
            ]}
          />
        </div>
        {(stage || source || validFilter) && (
          <Button
            size="sm"
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
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Requirement & client</th>
                  <th>Source</th>
                  <th>Stage</th>
                  <th>Compliance</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => setDrawerSubId(sub.id)}
                    className="cursor-pointer"
                  >
                    <td className="font-medium">
                      {sub.candidates?.full_name || sub.candidate_id}
                    </td>
                    <td>
                      <div className="text-[var(--text-primary)]">
                        {sub.requirements?.title || sub.requirement_id}
                      </div>
                      <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                        {sub.requirements?.organizations?.name || '—'}
                      </div>
                    </td>
                    <td>
                      <SourceBadge
                        source={sub.source}
                        vendorName={sub.organizations?.name}
                      />
                    </td>
                    <td>
                      <StageBadge stage={sub.stage} />
                    </td>
                    <td>
                      {sub.is_valid ? (
                        <Badge tone="emerald">Valid</Badge>
                      ) : (
                        <Badge tone="red">Invalid</Badge>
                      )}
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDateTime(sub.created_at)}
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
        title="Interviews"
        description="Scheduled interview rounds and mandatory post-interview structured feedback."
      />

      {/* Needs attention: Pending Feedback Queue */}
      {pendingFeedback.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
            Awaiting your feedback ({pendingFeedback.length})
          </h3>
          <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
            {pendingFeedback.map((pf) => (
              <div
                key={pf.interview_id}
                className="py-2.5 px-3 flex flex-wrap items-center justify-between gap-2 text-[13px] leading-[20px]"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)] shrink-0" />
                  <span className="font-medium text-[var(--text-primary)]">
                    {pf.candidate_name}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    · {pf.requirement_title} ·{' '}
                    <span className="font-mono">
                      #{pf.round_number} {ROUND_LABELS[pf.round_type]}
                    </span>
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
                  Submit feedback
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2">
        <div className="w-48">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as InterviewStatus | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'completed', label: 'Completed' },
              { value: 'no_show', label: 'No show' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        {status && (
          <Button size="sm" variant="ghost" onClick={() => setStatus('')}>
            Clear filters
          </Button>
        )}
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
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Candidate & requirement</th>
                  <th>Round</th>
                  <th>Scheduled</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((iv) => (
                  <tr key={iv.id}>
                    <td>
                      <div className="font-medium">
                        {iv.submissions?.candidates?.full_name || 'Candidate'}
                      </div>
                      <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                        {iv.submissions?.requirements?.title || 'Requirement'}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-[var(--text-tertiary)] mr-1">
                        #{iv.round_number}
                      </span>
                      {ROUND_LABELS[iv.round_type]}
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                      {formatLocalDateTime(iv.scheduled_at)}
                    </td>
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {iv.mode}
                    </td>
                    <td>
                      <Badge
                        tone={
                          iv.status === 'completed'
                            ? 'emerald'
                            : iv.status === 'scheduled'
                              ? 'slate'
                              : 'red'
                        }
                      >
                        {iv.status}
                      </Badge>
                    </td>
                    <td className="text-right space-x-1">
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
                            variant="ghost"
                            onClick={() => handleStatusChange(iv.id, 'no_show')}
                          >
                            No-show
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
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
                          Submit feedback
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
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

// 5. HQ Duplicates & Ownership Page
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
        title: 'Duplicate flag resolved',
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
        title="Duplicates & ownership"
        description="Review attempted duplicate candidate or submission flags. HireNestOS never auto-merges profiles."
      />

      <div className="flex items-center gap-2">
        <div className="w-44">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'open' | 'resolved' | '');
              setPage(1);
            }}
            options={[
              { value: 'open', label: 'Open flags' },
              { value: 'resolved', label: 'Resolved flags' },
              { value: '', label: 'All flags' },
            ]}
          />
        </div>
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
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Kind & match type</th>
                  <th>Existing candidate</th>
                  <th>Attempted name & org</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((fl) => (
                  <tr key={fl.id}>
                    <td>
                      <span className="font-medium capitalize">{fl.kind}</span> ·{' '}
                      <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {fl.match_type}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`${prefix}/candidates/${fl.existing_candidate_id}`}
                        className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {fl.candidates?.full_name || fl.existing_candidate_id}
                      </Link>
                    </td>
                    <td>
                      <div>{fl.attempted_name || '—'}</div>
                      <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                        {fl.organizations?.name || 'Direct / HQ'}
                      </div>
                    </td>
                    <td>
                      <Badge tone={fl.status === 'open' ? 'amber' : 'emerald'}>
                        {fl.status}
                      </Badge>
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDateTime(fl.created_at)}
                    </td>
                    <td className="text-right">
                      {fl.status === 'open' ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedFlag(fl);
                            setResolutionNote('');
                            setNewOwnerVendorId('');
                          }}
                        >
                          Resolve
                        </Button>
                      ) : (
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          {fl.resolution_note}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      <Dialog
        open={Boolean(selectedFlag)}
        onClose={() => setSelectedFlag(null)}
        title="Resolve duplicate & ownership flag"
        description="Resolves the flag with an audit note. Admin may optionally reassign vendor association."
      >
        <div className="space-y-4">
          <Textarea
            label="Resolution note (required)"
            rows={3}
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="Document ownership verification outcome..."
          />
          {isAdmin && (
            <Select
              label="Reassign vendor association (admin · optional)"
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
              Confirm resolution
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
