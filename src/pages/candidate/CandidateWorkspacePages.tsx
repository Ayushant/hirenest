import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Send, Upload } from 'lucide-react';
import {
  PageHeader,
  Card,
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
} from '../../components/ui/kit';
import { StageBadge } from '../../components/domain/DomainBadges';
import { MatchEvidencePanel } from '../../components/domain/MatchEvidence';
import { CandidateFormModal } from '../../components/domain/CandidateFormModal';
import { SubmissionDetailDrawer } from '../../components/domain/SubmissionDetailDrawer';
import { DuplicateDialog } from '../../components/domain/DuplicateDialog';
import {
  fetchMyCandidateProfile,
  fetchCandidateContacts,
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
import { formatLocalDate, formatLocalDateTime } from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type { CandidateMatch, Requirement } from '../../types/db';

// Section 9 Copy Rule: Use "Job" (not "Requirement") in the candidate view.

// 1. Candidate Jobs for Me Page (with Onboarding Wizard if no candidate profile exists)
export const CandidateJobsForMePage: React.FC = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
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
          title="Welcome to HireNestOS Candidate Portal"
          description="Complete your candidate profile and upload your resume to discover matched open jobs."
        />
        <Card className="p-8 text-center space-y-4 max-w-xl mx-auto">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Create Your Candidate Profile
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter your experience, skills, and upload your resume. If an agency or recruiter
            previously registered your profile, HireNest HQ will link it to your account.
          </p>
          <Button onClick={() => setOnboardingOpen(true)}>
            Start Profile Wizard
          </Button>
        </Card>

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

  const appliedReqIds = new Set(
    (myApplications?.data || []).map((s) => s.requirement_id)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs for Me"
        description="Open public jobs ranked by deterministic skill and experience alignment with your profile."
      />

      {loadingMatches ? (
        <TableSkeleton rows={5} cols={4} />
      ) : !matchesData?.data.length ? (
        <EmptyState
          title="No matched jobs yet"
          description="Update your skills on My Profile or browse all open jobs."
        />
      ) : (
        <div className="space-y-4">
          {matchesData.data.map((m) => {
            const job = m.requirements;
            const isApplied = appliedReqIds.has(m.requirement_id);
            return (
              <Card key={m.id} className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {job?.title || 'Open Job'}
                      </h3>
                      {isApplied ? (
                        <Badge tone="emerald">Applied</Badge>
                      ) : (
                        <Badge tone="indigo">Potential match</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {job?.location || '—'} ({job?.work_mode || '—'}) ·{' '}
                      {job?.min_experience ?? 0}–{job?.max_experience ?? 0} yrs experience
                    </p>
                  </div>

                  <div>
                    {isApplied ? (
                      <Button size="sm" variant="outline" disabled>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
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
                        <Send className="h-3.5 w-3.5" />
                        Apply to Job
                      </Button>
                    )}
                  </div>
                </div>

                <MatchEvidencePanel match={m} isCandidateView />
              </Card>
            );
          })}

          <Card>
            <Pagination
              page={page}
              totalCount={matchesData.count}
              onPageChange={setPage}
            />
          </Card>
        </div>
      )}

      {/* Apply Confirmation Dialog */}
      <Dialog
        open={Boolean(applyTarget)}
        onClose={() => setApplyTarget(null)}
        title={`Apply to ${applyTarget?.title || 'Job'}`}
        description="Confirming creates an active application in the HireNestOS recruitment pipeline."
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Your profile and resume will be submitted directly to HireNest Recruiters as a
            <strong> Direct applicant</strong>.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApplyTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmApply} loading={applying}>
              Confirm Application
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
        status: 'open',
        isPublic: true,
        search,
      }),
  });

  const appliedReqIds = new Set(
    (myApplications?.data || []).map((s) => s.requirement_id)
  );

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
    <div className="space-y-6">
      <PageHeader
        title="Browse All Open Jobs"
        description="Explore all public open positions across HireNest partner companies."
      />

      <div className="flex items-center gap-3 max-w-md">
        <Input
          placeholder="Search job title..."
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

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No open public jobs match your search"
          description="Check back soon or clear your search filter."
        />
      ) : (
        <div className="space-y-4">
          {data.data.map((job) => {
            const isApplied = appliedReqIds.has(job.id);
            return (
              <Card key={job.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {job.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 capitalize">
                      {job.location} · {job.work_mode} · {job.employment_type.replace(/_/g, ' ')} ·{' '}
                      {job.min_experience}–{job.max_experience} yrs
                    </p>
                  </div>
                  {isApplied ? (
                    <Badge tone="emerald">Applied</Badge>
                  ) : (
                    <Button size="sm" onClick={() => setSelectedJob(job)}>
                      Apply Now
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-3">
                  {job.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {job.skills.map((s) => (
                    <Badge key={s} tone="slate">
                      {s}
                    </Badge>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card>
            <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
          </Card>
        </div>
      )}

      <Dialog
        open={Boolean(selectedJob)}
        onClose={() => setSelectedJob(null)}
        title={selectedJob ? `Apply to ${selectedJob.title}` : 'Apply to Job'}
      >
        {selectedJob && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line max-h-60 overflow-y-auto">
              {selectedJob.description}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectedJob(null)}>
                Cancel
              </Button>
              <Button onClick={handleApply} loading={applying}>
                Confirm Application
              </Button>
            </div>
          </div>
        )}
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
    <div className="space-y-6">
      <PageHeader
        title="My Applications"
        description="Track your application stages, view scheduled interviews, or withdraw an application."
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No applications submitted yet"
          description="Explore Jobs for Me or Browse All Open Jobs to apply."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 font-semibold text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Job Title</th>
                <th className="py-3 px-4">Application Status</th>
                <th className="py-3 px-4">Applied Date</th>
                <th className="py-3 px-4 text-right">Timeline & Actions</th>
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
                    {sub.requirements?.title || 'Job'}
                  </td>
                  <td className="py-3 px-4">
                    <StageBadge stage={sub.stage} candidateView />
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatLocalDate(sub.created_at)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button size="sm" variant="outline">
                      View Timeline / Withdraw
                    </Button>
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

  useEffect(() => {
    if (myCandidate) {
      setFullName(myCandidate.full_name);
      setCurrentTitle(myCandidate.current_title || '');
      setLocation(myCandidate.location || '');
      setExpYears(String(myCandidate.total_experience_years ?? 0));
      setSkills(myCandidate.skills || []);
      setSummary(myCandidate.summary || '');
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
    setSaving(true);
    try {
      await updateCandidateProfile(myCandidate.id, {
        full_name: fullName.trim(),
        current_title: currentTitle.trim() || null,
        location: location.trim() || null,
        total_experience_years: Number(expYears),
        skills,
        summary: summary.trim() || null,
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
      toast({ title: 'Resume updated', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my_candidate_profile'] });
    } catch (uploadErr) {
      toast({
        title: 'Resume upload failed',
        description: mapSupabaseError(uploadErr),
        tone: 'error',
      });
    }
  };

  const handleOpenResume = async () => {
    if (!myCandidate?.resume_path) return;
    try {
      const signed = await getResumeSignedUrl(myCandidate.resume_path);
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
        description="Go to Jobs for Me to run the profile creation wizard."
      />
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="My Candidate Profile"
        description="Keep your skills, experience, and resume up to date to improve job match accuracy."
        actions={
          <div className="flex items-center gap-2">
            {myCandidate.resume_path && (
              <Button size="sm" variant="outline" onClick={handleOpenResume}>
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
          </div>
        }
      />

      <Card className="p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            label="My Skills (Used for job matching)"
            skills={skills}
            onChange={setSkills}
          />

          <Textarea
            label="Summary"
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save Profile Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
