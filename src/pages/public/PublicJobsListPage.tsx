import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Clock, MapPin, Search, AlertCircle } from 'lucide-react';
import { listPublicJobs, type PublicJobSummary } from '../../api/publicJobs';
import { PublicNav, PUBLIC_FONT } from './PublicNav';

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
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: PUBLIC_FONT }}>
      <PublicNav />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#1B1A33] to-[#0F111E] text-white">
        <div className="mx-auto max-w-5xl space-y-6 px-5 pb-10 pt-10 sm:px-8 sm:pb-12 sm:pt-14">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {jobs.length} active requirement{jobs.length === 1 ? '' : 's'}
            </span>
            <h1 className="!text-white text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Active requirements live on the HireNest OS platform
            </h1>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Browse open roles across our network and apply in minutes.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-lg shadow-black/20">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <label htmlFor="job-search" className="sr-only">
                Search jobs by title, location, or company
              </label>
              <input
                id="job-search"
                type="text"
                placeholder="Search by title, location, or company..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 sm:text-base"
              />
            </div>
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
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'border-transparent bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm'
                        : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {opt.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        {/* Important Notes */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <AlertCircle className="h-[18px] w-[18px]" />
            </span>
            <span className="text-sm font-bold text-slate-900">Please note</span>
          </div>
          <ol className="mt-3 space-y-2 text-sm text-slate-600">
            <li className="flex gap-2">
              <span className="shrink-0 font-bold text-slate-900">1.</span>
              <span>
                For <strong className="text-slate-900">Contract to Contract (C2C)</strong> &amp; <strong className="text-slate-900">Contract to Hire (C2H)</strong> jobs, only bench vendor resources must apply. No direct candidates or market profiles are allowed.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-bold text-slate-900">2.</span>
              <span>
                For <strong className="text-slate-900">FTE (Full-time)</strong> jobs, direct candidates and market profiles are allowed to submit.
              </span>
            </li>
          </ol>
        </div>

        {/* Job list */}
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200/70" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
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

const EMP_PILL: Record<string, string> = {
  contract: 'border-amber-200 bg-amber-50 text-amber-700',
  contract_to_hire: 'border-teal-200 bg-teal-50 text-teal-700',
  full_time: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  part_time: 'border-slate-200 bg-slate-50 text-slate-600',
};

const JobRow: React.FC<{ job: PublicJobSummary }> = ({ job }) => {
  const empType = job.employment_type || 'full_time';
  const initial = (job.client_org_name || job.title).trim().charAt(0).toUpperCase();

  return (
    <Link
      to={`/jobs/${encodeURIComponent(job.slug)}`}
      className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md sm:p-6"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-base font-extrabold text-indigo-600">
            {initial}
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3 className="truncate text-lg font-bold text-slate-900 group-hover:text-indigo-700">{job.title}</h3>
            {job.client_org_name && (
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {job.client_org_name}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-xs text-slate-500 sm:text-[13px]">
              {job.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {job.location}
                  {job.work_mode ? ` · ${WORK_MODE_LABEL[job.work_mode]}` : ''}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {formatExperience(job.min_experience, job.max_experience)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                {EMPLOYMENT_FULL_LABEL[empType] || 'Full-time (FTE)'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span className={`rounded-md border px-2.5 py-0.5 text-xs font-bold ${EMP_PILL[empType] || EMP_PILL.full_time}`}>
            {EMPLOYMENT_LABEL[empType] || 'FTE'}
          </span>
          <span className="font-mono text-[11px] text-slate-400">Posted {formatPostedDate(job.posted_at)}</span>
        </div>
      </div>
    </Link>
  );
};

export default PublicJobsListPage;
