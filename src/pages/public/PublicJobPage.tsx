import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  Calendar,
  Clock,
  IndianRupee,
  MapPin,
  Share2,
  Mail,
  MessageCircle,
  Users,
  Zap,
} from 'lucide-react';
import { fetchPublicJob } from '../../api/publicJobs';
import { useAuth } from '../../auth/AuthProvider';
import { applyToRequirementRpc } from '../../api/submissions';

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
  if (min != null && max != null) return `${min}–${max} Yrs`;
  if (min != null) return `${min}+ Yrs`;
  return `Up to ${max} Yrs`;
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
  const { session, profile } = useAuth();

  const {
    data: job,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['public_job', slug],
    queryFn: () => fetchPublicJob(slug!),
    enabled: Boolean(slug),
    retry: 1,
  });

  // Set document title + meta description for client-side SPA (crawlers get
  // server-injected tags via server.ts; this is for in-app navigation).
  useEffect(() => {
    if (!job) return;
    document.title = `${job.title} — ${job.client_org_name || 'HireNest'}`;
    const metaDescription = document.querySelector('meta[name="description"]');
    const desc = (job.description || '').slice(0, 160);
    if (metaDescription) metaDescription.setAttribute('content', desc);
  }, [job]);

  // If the URL carries ?apply=1 and the visitor is signed in as a candidate,
  // submit the application automatically and redirect to their dashboard.
  useEffect(() => {
    if (!job || !session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('apply') !== '1') return;
    if (profile?.role !== 'candidate') return;
    (async () => {
      try {
        await applyToRequirementRpc(job.id);
        navigate('/candidate/applications?applied=1', { replace: true });
      } catch (e) {
        console.error('Auto-apply failed', e);
      }
    })();
  }, [job, session, profile, navigate]);

  const applyHref = useMemo(() => {
    if (!slug) return '/signup';
    const returnTo = `/jobs/${encodeURIComponent(slug)}?apply=1`;
    return session
      ? `${window.location.pathname}?apply=1`
      : `/signup?returnTo=${encodeURIComponent(returnTo)}&role=candidate`;
  }, [slug, session]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: job?.title, text: job?.title, url });
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied to clipboard');
    } catch {
      /* ignore */
    }
  };

  const whatsAppHref = useMemo(() => {
    if (!job) return '#';
    const text = `${job.title} at ${job.client_org_name || 'HireNest'} — ${window.location.href}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [job]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading job…</div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Job not found</h1>
          <p className="text-slate-400">
            This opening may have been closed or the link is incorrect.
          </p>
          <Link
            to="/jobs"
            className="inline-block mt-2 px-4 py-2 rounded-md border border-slate-700 hover:border-slate-500"
          >
            Browse open jobs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Gradient header */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 20% 20%, rgba(16,185,129,0.25), transparent 50%), radial-gradient(circle at 80% 10%, rgba(59,130,246,0.25), transparent 55%), #050a16',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6 pt-10 pb-14">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/70 px-3 py-1 text-xs text-slate-300 ring-1 ring-slate-700">
            {job.openings} opening{job.openings > 1 ? 's' : ''}
          </div>

          <h1 className="mt-5 text-4xl sm:text-5xl font-semibold tracking-tight">
            {job.title}
          </h1>

          <div className="mt-3 flex items-center gap-2 text-amber-300/90">
            <Building2 className="w-4 h-4" />
            <span className="text-base">
              {job.client_org_name || 'Confidential client'}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            {job.location && (
              <Chip icon={<MapPin className="w-3.5 h-3.5" />}>
                {job.location}
                {job.work_mode ? ` · ${WORK_MODE_LABEL[job.work_mode]}` : ''}
              </Chip>
            )}
            <Chip icon={<Clock className="w-3.5 h-3.5" />}>
              {formatExperience(job.min_experience, job.max_experience)}
            </Chip>
            <Chip icon={<Briefcase className="w-3.5 h-3.5" />}>
              {EMPLOYMENT_LABEL[job.employment_type || ''] || 'Full-time'}
            </Chip>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={applyHref}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium
                         bg-gradient-to-r from-emerald-400 to-sky-400 text-slate-950
                         hover:brightness-110 transition"
            >
              <Mail className="w-4 h-4" /> Apply Now
            </a>
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm
                         bg-slate-800/70 ring-1 ring-slate-700 hover:bg-slate-800 transition"
            >
              <Share2 className="w-4 h-4" /> Share
            </button>
            <a
              href={whatsAppHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm
                         bg-slate-800/70 ring-1 ring-slate-700 hover:bg-slate-800 transition"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            {session
              ? 'You are signed in — clicking Apply Now will submit your application.'
              : 'You will be asked to sign up or sign in to complete your application.'}
          </p>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        {/* Job overview grid */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Job overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <OverviewCard
              icon={<MapPin className="w-4 h-4 text-emerald-400" />}
              label="LOCATION"
              value={job.location || '—'}
            />
            <OverviewCard
              icon={<Building2 className="w-4 h-4 text-emerald-400" />}
              label="WORK MODE"
              value={job.work_mode ? WORK_MODE_LABEL[job.work_mode] : '—'}
            />
            <OverviewCard
              icon={<Clock className="w-4 h-4 text-emerald-400" />}
              label="EXPERIENCE"
              value={formatExperience(job.min_experience, job.max_experience)}
            />
            <OverviewCard
              icon={<IndianRupee className="w-4 h-4 text-emerald-400" />}
              label="CTC"
              value="On request"
            />
            <OverviewCard
              icon={<Zap className="w-4 h-4 text-emerald-400" />}
              label="NOTICE PERIOD"
              value="Immediate / 30 days"
            />
            <OverviewCard
              icon={<Users className="w-4 h-4 text-emerald-400" />}
              label="OPENINGS"
              value={`${job.openings} opening${job.openings > 1 ? 's' : ''}`}
            />
            <OverviewCard
              icon={<Briefcase className="w-4 h-4 text-emerald-400" />}
              label="JOB TYPE"
              value={EMPLOYMENT_LABEL[job.employment_type || ''] || 'Full-time'}
            />
            <OverviewCard
              icon={<Calendar className="w-4 h-4 text-emerald-400" />}
              label="POSTED"
              value={formatPostedDate(job.posted_at)}
            />
          </div>
        </section>

        {/* About the role */}
        <section>
          <h2 className="text-xl font-semibold mb-3">About the role</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
            <p className="whitespace-pre-wrap text-slate-300 leading-relaxed">
              {job.description}
            </p>
          </div>
        </section>

        {/* Required skills */}
        {job.skills.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Required skills</h2>
            <div className="flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Footer CTA */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center">
          <h3 className="text-lg font-medium mb-2">Ready to apply?</h3>
          <p className="text-sm text-slate-400 mb-4">
            Create a free candidate account or sign in to submit your application
            in minutes.
          </p>
          <a
            href={applyHref}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium
                       bg-gradient-to-r from-emerald-400 to-sky-400 text-slate-950
                       hover:brightness-110 transition"
          >
            <Mail className="w-4 h-4" /> Apply Now
          </a>
        </section>

        <footer className="pt-6 text-center text-xs text-slate-500">
          Powered by{' '}
          <Link to="/" className="underline hover:text-slate-300">
            HireNest
          </Link>
        </footer>
      </main>
    </div>
  );
};

const Chip: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({
  icon,
  children,
}) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/70 px-3 py-1 ring-1 ring-slate-700 text-slate-200">
    {icon}
    {children}
  </span>
);

const OverviewCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
    <div className="flex items-center justify-start">{icon}</div>
    <div className="mt-3 text-[11px] tracking-wider text-slate-400">{label}</div>
    <div className="mt-1 text-base font-medium text-slate-100">{value}</div>
  </div>
);

export default PublicJobPage;
