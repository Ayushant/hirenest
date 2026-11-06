import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Clock, MapPin, Search } from 'lucide-react';
import { listPublicJobs, type PublicJobSummary } from '../../api/publicJobs';
import { Card, Badge } from '../../components/ui/kit';

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
  if (min == null && max == null) return 'Any experience';
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

export const PublicJobsListPage: React.FC = () => {
  const [query, setQuery] = React.useState('');

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['public_jobs_list'],
    queryFn: () => listPublicJobs(100, 0),
  });

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        (j.location || '').toLowerCase().includes(q) ||
        (j.client_org_name || '').toLowerCase().includes(q)
    );
  }, [jobs, query]);

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
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-base font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            HireNest
          </Link>
          <Link
            to="/signin"
            className="text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Open roles
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            {jobs.length} open position{jobs.length === 1 ? '' : 's'} across our client network.
          </p>
        </header>

        {/* Search */}
        <div
          className="flex items-center gap-2 rounded-lg border px-4 py-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search by title, location, or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm sm:text-base"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>

        {/* Job list */}
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 rounded-lg animate-pulse"
                style={{ background: 'var(--bg-subtle)' }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="text-center py-16 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            No open roles match your search right now.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const JobRow: React.FC<{ job: PublicJobSummary }> = ({ job }) => (
  <Link to={`/jobs/${encodeURIComponent(job.slug)}`}>
    <Card className="p-5 sm:p-6 hover:shadow-sm transition-shadow cursor-pointer">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <h3 className="text-lg font-semibold truncate">{job.title}</h3>
          {job.client_org_name && (
            <div
              className="flex items-center gap-1.5 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              {job.client_org_name}
            </div>
          )}
          <div
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm pt-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
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
        </div>
        <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
          <Badge tone="indigo">Posted {formatPostedDate(job.posted_at)}</Badge>
        </div>
      </div>
    </Card>
  </Link>
);

export default PublicJobsListPage;
