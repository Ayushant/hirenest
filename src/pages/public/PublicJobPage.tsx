import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  Calendar,
  Clock,
  MapPin,
  Share2,
  MessageCircle,
  Users,
} from 'lucide-react';
import { fetchPublicJob } from '../../api/publicJobs';
import { useAuth } from '../../auth/AuthProvider';
import { applyToRequirementRpc } from '../../api/submissions';
import { Button, Card, Badge } from '../../components/ui/kit';

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

  useEffect(() => {
    if (!job) return;
    document.title = `${job.title} — ${job.client_org_name || 'HireNest'}`;
    const metaDescription = document.querySelector('meta[name="description"]');
    const desc = (job.description || '').slice(0, 160);
    if (metaDescription) metaDescription.setAttribute('content', desc);
  }, [job]);

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
    const text = `${job.title} at ${job.client_org_name || 'HireNest'} — ${window.location.href}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [job]);

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--app-bg)', color: 'var(--text-secondary)' }}
      >
        <div className="animate-pulse text-sm">Loading job…</div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
      >
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Job not found</h1>
          <p
            className="text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            This opening may have been closed or the link is incorrect.
          </p>
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

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Top nav */}
      <nav
        className="border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            to="/"
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            HireNest
          </Link>
          <Link
            to="/signin"
            className="text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* Header */}
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <Badge tone="indigo">{job.openings} opening{job.openings > 1 ? 's' : ''}</Badge>
            <span>·</span>
            <span>Posted {formatPostedDate(job.posted_at)}</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight">{job.title}</h1>

          {job.client_org_name && (
            <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Building2 className="w-4 h-4" />
              {job.client_org_name}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs pt-1" style={{ color: 'var(--text-secondary)' }}>
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {job.location}
                {job.work_mode ? ` · ${WORK_MODE_LABEL[job.work_mode]}` : ''}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatExperience(job.min_experience, job.max_experience)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Briefcase className="w-3.5 h-3.5" />
              {EMPLOYMENT_LABEL[job.employment_type || ''] || 'Full-time'}
            </span>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap gap-2 pt-4">
            <a href={applyHref}>
              <Button size="sm">Apply Now</Button>
            </a>
            <Button size="sm" variant="secondary" onClick={handleShare}>
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Share
            </Button>
            <a href={whatsAppHref} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary">
                <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                WhatsApp
              </Button>
            </a>
          </div>

          <p className="text-[11px] pt-1" style={{ color: 'var(--text-tertiary)' }}>
            {session
              ? 'You are signed in — Apply Now will submit your application.'
              : 'Sign up or sign in to complete your application.'}
          </p>
        </header>

        {/* Overview grid */}
        <section>
          <h2
            className="text-[11px] font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Overview
          </h2>
          <Card className="divide-y md:divide-y-0 md:grid md:grid-cols-4">
            <OverviewCell icon={<MapPin className="w-3.5 h-3.5" />} label="Location" value={job.location || '—'} />
            <OverviewCell icon={<Building2 className="w-3.5 h-3.5" />} label="Work mode" value={job.work_mode ? WORK_MODE_LABEL[job.work_mode] : '—'} />
            <OverviewCell icon={<Clock className="w-3.5 h-3.5" />} label="Experience" value={formatExperience(job.min_experience, job.max_experience)} />
            <OverviewCell icon={<Briefcase className="w-3.5 h-3.5" />} label="Job type" value={EMPLOYMENT_LABEL[job.employment_type || ''] || 'Full-time'} />
            <OverviewCell icon={<Users className="w-3.5 h-3.5" />} label="Openings" value={`${job.openings}`} />
            <OverviewCell icon={<Calendar className="w-3.5 h-3.5" />} label="Posted" value={formatPostedDate(job.posted_at)} />
            <OverviewCell icon={<Briefcase className="w-3.5 h-3.5" />} label="Notice" value="Negotiable" />
            <OverviewCell icon={<Building2 className="w-3.5 h-3.5" />} label="Compensation" value="On request" />
          </Card>
        </section>

        {/* About */}
        <section className="space-y-3">
          <h2
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            About the role
          </h2>
          <Card className="p-5">
            <p
              className="whitespace-pre-wrap text-sm leading-relaxed"
              style={{ color: 'var(--text-primary)' }}
            >
              {job.description}
            </p>
          </Card>
        </section>

        {/* Skills */}
        {job.skills.length > 0 && (
          <section className="space-y-3">
            <h2
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Required skills
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {job.skills.map((s) => (
                <span
                  key={s}
                  className="rounded px-2 py-0.5 text-xs"
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Footer CTA */}
        <section
          className="rounded border p-5 flex items-center justify-between gap-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div>
            <div className="text-sm font-medium">Interested in this role?</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Create a free candidate account to apply in minutes.
            </div>
          </div>
          <a href={applyHref}>
            <Button size="sm">Apply Now</Button>
          </a>
        </section>

        <footer
          className="pt-4 text-center text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Powered by{' '}
          <Link to="/" className="underline">HireNest</Link>
        </footer>
      </main>
    </div>
  );
};

const OverviewCell: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div
    className="p-4 md:border-r md:last:border-r-0"
    style={{ borderColor: 'var(--border)' }}
  >
    <div
      className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {icon}
      {label}
    </div>
    <div className="mt-1 text-sm font-medium">{value}</div>
  </div>
);

export default PublicJobPage;
