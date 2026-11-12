import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Share2,
  MessageCircle,
  Users,
} from 'lucide-react';
import { fetchPublicJob } from '../../api/publicJobs';
import { useAuth } from '../../auth/AuthProvider';
import { applyToRequirementRpc } from '../../api/submissions';
import { supabase } from '../../lib/supabase';
import { parseJobDescription } from '../../lib/jobDescription';
import { mapSupabaseError } from '../../lib/errors';
import { Button, Card, Dialog, Input } from '../../components/ui/kit';
import { PublicNav, PUBLIC_FONT } from './PublicNav';

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  contract: 'Contract',
  contract_to_hire: 'Contract to Hire',
  part_time: 'Part-time',
};

const WORK_MODE_LABEL: Record<string, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

function formatExperience(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Any';
  if (min != null && max != null) return `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

function formatPostedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export const PublicJobPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, refreshProfile } = useAuth();
  const [applyOpen, setApplyOpen] = useState(false);

  // Route state may carry job data from the short-link resolver (bypasses RLS)
  const routeJobData = (location.state as { jobData?: Record<string, unknown> } | null)?.jobData;

  const {
    data: fetchedJob,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['public_job', slug],
    queryFn: () => fetchPublicJob(slug!),
    enabled: Boolean(slug),
    retry: 1,
  });

  // Use fetched job, or fall back to route state from short-link resolver
  const job = fetchedJob || (routeJobData ? {
    id: String(routeJobData.id || ''),
    slug: String(routeJobData.slug || routeJobData.id || ''),
    title: String(routeJobData.title || ''),
    description: String(routeJobData.description || ''),
    skills: Array.isArray(routeJobData.skills) ? routeJobData.skills as string[] : [],
    min_experience: typeof routeJobData.min_experience === 'number' ? routeJobData.min_experience : null,
    max_experience: typeof routeJobData.max_experience === 'number' ? routeJobData.max_experience : null,
    location: typeof routeJobData.location === 'string' ? routeJobData.location : null,
    work_mode: (routeJobData.work_mode as 'onsite' | 'hybrid' | 'remote') || null,
    employment_type: (routeJobData.employment_type as 'full_time' | 'contract' | 'contract_to_hire' | 'part_time') || null,
    openings: typeof routeJobData.openings === 'number' ? routeJobData.openings : 1,
    currency: String(routeJobData.currency || 'INR'),
    client_org_name: null,
    status: typeof routeJobData.status === 'string' ? routeJobData.status : undefined,
    posted_at: String(routeJobData.created_at || new Date().toISOString()),
  } : null);

  useEffect(() => {
    if (!job) return;
    document.title = `${job.title} - ${job.client_org_name || 'HireNest'}`;
    const metaDescription = document.querySelector('meta[name="description"]');
    const desc = (job.description || '').slice(0, 160);
    if (metaDescription) metaDescription.setAttribute('content', desc);
  }, [job]);

  // If the visitor arrives with ?apply=1 (e.g. after an external auth
  // redirect), re-open the apply modal automatically.
  useEffect(() => {
    if (!job) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('apply') === '1' && !(job.status && job.status !== 'open')) setApplyOpen(true);
  }, [job]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: job?.title, text: job?.title, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const whatsAppHref = useMemo(() => {
    if (!job) return '#';
    const text = `${job.title} at ${job.client_org_name || 'HireNest'} - ${window.location.href}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [job]);

  const isClosedJob = Boolean(job?.status && job.status !== 'open');

  if (isLoading && !job) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--app-bg)', color: 'var(--text-secondary)' }}
      >
        <div className="animate-pulse text-sm">Loading job…</div>
      </div>
    );
  }

  if ((isError && !job) || !job) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
      >
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">We couldn&apos;t find this role</h1>
          <p
            className="text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            The link may be incomplete. Browse the roles we&apos;re hiring for right now.
          </p>
          <Link
            to="/jobs"
            className="inline-block mt-2 mr-4 text-sm font-medium underline"
            style={{ color: 'var(--accent)' }}
          >
            View open roles
          </Link>
          <Link
            to="/"
            className="inline-block mt-2 text-sm underline"
            style={{ color: 'var(--accent)' }}
          >
            Return to HireNest
          </Link>
        </div>
      </div>
    );
  }

  const empLabel = EMPLOYMENT_LABEL[job.employment_type || ''] || 'Full-time';
  const heroChip = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200';
  const overview = [
    { icon: <MapPin className="h-4 w-4" />, label: 'Location', value: job.location || '-' },
    { icon: <Building2 className="h-4 w-4" />, label: 'Work mode', value: job.work_mode ? WORK_MODE_LABEL[job.work_mode] : '-' },
    { icon: <Clock className="h-4 w-4" />, label: 'Experience', value: formatExperience(job.min_experience, job.max_experience) },
    { icon: <Briefcase className="h-4 w-4" />, label: 'Job type', value: empLabel },
    { icon: <Users className="h-4 w-4" />, label: 'Openings', value: `${job.openings}` },
    { icon: <Calendar className="h-4 w-4" />, label: 'Posted', value: formatPostedDate(job.posted_at) },
    { icon: <Briefcase className="h-4 w-4" />, label: 'Notice', value: 'Negotiable' },
    { icon: <Building2 className="h-4 w-4" />, label: 'Compensation', value: 'On request' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: PUBLIC_FONT }}>
      <PublicNav />

      {/* Hero */}
      <header className="bg-gradient-to-b from-[#1B1A33] to-[#0F111E] text-white">
        <div className="mx-auto max-w-5xl space-y-5 px-5 pb-10 pt-8 sm:px-8 sm:pb-12">
          <Link to="/jobs" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200">
            ← All open roles
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 font-semibold text-indigo-200">
              {job.openings} opening{job.openings > 1 ? 's' : ''}
            </span>
            <span className="font-mono text-slate-400">Posted {formatPostedDate(job.posted_at)}</span>
          </div>
          <h1 className="!text-white text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-[44px]">{job.title}</h1>
          {job.client_org_name && (
            <div className="flex items-center gap-2 text-base text-slate-300 sm:text-lg">
              <Building2 className="h-5 w-5" aria-hidden="true" />
              {job.client_org_name}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {job.location && (
              <span className={heroChip}>
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {job.location}
                {job.work_mode ? ` · ${WORK_MODE_LABEL[job.work_mode]}` : ''}
              </span>
            )}
            <span className={heroChip}>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatExperience(job.min_experience, job.max_experience)}
            </span>
            <span className={heroChip}>
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
              {empLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={isClosedJob}
              onClick={() => setApplyOpen(true)}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-500 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Apply Now
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:flex-none"
            >
              <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Share
            </button>
            <a
              href={whatsAppHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:flex-none"
            >
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
          </div>
          <p className="text-xs text-slate-400">
            {session
              ? 'You are signed in - Apply Now will submit your application.'
              : 'Sign up or sign in to apply - it only takes a minute.'}
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {isClosedJob && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <p className="text-sm font-semibold text-amber-900">This position is no longer accepting applications.</p>
              <Link to="/jobs" className="text-sm font-semibold text-indigo-600 underline">
                View roles we&apos;re hiring for now
              </Link>
            </div>
          )}

          <section className="space-y-4">
            <h2 className="font-['Public_Sans'] text-[11px] font-bold uppercase tracking-wider text-slate-500">About the role</h2>
          {(() => {
            const parsed = parseJobDescription(job.description);
            return (
              <>
                {parsed.body && (
                  <Card className="rounded-xl !border-slate-200 p-6 shadow-sm sm:p-8">
                    <p
                      className="whitespace-pre-wrap text-base leading-relaxed"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {parsed.body.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                        /^https?:\/\//.test(part) ? (
                          <a
                            key={i}
                            href={part}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline break-all"
                          >
                            {part}
                          </a>
                        ) : (
                          part
                        ),
                      )}
                    </p>
                  </Card>
                )}
                {parsed.docId && (
                  <Card className="overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-2 border-b"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Job description
                      </span>
                      <a
                        href={parsed.docUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm underline"
                      >
                        Open in new tab ↗
                      </a>
                    </div>
                    <iframe
                      src={`https://docs.google.com/document/d/${parsed.docId}/preview`}
                      className="w-full border-0"
                      style={{ height: '600px' }}
                      title="Job description"
                    />
                  </Card>
                )}
                {parsed.notes && (
                  <Card className="rounded-xl !border-slate-200 p-6 shadow-sm sm:p-8">
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-2"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Additional information
                    </h3>
                    <p
                      className="whitespace-pre-wrap text-base leading-relaxed"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {parsed.notes}
                    </p>
                  </Card>
                )}
                {!parsed.body && !parsed.docId && !parsed.notes && (
                  <Card className="rounded-xl !border-slate-200 p-6 shadow-sm sm:p-8">
                    <p className="text-base" style={{ color: 'var(--text-tertiary)' }}>
                      Details for this role are available on request.
                    </p>
                  </Card>
                )}
              </>
            );
          })()}
          </section>

          {job.skills.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-['Public_Sans'] text-[11px] font-bold uppercase tracking-wider text-slate-500">Required skills</h2>
              <div className="flex flex-wrap gap-2">
                {job.skills.map((s) => (
                  <span key={s} className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-5 py-4 font-['Public_Sans'] text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Overview
            </h2>
            <dl className="divide-y divide-slate-100">
              {overview.map((o) => (
                <div key={o.label} className="flex items-center justify-between gap-3 px-5 py-3">
                  <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <span className="text-slate-400" aria-hidden="true">{o.icon}</span>
                    {o.label}
                  </dt>
                  <dd className="text-right text-sm font-semibold text-slate-900">{o.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-900">Interested in this role?</div>
            <p className="mt-1 text-xs text-slate-600">Create a free candidate account to apply in minutes.</p>
            <button
              type="button"
              disabled={isClosedJob}
              onClick={() => setApplyOpen(true)}
              className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply Now
            </button>
          </div>
        </aside>
      </main>

      <ApplyModal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        job={job}
        session={session}
        profile={profile}
        refreshProfile={refreshProfile}
        onApplied={() => {
          setApplyOpen(false);
          navigate('/candidate/applications?applied=1');
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------
// Apply modal: lets an unauthenticated visitor sign in or create a
// candidate account inline, then submits the application immediately —
// no full-page navigation. Reuses the same supabase.auth + RPC calls as
// the dedicated sign-in/sign-up pages, so no parallel auth path exists.
// ---------------------------------------------------------------------

type ApplyStep = 'role_select' | 'choice' | 'signin' | 'signup' | 'applying' | 'done' | 'wrong_role';
type ApplyRole = 'candidate' | 'vendor' | 'freelancer';

const ApplyModal: React.FC<{
  open: boolean;
  onClose: () => void;
  job: { id: string; title: string } | undefined;
  session: unknown;
  profile: { role?: string } | null;
  refreshProfile: () => Promise<void>;
  onApplied: () => void;
}> = ({ open, onClose, job, session, profile, refreshProfile, onApplied }) => {
  const [step, setStep] = useState<ApplyStep>('role_select');
  const [selectedRole, setSelectedRole] = useState<ApplyRole>('candidate');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset to the right starting step whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(false);
    if (session && profile?.role === 'candidate') {
      void submitApplication();
    } else if (session && profile?.role && profile.role !== 'candidate') {
      setStep('wrong_role');
    } else {
      setStep('role_select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitApplication = async () => {
    if (!job) return;
    setStep('applying');
    setError(null);
    try {
      await applyToRequirementRpc(job.id);
      setStep('done');
    } catch (e) {
      setError(mapSupabaseError(e));
      setStep('choice');
    }
  };

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) throw signInErr;
      await refreshProfile();
      await submitApplication();
    } catch (e) {
      setError(mapSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const cleanEmail = email.trim();
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/email-confirmed`,
          data: {
            full_name: fullName.trim(),
            signup_intent: selectedRole === 'vendor' ? 'vendor' : 'candidate',
          },
        },
      });

      if (
        signUpErr?.message?.toLowerCase().includes('already registered') ||
        (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      ) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInErr) {
          throw new Error(
            'An account with this email already exists. Try signing in instead.'
          );
        }
      } else if (signUpErr) {
        throw signUpErr;
      } else if (!data.session) {
        setError('Check your email inbox to confirm your account, then sign in to apply.');
        setLoading(false);
        return;
      }

      await refreshProfile();
      await submitApplication();
    } catch (e) {
      setError(mapSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  const title =
    step === 'done'
      ? 'Application submitted'
      : step === 'wrong_role'
        ? 'Candidate account required'
        : step === 'applying'
          ? 'Submitting your application…'
          : step === 'role_select'
            ? 'How would you like to proceed?'
            : `Apply${job ? ` for ${job.title}` : ''}`;

  return (
    <Dialog open={open} onClose={onClose} title={title} maxWidth="max-w-[420px]">
      {step === 'applying' && (
        <div className="flex items-center justify-center py-8">
          <div
            className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-4 space-y-3">
          <CheckCircle2 className="w-10 h-10 mx-auto" style={{ color: 'var(--status-success, #16A34A)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your application has been submitted. You can track its status from your dashboard.
          </p>
          <Button size="md" className="w-full" onClick={onApplied}>
            View my applications
          </Button>
        </div>
      )}

      {step === 'wrong_role' && (
        <div className="text-center py-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            You're signed in with a non-candidate account. Applications must be submitted from a
            candidate account. Sign out and create one to continue.
          </p>
          <Link to={`/signin?returnTo=${encodeURIComponent(window.location.pathname + '?apply=1')}`}>
            <Button size="md" className="w-full" onClick={onClose}>
              Switch account
            </Button>
          </Link>
        </div>
      )}

      {step === 'role_select' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Select how you&apos;d like to register for this opportunity.
          </p>
          {([
            { role: 'candidate' as ApplyRole, label: 'Direct Candidate', desc: 'Apply directly as an individual job seeker' },
            { role: 'freelancer' as ApplyRole, label: 'Freelancer', desc: 'Apply as a freelance / contract professional' },
            { role: 'vendor' as ApplyRole, label: 'Vendor / Staffing Agency', desc: 'Register as a vendor partner to submit candidates' },
          ]).map(({ role, label, desc }) => (
            <button
              key={role}
              type="button"
              className="w-full text-left rounded-lg border p-4 transition-colors"
              style={{
                borderColor: selectedRole === role ? 'var(--accent)' : 'var(--border)',
                background: selectedRole === role ? 'var(--accent-bg, var(--bg-subtle))' : 'var(--surface)',
              }}
              onClick={() => setSelectedRole(role)}
            >
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</div>
            </button>
          ))}
          <Button
            size="md"
            className="w-full"
            onClick={() => {
              if (selectedRole === 'vendor') {
                window.location.href = `/signup?intent=vendor&returnTo=${encodeURIComponent(window.location.pathname + '?apply=1')}`;
              } else {
                setStep('choice');
              }
            }}
          >
            Continue
          </Button>
          <Button size="md" variant="secondary" className="w-full" onClick={() => { setStep('signin'); }}>
            I already have an account
          </Button>
        </div>
      )}

      {(step === 'choice' || step === 'signin' || step === 'signup') && (
        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="text-xs rounded-md px-3 py-2"
              style={{
                background: 'var(--status-danger-bg, #FEF2F2)',
                color: 'var(--status-danger, #DC2626)',
              }}
            >
              {error}
            </div>
          )}

          {step === 'choice' && (
            <div className="space-y-2.5">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {selectedRole === 'freelancer'
                  ? 'Create a freelancer account or sign in to apply.'
                  : 'Create a candidate account or sign in to apply.'}
              </p>
              <Button size="md" className="w-full" onClick={() => setStep('signup')}>
                Create account &amp; apply
              </Button>
              <Button size="md" variant="secondary" className="w-full" onClick={() => setStep('signin')}>
                I already have an account
              </Button>
              <button
                type="button"
                className="text-xs underline w-full text-center mt-1"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={() => setStep('role_select')}
              >
                ← Change selection
              </button>
            </div>
          )}

          {step === 'signin' && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSignIn();
              }}
            >
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button size="md" type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in & apply'}
              </Button>
              <button
                type="button"
                className="w-full py-2 text-xs text-center"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={() => setStep('choice')}
              >
                Back
              </button>
            </form>
          )}

          {step === 'signup' && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSignUp();
              }}
            >
              <Input
                label="Full name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                hint="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              <Button size="md" type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account & apply'}
              </Button>
              <button
                type="button"
                className="w-full py-2 text-xs text-center"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={() => setStep('choice')}
              >
                Back
              </button>
            </form>
          )}
        </div>
      )}
    </Dialog>
  );
};

export default PublicJobPage;
