import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Clock, MapPin, Search, AlertCircle } from 'lucide-react';
import { listPublicJobs, type PublicJobSummary } from '../../api/publicJobs';
import { Card, Badge } from '../../components/ui/kit';

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'FTE',
  contract: 'C2C',
  contract_to_hire: 'C2H',
  part_time: 'Part-time',
};

const EMPLOYMENT_FULL_LABEL: Record<string, string> = {
  full_time: 'Full-time (FTE)',
  contract: 'Contract to Contract (C2C)',
  contract_to_hire: 'Contract to Hire (C2H)',
  part_time: 'Part-time',
};

const WORK_MODE_LABEL: Record<string, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

type EmploymentFilter = 'all' | 'full_time' | 'contract' | 'contract_to_hire';

const FILTER_OPTIONS: { value: EmploymentFilter; label: string }[] = [
  { value: 'all', label: 'All Jobs' },
  { value: 'contract', label: 'C2C' },
  { value: 'contract_to_hire', label: 'C2H' },
  { value: 'full_time', label: 'FTE' },
];

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
  const [typeFilter, setTypeFilter] = React.useState<EmploymentFilter>('all');

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['public_jobs_list'],
    queryFn: () => listPublicJobs(100, 0),
  });

  const filtered = React.useMemo(() => {
    let result = jobs;

    if (typeFilter !== 'all') {
      result = result.filter((j) => j.employment_type === typeFilter);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          (j.location || '').toLowerCase().includes(q) ||
          (j.client_org_name || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [jobs, query, typeFilter]);

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
        <header className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
            Active Requirements Live on HireNest OS Platform. Apply Now!
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            {jobs.length} active requirement{jobs.length === 1 ? '' : 's'} across our network.
          </p>
        </header>

        {/* Important Notes */}
        <div
          className="rounded-lg border p-4 sm:p-5 space-y-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Please Note
            </span>
          </div>
          <ol className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <li className="flex gap-2">
              <span className="font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>1.</span>
              <span>
                For jobs related to <strong style={{ color: 'var(--text-primary)' }}>Contract to Contract (C2C)</strong> &amp; <strong style={{ color: 'var(--text-primary)' }}>Contract to Hire (C2H)</strong>, only bench vendor resources must apply. No direct candidates or market profiles are allowed.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>2.</span>
              <span>
                For <strong style={{ color: 'var(--text-primary)' }}>FTE (Full-time)</strong> jobs, direct candidates and market profiles are allowed to submit.
              </span>
            </li>
          </ol>
        </div>

        {/* Search + Filters */}
        <div className="space-y-3">
          <div
            className="flex items-center gap-2 rounded-lg border px-4 py-3"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
            <label htmlFor="job-search" className="sr-only">
              Search jobs by title, location, or company
            </label>
            <input
              id="job-search"
              type="text"
              placeholder="Search by title, location, or company..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm sm:text-base"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {/* Employment Type Filters */}
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((opt) => {
              const isActive = typeFilter === opt.value;
              const count =
                opt.value === 'all'
                  ? jobs.length
                  : jobs.filter((j) => j.employment_type === opt.value).length;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setTypeFilter(opt.value)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer"
                  style={{
                    background: isActive ? 'var(--accent)' : 'var(--surface)',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {opt.label} ({count})
                </button>
              );
            })}
          </div>
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
            No active requirements match your search right now.
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

const JobRow: React.FC<{ job: PublicJobSummary }> = ({ job }) => {
  const empType = job.employment_type || 'full_time';
  const badgeTone =
    empType === 'contract' ? 'amber' : empType === 'contract_to_hire' ? 'teal' : 'emerald';

  return (
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
                <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                {job.client_org_name}
              </div>
            )}
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm pt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {job.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                  {job.location}
                  {job.work_mode ? ` · ${WORK_MODE_LABEL[job.work_mode]}` : ''}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                {formatExperience(job.min_experience, job.max_experience)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                {EMPLOYMENT_FULL_LABEL[empType] || 'Full-time (FTE)'}
              </span>
            </div>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
            <Badge tone={badgeTone as 'amber' | 'teal' | 'emerald'}>
              {EMPLOYMENT_LABEL[empType] || 'FTE'}
            </Badge>
            <Badge tone="indigo">Posted {formatPostedDate(job.posted_at)}</Badge>
          </div>
        </div>
      </Card>
    </Link>
  );
};

export default PublicJobsListPage;
