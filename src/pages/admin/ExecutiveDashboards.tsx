import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Users,
  Building2,
  Briefcase,
  Target,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowUpRight,
  FileText,
  CreditCard,
  Wallet,
  PiggyBank,
  Receipt,
  BarChart3,
} from 'lucide-react';
import {
  KpiCard,
  KpiRow,
  ChartCard,
  DonutChart,
  ChartLegend,
  FunnelChart,
  DashboardSection,
  ActionItem,
  GreetingHeader,
  SinceLastVisit,
  type DeltaItem,
} from '../../components/ui/DashboardKit';
import { EmptyState } from '../../components/ui/kit';
import { fetchAdminDashboardSummary } from '../../api/admin';
import { fetchRequirements } from '../../api/requirements';
import { fetchSubmissions } from '../../api/submissions';
import { fetchCandidates } from '../../api/candidates';
import { useAuth } from '../../auth/AuthProvider';

// ─── CEO Executive Command Centre ──────────────────────────────────────────

export const CeoDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const { data: summary } = useQuery({
    queryKey: ['admin_dashboard_summary'],
    queryFn: fetchAdminDashboardSummary,
    staleTime: 30_000,
  });

  const { data: reqData } = useQuery({
    queryKey: ['ceo_requirements'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });

  const { data: subData } = useQuery({
    queryKey: ['ceo_submissions'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });

  const { data: candData } = useQuery({
    queryKey: ['ceo_candidates'],
    queryFn: () => fetchCandidates({ page: 1, pageSize: 1 }),
    staleTime: 60_000,
  });

  const reqs = reqData?.data || [];
  const subs = subData?.data || [];
  const totalCandidates = candData?.count || 0;

  const activeReqs = reqs.filter((r) => r.status === 'open').length;
  const filledReqs = reqs.filter((r) => r.status === 'filled').length;
  const totalSubmissions = subs.length;
  const clientReviewSubs = subs.filter((s) => s.stage === 'client_review').length;
  const interviewingSubs = subs.filter((s) => s.stage === 'interviewing').length;
  const placedSubs = subs.filter((s) => s.stage === 'offered' || s.stage === 'offer_accepted' || s.stage === 'onboarded').length;
  const clients = summary?.clients || 0;
  const vendors = summary?.vendors || 0;

  const fulfillmentRate = reqs.length > 0 ? Math.round((filledReqs / reqs.length) * 100) : 0;
  const conversionRate = totalSubmissions > 0 ? Math.round((placedSubs / totalSubmissions) * 100) : 0;

  // Pipeline funnel
  const funnelStages = [
    { name: 'Requirements', value: reqs.length, color: 'var(--chart-1, #6366F1)' },
    { name: 'Submissions', value: totalSubmissions, color: 'var(--chart-2, #8B5CF6)' },
    { name: 'Client review', value: clientReviewSubs, color: 'var(--chart-3, #A78BFA)' },
    { name: 'Interviewing', value: interviewingSubs, color: 'var(--chart-4, #C4B5FD)' },
    { name: 'Placed', value: placedSubs, color: 'var(--chart-5, #16A34A)' },
  ];

  // Requirements by status for donut
  const reqsByStatus = summary?.requirements_by_status || {};
  const donutColors = ['var(--chart-1, #6366F1)', 'var(--chart-2, #8B5CF6)', 'var(--chart-3, #F59E0B)', 'var(--chart-4, #EF4444)', 'var(--chart-5, #16A34A)'];
  const reqDonutData = Object.entries(reqsByStatus).map(([status, count], i) => ({
    name: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: count as number,
  }));
  const reqLegendItems = Object.entries(reqsByStatus).map(([status, count], i) => ({
    name: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    color: donutColors[i % donutColors.length],
    value: count as number,
  }));

  // Since last visit items
  const sinceItems: DeltaItem[] = [
    { label: 'New requirements', count: reqs.filter((r) => { const d = new Date(r.created_at); return Date.now() - d.getTime() < 7 * 86400_000; }).length, icon: <Briefcase className="w-3.5 h-3.5" /> },
    { label: 'New submissions', count: subs.filter((s) => { const d = new Date(s.created_at); return Date.now() - d.getTime() < 7 * 86400_000; }).length, icon: <Users className="w-3.5 h-3.5" /> },
    { label: 'Placements', count: placedSubs, icon: <CheckCircle className="w-3.5 h-3.5" /> },
  ];

  // Strategic insights
  const reqsWithoutSubs = reqs.filter((r) => r.status === 'open' && !subs.some((s) => s.requirement_id === r.id));
  const insightItems: Array<{ label: string; badge?: string; badgeColor?: string }> = [];

  if (reqsWithoutSubs.length > 0) {
    insightItems.push({ label: `${reqsWithoutSubs.length} open requirement(s) have zero candidate submissions`, badge: 'High', badgeColor: 'var(--warning)' });
  }
  if (fulfillmentRate < 20 && reqs.length > 5) {
    insightItems.push({ label: `Low fulfillment rate: ${fulfillmentRate}% — review sourcing strategy`, badge: 'Critical', badgeColor: 'var(--error)' });
  }
  if (conversionRate < 5 && totalSubmissions > 10) {
    insightItems.push({ label: `Low placement conversion: ${conversionRate}% — review screening quality`, badge: 'High', badgeColor: 'var(--warning)' });
  }
  if (insightItems.length === 0) {
    insightItems.push({ label: 'Operations are running smoothly — no critical risks detected' });
  }

  return (
    <div className="space-y-6">
      <GreetingHeader firstName={profile?.full_name?.split(' ')[0]} subtitle="Executive Command Centre" />
      <SinceLastVisit items={sinceItems} />

      {/* KPI Cards */}
      <KpiRow>
        <KpiCard label="Active clients" value={clients} icon={<Building2 className="w-4 h-4" />} onClick={() => navigate('/admin/organizations')} />
        <KpiCard label="Active vendors" value={vendors} icon={<Users className="w-4 h-4" />} onClick={() => navigate('/admin/vendor-performance')} />
        <KpiCard label="Open requirements" value={activeReqs} icon={<Briefcase className="w-4 h-4" />} onClick={() => navigate('/admin/requirements')} />
        <KpiCard label="Total submissions" value={totalSubmissions} icon={<Target className="w-4 h-4" />} onClick={() => navigate('/admin/submissions')} />
      </KpiRow>

      <KpiRow>
        <KpiCard label="Candidates" value={totalCandidates} icon={<Users className="w-4 h-4" />} onClick={() => navigate('/admin/candidates')} />
        <KpiCard label="Placements" value={placedSubs} icon={<CheckCircle className="w-4 h-4" />} />
        <KpiCard label="Fulfillment rate" value={`${fulfillmentRate}%`} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Conversion rate" value={`${conversionRate}%`} icon={<ArrowUpRight className="w-4 h-4" />} />
      </KpiRow>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Recruitment pipeline" subtitle="End-to-end conversion funnel">
          <FunnelChart stages={funnelStages} />
        </ChartCard>

        <ChartCard title="Requirements breakdown" subtitle={`${reqs.length} total`}>
          {reqDonutData.length > 0 ? (
            <>
              <DonutChart data={reqDonutData} colors={donutColors} />
              <ChartLegend items={reqLegendItems} />
            </>
          ) : (
            <EmptyState title="No requirements" description="Create your first requirement to see the breakdown." />
          )}
        </ChartCard>
      </div>

      {/* Strategic Insights */}
      <DashboardSection title="Strategic insights & risks">
        <div className="space-y-0">
          {insightItems.map((insight, i) => (
            <ActionItem
              key={i}
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label={insight.label}
              badge={insight.badge}
              badgeColor={insight.badgeColor}
            />
          ))}
        </div>
      </DashboardSection>

      {/* Revenue summary placeholder */}
      <DashboardSection title="Revenue summary">
        <div
          className="rounded-lg border p-8 text-center"
          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <DollarSign className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Financial data integration pending
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Revenue, collections, and financial metrics will appear here once invoice and payment tables are configured.
          </p>
        </div>
      </DashboardSection>
    </div>
  );
};

// ─── CFO Financial Command Centre ──────────────────────────────────────────

export const CfoDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const { data: summary } = useQuery({
    queryKey: ['admin_dashboard_summary'],
    queryFn: fetchAdminDashboardSummary,
    staleTime: 30_000,
  });

  const { data: reqData } = useQuery({
    queryKey: ['cfo_requirements'],
    queryFn: () => fetchRequirements({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });

  const { data: subData } = useQuery({
    queryKey: ['cfo_submissions'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });

  const reqs = reqData?.data || [];
  const subs = subData?.data || [];
  const clients = summary?.clients || 0;
  const vendors = summary?.vendors || 0;

  const placedSubs = subs.filter((s) => s.stage === 'offered' || s.stage === 'offer_accepted' || s.stage === 'onboarded');
  const activeReqs = reqs.filter((r) => r.status === 'open').length;

  const sinceItems: DeltaItem[] = [
    { label: 'Active requirements', count: activeReqs, icon: <Briefcase className="w-3.5 h-3.5" /> },
    { label: 'Placements', count: placedSubs.length, icon: <CheckCircle className="w-3.5 h-3.5" /> },
    { label: 'Active clients', count: clients, icon: <Building2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      <GreetingHeader firstName={profile?.full_name?.split(' ')[0]} subtitle="Financial Command Centre" />
      <SinceLastVisit items={sinceItems} />

      {/* Operational overview — using live data */}
      <DashboardSection title="Operational overview">
        <KpiRow>
          <KpiCard label="Active clients" value={clients} icon={<Building2 className="w-4 h-4" />} onClick={() => navigate('/admin/organizations')} />
          <KpiCard label="Active vendors" value={vendors} icon={<Users className="w-4 h-4" />} onClick={() => navigate('/admin/vendor-performance')} />
          <KpiCard label="Open requirements" value={activeReqs} icon={<Briefcase className="w-4 h-4" />} onClick={() => navigate('/admin/requirements')} />
          <KpiCard label="Placements" value={placedSubs.length} icon={<CheckCircle className="w-4 h-4" />} />
        </KpiRow>
      </DashboardSection>

      {/* Financial KPIs — pending data integration */}
      <DashboardSection title="Revenue & collections">
        <KpiRow>
          <KpiCard label="Invoiced revenue" value="—" icon={<Receipt className="w-4 h-4" />} />
          <KpiCard label="Collections" value="—" icon={<Wallet className="w-4 h-4" />} />
          <KpiCard label="Outstanding receivables" value="—" icon={<CreditCard className="w-4 h-4" />} />
          <KpiCard label="Vendor payables" value="—" icon={<FileText className="w-4 h-4" />} />
        </KpiRow>
      </DashboardSection>

      <DashboardSection title="Profitability & cash flow">
        <KpiRow>
          <KpiCard label="Gross profit" value="—" icon={<TrendingUp className="w-4 h-4" />} />
          <KpiCard label="Operating profit" value="—" icon={<PiggyBank className="w-4 h-4" />} />
          <KpiCard label="Operating expenses" value="—" icon={<TrendingDown className="w-4 h-4" />} />
          <KpiCard label="Net cash position" value="—" icon={<DollarSign className="w-4 h-4" />} />
        </KpiRow>
      </DashboardSection>

      {/* Receivables ageing placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Receivables ageing" subtitle="Outstanding invoice ageing breakdown">
          <div className="py-8 text-center">
            <Clock className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Invoice and payment tables required. Ageing buckets (0-30, 31-60, 61-90, 90+ days) will appear once financial data is integrated.
            </p>
          </div>
        </ChartCard>

        <ChartCard title="Cash flow projection" subtitle="Monthly inflows vs outflows">
          <div className="py-8 text-center">
            <TrendingUp className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Cash flow projections will be calculated from invoice collections, vendor payments, and operating expenses once the data sources are configured.
            </p>
          </div>
        </ChartCard>
      </div>

      {/* Business model segmentation */}
      <DashboardSection title="Revenue by business model">
        <div
          className="rounded-lg border p-6"
          style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
            {['Permanent', 'Contract', 'C2C', 'C2H', 'FTE/Payroll', 'SaaS'].map((model) => (
              <div key={model} className="rounded-md border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{model}</div>
                <div className="text-lg font-semibold mt-1" style={{ color: 'var(--text-tertiary)' }}>—</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-center mt-4" style={{ color: 'var(--text-tertiary)' }}>
            Revenue segmentation will populate once invoice records include service model classification.
          </p>
        </div>
      </DashboardSection>

      {/* Financial alerts */}
      <DashboardSection title="Financial alerts">
        <ActionItem
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label="Financial data integration pending — invoice, payment, and expense tables need to be created"
          badge="Info"
        />
      </DashboardSection>
    </div>
  );
};
