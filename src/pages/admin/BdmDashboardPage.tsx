import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Download, History, GitPullRequest } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, Input, PageHeader, Pagination, StatCard, TableSkeleton } from '../../components/ui/kit';
import { fetchRequirements } from '../../api/requirements';
import { fetchSubmissions } from '../../api/submissions';
import { staffApi } from '../../api/staff';
import { formatRelativeTime, STAGE_LABELS } from '../../lib/format';
import type { SubmissionStage } from '../../types/db';
import { HqDashboardPage } from './HqDashboardAndGov';

/** BDM-focused home: clients, open demand per client and pipeline health. */
const CLIENTS_PAGE_SIZE = 5;
const ACTIVE_STAGES: SubmissionStage[] = [
  'applied',
  'recruiter_review',
  'client_review',
  'interviewing',
  'offered',
];

const BdmDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [clientFilter, setClientFilter] = useState('');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const reqQ = useQuery({
    queryKey: ['bdm_requirements'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 1000 }),
  });
  const subQ = useQuery({
    queryKey: ['bdm_submissions'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 500 }),
  });

  const open = useMemo(() => (reqQ.data?.data || []).filter((r) => r.status === 'open'), [reqQ.data]);
  const subs = useMemo(() => subQ.data?.data || [], [subQ.data]);
  const clientReviewByOrg = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subs) {
      if (s.stage !== 'client_review') continue;
      const orgId = s.requirements?.client_org_id;
      if (!orgId) continue;
      m.set(orgId, (m.get(orgId) || 0) + 1);
    }
    return m;
  }, [subs]);
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
  const needsReviewCount = useMemo(
    () => byClient.filter(([id]) => (clientReviewByOrg.get(id) || 0) > 0).length,
    [byClient, clientReviewByOrg]
  );
  const filteredClients = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    return byClient.filter(([id, c]) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (onlyNeedsReview && (clientReviewByOrg.get(id) || 0) === 0) return false;
      return true;
    });
  }, [byClient, clientFilter, onlyNeedsReview, clientReviewByOrg]);
  const pagedClients = filteredClients.slice(
    (clientPage - 1) * CLIENTS_PAGE_SIZE,
    clientPage * CLIENTS_PAGE_SIZE
  );

  const recentActivity = useMemo(() => {
    type Event = { id: string; at: string; node: React.ReactNode };
    const subEvents: Event[] = subs.slice(0, 20).map((s) => ({
      id: `sub-${s.id}`,
      at: s.created_at,
      node: (
        <>
          <span className="font-medium text-[var(--text-primary)]">{s.candidates?.full_name || 'A candidate'}</span>
          {' was submitted for '}
          <span className="font-medium text-[var(--text-primary)]">{s.requirements?.title || 'a requirement'}</span>
          {s.requirements?.organizations?.name ? ` at ${s.requirements.organizations.name}` : ''}
          {' · currently '}
          <span className="font-medium">{STAGE_LABELS[s.stage]}</span>
        </>
      ),
    }));
    const reqEvents: Event[] = open.slice(0, 20).map((r) => ({
      id: `req-${r.id}`,
      at: r.created_at,
      node: (
        <>
          <span className="font-medium text-[var(--text-primary)]">{r.organizations?.name || 'A client'}</span>
          {' opened '}
          <span className="font-medium text-[var(--text-primary)]">{r.title}</span>
          {` · ${r.openings} opening${r.openings === 1 ? '' : 's'}`}
        </>
      ),
    }));
    return [...subEvents, ...reqEvents]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);
  }, [subs, open]);

  const stageBreakdown = useMemo(() => {
    const activeSubs = subs.filter((s) => ACTIVE_STAGES.includes(s.stage));
    const total = activeSubs.length;
    return ACTIVE_STAGES.map((stage) => {
      const count = activeSubs.filter((s) => s.stage === stage).length;
      return { stage, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
    }).filter((row) => row.count > 0);
  }, [subs]);

  const handleExportCsv = () => {
    const rows = [
      ['Client', 'Open requirements', 'Total openings'],
      ...filteredClients.map(([, c]) => [c.name, String(c.reqs), String(c.openings)]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-overview-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inClientReview = subs.filter((s) => s.stage === 'client_review').length;
  const totalOpenings = useMemo(() => open.reduce((sum, r) => sum + (r.openings || 0), 0), [open]);
  const avgSlaHours = useMemo(() => {
    if (open.length === 0) return 0;
    return Math.round(open.reduce((sum, r) => sum + (r.submission_sla_hours || 0), 0) / open.length);
  }, [open]);

  return (
    <div className="space-y-6">
      <PageHeader title="Business Development" description="Your clients, open demand and pipeline at a glance." />
      {reqQ.isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <>
          <div className="grid sm:grid-cols-3 rounded-[12px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
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
              sublabel={avgSlaHours > 0 ? `Avg ${avgSlaHours}h submission SLA` : 'Submissions awaiting client decision'}
            />
          </div>
          {byClient.length === 0 ? (
            <EmptyState title="No open demand" description="Open requirements will appear here grouped by client." />
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="section-title-bar type-section-title">Clients overview</h2>
                  <div className="flex items-center p-0.5 bg-[var(--bg-subtle)] rounded-[8px] text-[12px] font-medium text-[var(--text-secondary)] border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => {
                        setOnlyNeedsReview(false);
                        setClientPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-[6px] transition-colors ${
                        !onlyNeedsReview ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-xs font-semibold' : 'hover:text-[var(--text-primary)]'
                      }`}
                    >
                      All ({byClient.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOnlyNeedsReview(true);
                        setClientPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-[6px] flex items-center gap-1.5 transition-colors ${
                        onlyNeedsReview ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-xs font-semibold' : 'hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span>Needs review</span>
                      {needsReviewCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warning-dot)]" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Filter clients..."
                    value={clientFilter}
                    onChange={(e) => {
                      setClientFilter(e.target.value);
                      setClientPage(1);
                    }}
                    className="w-48"
                  />
                  <Button size="sm" variant="outline" onClick={handleExportCsv}>
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden bg-[var(--surface)]">
                {pagedClients.length === 0 ? (
                  <EmptyState title="No matching clients" description="Try a different filter term." />
                ) : pagedClients.map(([id, c]) => {
                  const pendingReview = clientReviewByOrg.get(id) || 0;
                  return (
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
                        {pendingReview > 0 && (
                          <Badge tone="amber">{pendingReview} awaiting review</Badge>
                        )}
                        <Badge tone="emerald">{c.reqs} open</Badge>
                        <span className="text-[var(--text-tertiary)] font-mono tabular-nums">{c.openings} opening(s)</span>
                        <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <Pagination
                page={clientPage}
                pageSize={CLIENTS_PAGE_SIZE}
                totalCount={filteredClients.length}
                onPageChange={setClientPage}
              />
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-[var(--text-tertiary)]" />
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Recent activity</h3>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/recruiter/submissions')}
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  View submissions →
                </button>
              </div>
              {recentActivity.length === 0 ? (
                <p className="text-[13px] text-[var(--text-tertiary)] py-4">No activity yet.</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {recentActivity.map((ev) => (
                    <div key={ev.id} className="py-2.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                      {ev.node}
                      <div className="text-[11px] text-[var(--text-tertiary)] font-mono mt-0.5">
                        {formatRelativeTime(ev.at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 text-[var(--text-tertiary)]" />
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Pipeline stage mix</h3>
              </div>
              {stageBreakdown.length === 0 ? (
                <p className="text-[13px] text-[var(--text-tertiary)] py-2">No active submissions.</p>
              ) : (
                <div className="space-y-2.5">
                  {stageBreakdown.map((row) => (
                    <div key={row.stage}>
                      <div className="flex justify-between text-[12px] mb-1">
                        <span className="text-[var(--text-secondary)] font-medium">{STAGE_LABELS[row.stage]}</span>
                        <span className="font-mono text-[var(--text-primary)] font-semibold">{row.count}</span>
                      </div>
                      <div className="w-full h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${row.pct}%`, background: 'var(--primary-bg)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
