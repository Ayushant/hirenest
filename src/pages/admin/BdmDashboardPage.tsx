import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, EmptyState, PageHeader, StatCard, TableSkeleton } from '../../components/ui/kit';
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

  return (
    <div className="space-y-6">
      <PageHeader title="Business Development" description="Your clients, open demand and pipeline at a glance." />
      {reqQ.isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Active clients" value={byClient.length} />
            <StatCard label="Open requirements" value={open.length} />
            <StatCard label="With client for review" value={inClientReview} />
          </div>
          {byClient.length === 0 ? (
            <EmptyState title="No open demand" description="Open requirements will appear here grouped by client." />
          ) : (
            <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
              {byClient.map(([id, c]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(`/recruiter/requirements?client=${id}`)}
                  className="w-full py-3 flex items-center justify-between text-left text-[13px] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <span className="font-medium text-[var(--text-primary)]">{c.name}</span>
                  <span className="flex items-center gap-3">
                    <Badge tone="emerald">{c.reqs} open</Badge>
                    <span className="text-[var(--text-tertiary)]">{c.openings} opening(s)</span>
                  </span>
                </button>
              ))}
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
