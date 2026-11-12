import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, TableSkeleton } from '../../components/ui/kit';
import { fetchRequirements } from '../../api/requirements';
import { fetchSubmissions } from '../../api/submissions';
import { staffApi } from '../../api/staff';
import { HqDashboardPage } from './HqDashboardAndGov';

/** BDM-focused home: clients, open demand per client and pipeline health. */
const BdmDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const reqQ = useQuery({
    queryKey: ['bdm_requirements'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 1000 }),
  });
  const subQ = useQuery({
    queryKey: ['bdm_submissions'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 500 }),
  });

  const open = useMemo(() => (reqQ.data?.data || []).filter((r) => r.status === 'open'), [reqQ.data]);
  const byClient = useMemo(() => {
    const m = new Map<string, { name: string; reqs: number; openings: number }>();
    for (const r of open) {
      const key = r.client_org_id;
      const cur = m.get(key) || { name: r.organizations?.name || 'Client', reqs: 0, openings: 0 };
      cur.reqs += 1;
      cur.openings += r.openings || 0;
      m.set(key, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].reqs - a[1].reqs);
  }, [open]);
  const subs = subQ.data?.data || [];
  const inClientReview = subs.filter((s) => s.stage === 'client_review').length;
  const totalOpenings = useMemo(() => open.reduce((sum, r) => sum + (r.openings || 0), 0), [open]);

  return (
    <div className="space-y-6">
      <PageHeader title="Business Development" description="Your clients, open demand and pipeline at a glance." />
      {reqQ.isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <>
          <div className="grid sm:grid-cols-3 rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
            <StatCard label="Active clients" value={byClient.length} />
            <StatCard
              label="Open requirements"
              value={open.length}
              sublabel={`${totalOpenings} total opening(s) across roles`}
            />
            <StatCard
              label="With client for review"
              value={inClientReview}
              tone="amber"
              sublabel="Submissions awaiting client decision"
            />
          </div>
          {byClient.length === 0 ? (
            <EmptyState title="No open demand" description="Open requirements will appear here grouped by client." />
          ) : (
            <div>
              <h2 className="section-title-bar type-section-title mb-3">Clients overview</h2>
              <div className="rounded-[10px] border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden bg-[var(--surface)]">
                {byClient.map(([id, c]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(`/recruiter/requirements?client=${id}`)}
                    className="w-full py-3 px-4 flex items-center justify-between gap-4 text-left text-[13px] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Avatar name={c.name} />
                      <span className="font-medium text-[var(--text-primary)] truncate">{c.name}</span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <Badge tone="emerald">{c.reqs} open</Badge>
                      <span className="text-[var(--text-tertiary)] font-mono tabular-nums">{c.openings} opening(s)</span>
                      <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** Picks the dashboard by staff role: BDMs get the BD view, everyone else the HQ dashboard. */
export const RecruiterHome: React.FC = () => {
  const meQ = useQuery({ queryKey: ['my_access'], queryFn: staffApi.me, retry: false });
  if (meQ.data?.role === 'bdm') return <BdmDashboardPage />;
  return <HqDashboardPage />;
};
