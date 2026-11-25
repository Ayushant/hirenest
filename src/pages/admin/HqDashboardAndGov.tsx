import { OrganizationTeam } from '../../components/domain/OrganizationTeam';
import { RegistrationReviewDetails } from '../../components/domain/RegistrationReviewDetails';
import React, { useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Building2, Briefcase, Users, CalendarCheck, Send, CheckCircle, Clock, AlertTriangle, ShieldCheck, FileText, Check, X, Eye } from 'lucide-react';
import {
  PageHeader,
  MetricStrip,
  Button,
  Input,
  Select,
  Badge,
  Tabs,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Pagination,
  Dialog,
} from '../../components/ui/kit';
import {
  KpiCard,
  KpiRow,
  ChartCard,
  DonutChart,
  ChartLegend,
  FunnelChart,
  DashboardSection,
  ActionItem,
  ProgressBar,
  GreetingHeader,
  SinceLastVisit,
} from '../../components/ui/DashboardKit';
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { OrganizationOnboardingPanel } from '../../components/domain/OrganizationOnboardingPanel';
import {
  fetchAllComplianceDocuments,
  reviewOrganizationDocument,
  updateOrganizationNdaStatus,
  createSignedDocumentUrl,
  DOCUMENT_KIND_LABELS,
  type OrganizationDocumentWithOrg,
  type DocumentReviewStatus,
} from '../../api/onboarding';
import {
  reviewRegistration,
  fetchAdminDashboardSummary,
  fetchProfiles,
  adminAssignUser,
  adminLinkCandidateAccount,
  fetchOrganizations,
  fetchOrganizationById,
  createOrganization,
  updateOrganization,
} from '../../api/admin';
import {
  fetchRequirements,
  syncAllOpenRequirementsWithVendors,
} from '../../api/requirements';
import { fetchCandidates } from '../../api/candidates';
import { fetchSubmissions } from '../../api/submissions';
import { getVendorPerformanceRpc } from '../../api/interviews';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { mapSupabaseError } from '../../lib/errors';
import {
  ROLE_LABELS,
  STAGE_LABELS,
  REQUIREMENT_STATUS_LABELS,
  formatLocalDate,
  formatRequirementBudgetWithSubtitle,
} from '../../lib/format';
import {
  computeOfferOnboardingMetrics,
  fetchAllOfferOnboardingRecordsApi,
} from '../../lib/offerOnboarding';
import { useToast } from '../../components/ui/Toast';
import type {
  AppRole,
  Organization,
  OrgStatus,
  OrgType,
  Profile,
  SlaTier,
} from '../../types/db';

// 1. HQ Dashboard: Starts with "Needs attention" list -> 4-metric vertical-divider strip -> Breakdown lists
export const HqDashboardPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === 'admin';
  const prefix = isAdmin ? '/admin' : '/recruiter';
  const [syncingVendors, setSyncingVendors] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin_dashboard_summary'],
    queryFn: fetchAdminDashboardSummary,
  });

  const { data: recentReqs } = useQuery({
    queryKey: ['requirements', 'dashboard_overview'],
    // Canonical list (deduped, soft-deleted removed): the single source for every number below.
    queryFn: () => fetchRequirements({ page: 1, pageSize: 1000 }),
  });

  const { data: allHqSubs } = useQuery({
    queryKey: ['hq-dashboard-subs'],
    queryFn: () => fetchSubmissions({ page: 1, pageSize: 250 }),
  });

  const { data: offerRecordsMap } = useQuery({
    queryKey: ['offers-onboarding-workspace', 'hq_dashboard'],
    queryFn: fetchAllOfferOnboardingRecordsApi,
  });

  const offerMetrics = computeOfferOnboardingMetrics(
    allHqSubs?.data || [],
    offerRecordsMap
  );

  const summary = data || {};
  const candBySource = summary.candidates_by_source || {};
  // Derive status counts from the same canonical list the requirements page shows,
  // so dashboard numbers always match (no more 356 vs 21).
  const reqByStatus: Record<string, number> = useMemo(() => {
    if (!recentReqs?.data) return summary.requirements_by_status || {};
    const counts: Record<string, number> = {};
    for (const r of recentReqs.data) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [recentReqs?.data, summary.requirements_by_status]);
  const openReqsList = (recentReqs?.data || []).filter((r) => r.status === 'open');
  const subByStage = summary.submissions_by_stage || {};

  const reqDonutData = useMemo(() => [
    { name: 'Open', value: reqByStatus.open ?? 0 },
    { name: 'Pending', value: reqByStatus.pending_approval ?? 0 },
    { name: 'Draft', value: reqByStatus.draft ?? 0 },
    { name: 'On Hold', value: reqByStatus.on_hold ?? 0 },
    { name: 'Filled', value: reqByStatus.filled ?? 0 },
    { name: 'Closed', value: reqByStatus.closed ?? 0 },
  ].filter((d) => d.value > 0), [reqByStatus]);

  const funnelStages = useMemo(() => [
    { name: 'Applied', value: subByStage.applied ?? 0, color: '#939084' },
    { name: 'Recruiter review', value: subByStage.recruiter_review ?? 0, color: '#C98A4B' },
    { name: 'Client review', value: subByStage.client_review ?? 0, color: '#1D5FD1' },
    { name: 'Interviewing', value: subByStage.interviewing ?? 0, color: '#2A9D8F' },
    { name: 'Offered', value: subByStage.offered ?? 0, color: '#D99A2B' },
    { name: 'Onboarded', value: subByStage.onboarded ?? 0, color: '#17734A' },
  ], [subByStage]);

  const handlePublishAllToVendors = async () => {
    setSyncingVendors(true);
    try {
      const res = await syncAllOpenRequirementsWithVendors();
      toast({
        title: 'Requirements published & shared with vendors',
        description: `${res.sharedRequirementCount} open requirement(s) distributed to vendor agencies (${res.publishedCount} newly published).`,
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['admin_dashboard_summary'] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_requirements'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_shares'] });
    } catch (err) {
      toast({
        title: 'Could not sync requirements with vendors',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSyncingVendors(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="type-greeting text-[var(--text-primary)]">Overview</h1>
        <TableSkeleton rows={4} cols={4} />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />;
  }

  const attentionItems = [
    ...(isAdmin
      ? [
          {
            label: 'Pending user approvals',
            count: summary.pending_users ?? 0,
            to: '/admin/approvals',
            tone: (summary.pending_users ?? 0) > 0 ? ('amber' as const) : ('slate' as const),
          },
        ]
      : []),
    {
      label: 'Completed interviews awaiting structured feedback',
      count: summary.interviews_pending_feedback ?? 0,
      to: `${prefix}/interviews`,
      tone:
        (summary.interviews_pending_feedback ?? 0) > 0 ? ('red' as const) : ('slate' as const),
    },
    ...(isAdmin
      ? [
          {
            label: 'Open vendor rating disputes',
            count: summary.open_disputes ?? 0,
            to: '/admin/disputes',
            tone: (summary.open_disputes ?? 0) > 0 ? ('amber' as const) : ('slate' as const),
          },
        ]
      : []),
    {
      label: 'Open duplicate & ownership flags',
      count: summary.open_duplicate_flags ?? 0,
      to: `${prefix}/duplicates`,
      tone: (summary.open_duplicate_flags ?? 0) > 0 ? ('amber' as const) : ('slate' as const),
    },
  ];

  const totalCandidates = (candBySource.vendor ?? 0) + (candBySource.direct ?? 0) + (candBySource.internal ?? 0);
  const totalReqs = Object.values(reqByStatus).reduce((a, b) => a + (b || 0), 0);
  const totalSubs = Object.values(subByStage).reduce((a, b) => a + (b || 0), 0);

  const REQ_COLORS = ['#2A9D8F', '#D99A2B', '#939084', '#36342E', '#1D5FD1', '#B8322B'];

  return (
    <div className="space-y-7">
      {/* Header Band */}
      <div className="dashboard-header-band rounded-[12px] border border-[var(--border)] px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <GreetingHeader
          fullName={profile?.full_name}
          organizationName={organization?.name || 'HireNest Workforce Private Limited'}
          roleName={profile?.role === 'admin' ? 'HQ Admin' : 'Business Operations Manager'}
          subtitle="Governed overview across client requisitions, vendor SLAs, and pipeline stages."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handlePublishAllToVendors} loading={syncingVendors}>
            <RefreshCw className="h-3.5 w-3.5" />
            Publish &amp; share all with vendors
          </Button>
          <Button size="sm" onClick={() => navigate(`${prefix}/requirements`)}>
            View all requirements
          </Button>
        </div>
      </div>

      <SinceLastVisit
        items={[
          { label: 'new candidates', count: summary.pending_users ?? 0 },
          { label: 'open reqs', count: reqByStatus.open ?? 0 },
          { label: 'pending feedback', count: summary.interviews_pending_feedback ?? 0 },
        ]}
      />

      {/* KPI Cards Row */}
      <KpiRow cols={4}>
        <KpiCard
          label="Client Organizations"
          value={summary.clients ?? 0}
          icon={<Building2 className="w-5 h-5" />}
          accentColor="#1D5FD1"
          onClick={() => navigate(isAdmin ? '/admin/organizations' : `${prefix}/requirements`)}
        />
        <KpiCard
          label="Vendor Agencies"
          value={summary.vendors ?? 0}
          icon={<Briefcase className="w-5 h-5" />}
          accentColor="#C98A4B"
          onClick={() => navigate(isAdmin ? '/admin/organizations' : `${prefix}/vendor-performance`)}
        />
        <KpiCard
          label="Total Candidates"
          value={totalCandidates}
          icon={<Users className="w-5 h-5" />}
          accentColor="#2A9D8F"
          onClick={() => navigate(`${prefix}/candidates`)}
        />
        <KpiCard
          label="Open Requirements"
          value={reqByStatus.open ?? 0}
          icon={<CalendarCheck className="w-5 h-5" />}
          accentColor="#D99A2B"
          onClick={() => navigate(`${prefix}/requirements?status=open`)}
        />
      </KpiRow>

      {/* Needs Attention */}
      {attentionItems.some((item) => item.count > 0) && (
        <DashboardSection title="Needs attention">
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            {attentionItems.map((item) => (
              <ActionItem
                key={item.label}
                icon={
                  item.tone === 'red' || item.tone === 'amber'
                    ? <AlertTriangle className="w-4 h-4" />
                    : <Clock className="w-4 h-4" />
                }
                label={item.label}
                count={item.count}
                badge={item.count > 0 ? 'Action needed' : undefined}
                badgeColor={item.tone === 'red' ? '#B8322B' : '#D99A2B'}
                onClick={() => navigate(item.to)}
              />
            ))}
          </div>
        </DashboardSection>
      )}

      {/* Charts Row: Requirements by Status (Donut) + Submission Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          title="Requirements by status"
          subtitle={`${totalReqs} total requirements`}
        >
          <DonutChart
            data={reqDonutData}
            colors={REQ_COLORS}
            centerValue={totalReqs}
            centerLabel="Total"
          />
          <ChartLegend
            items={reqDonutData.map((d, i) => ({
              name: d.name,
              color: REQ_COLORS[i % REQ_COLORS.length],
              value: d.value,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Submission pipeline"
          subtitle={`${totalSubs} total submissions`}
        >
          <FunnelChart stages={funnelStages} />
        </ChartCard>
      </div>

      {/* Offer & Onboarding Lifecycle */}
      <DashboardSection
        title="Offer management & onboarding"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`${prefix}/offers`)}>
              Offers ({offerMetrics.offersIssued})
            </Button>
            <Button size="sm" onClick={() => navigate(`${prefix}/onboarded`)}>
              Onboarded ({offerMetrics.onboardedCandidates})
            </Button>
          </div>
        }
      >
        <KpiRow cols={6}>
          <KpiCard
            label="Candidates shared"
            value={offerMetrics.candidatesShared}
            icon={<Send className="w-4 h-4" />}
            accentColor="#C98A4B"
            onClick={() => navigate(`${prefix}/submissions`)}
          />
          <KpiCard
            label="Offers issued"
            value={offerMetrics.offersIssued}
            icon={<Briefcase className="w-4 h-4" />}
            accentColor="#1D5FD1"
            onClick={() => navigate(`${prefix}/offers`)}
          />
          <KpiCard
            label="Offers accepted"
            value={offerMetrics.offersAccepted}
            icon={<CheckCircle className="w-4 h-4" />}
            accentColor="#17734A"
            onClick={() => navigate(`${prefix}/offers`)}
          />
          <KpiCard
            label="Pending offers"
            value={offerMetrics.pendingOffers}
            icon={<Clock className="w-4 h-4" />}
            accentColor="#D99A2B"
            onClick={() => navigate(`${prefix}/offers`)}
          />
          <KpiCard
            label="Confirmed onboarded"
            value={offerMetrics.onboardedCandidates}
            icon={<CheckCircle className="w-4 h-4" />}
            accentColor="#2A9D8F"
            onClick={() => navigate(`${prefix}/onboarded`)}
          />
          <KpiCard
            label="Upcoming joinings"
            value={offerMetrics.upcomingJoiningsCount}
            icon={<CalendarCheck className="w-4 h-4" />}
            accentColor="#939084"
            onClick={() => navigate(`${prefix}/onboarded`)}
          />
        </KpiRow>
      </DashboardSection>

      {/* Candidates by Source */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartCard title="Candidates by source" subtitle={`${totalCandidates} total`}>
          <div className="px-3 space-y-4 py-2">
            <ProgressBar label="Vendor" value={candBySource.vendor ?? 0} total={totalCandidates} color="#1D5FD1" />
            <ProgressBar label="Direct" value={candBySource.direct ?? 0} total={totalCandidates} color="#C98A4B" />
            <ProgressBar label="HireNest" value={candBySource.internal ?? 0} total={totalCandidates} color="#2A9D8F" />
          </div>
        </ChartCard>

        <ChartCard title="Requirements breakdown" className="lg:col-span-2">
          <div className="rounded-[12px] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {(['open', 'pending_approval', 'draft', 'on_hold', 'filled', 'closed'] as const).map((st) => (
              <div
                key={st}
                onClick={() => navigate(`${prefix}/requirements?status=${st}`)}
                className="h-11 px-4 flex items-center justify-between text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[var(--text-primary)]">{REQUIREMENT_STATUS_LABELS[st]}</span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">{reqByStatus[st] ?? 0}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Active Requirements Table */}
      {openReqsList.length > 0 && (
        <DashboardSection
          title={`Active requirements (${openReqsList.length})`}
          action={
            <Link to={`${prefix}/requirements`} className="text-[12px] font-medium text-[var(--accent)] hover:underline">
              Open requirements pipeline →
            </Link>
          }
        >
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {openReqsList.slice(0, 6).map((req) => {
              const budgetInfo = formatRequirementBudgetWithSubtitle(req);
              return (
                <div
                  key={req.id}
                  onClick={() => navigate(`${prefix}/requirements/${req.id}`)}
                  className="h-12 px-4 flex items-center justify-between gap-4 text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-[var(--text-primary)] truncate">{req.title}</span>
                    <Badge tone={req.status === 'open' ? 'emerald' : 'slate'}>
                      {REQUIREMENT_STATUS_LABELS[req.status]}
                    </Badge>
                    <span className="text-[12px] text-[var(--text-secondary)] truncate hidden sm:inline">
                      {req.organizations?.name || 'Client'} · {req.location} · {req.work_mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">{budgetInfo.formatted}</span>
                    <span className="text-[12px] text-[var(--accent)] font-medium">Open →</span>
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardSection>
      )}
    </div>
  );
};

// 2. Admin Approvals Page (User Signups + Compliance & NDA Reviews)
export const AdminApprovalsPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'compliance' | 'users'>('compliance');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [registrationReason, setRegistrationReason] = useState('');
  const [assignRole, setAssignRole] = useState<AppRole>('vendor_admin');
  const [orgMode, setOrgMode] = useState<'existing' | 'new'>('existing');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<OrgType>('vendor');
  const [submitting, setSubmitting] = useState(false);

  // Compliance state
  const [compStatusFilter, setCompStatusFilter] = useState<'all' | 'pending_review' | 'approved' | 'rejected'>('all');
  const [compSearch, setCompSearch] = useState('');
  const [reviewingDoc, setReviewingDoc] = useState<OrganizationDocumentWithOrg | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected' | 'more_info_requested'>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pending_profiles', page],
    queryFn: () => fetchProfiles({ page }),
  });

  const { data: compDocs = [], isLoading: compLoading, refetch: refetchComp } = useQuery({
    queryKey: ['admin_compliance_documents'],
    queryFn: fetchAllComplianceDocuments,
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations_all'],
    queryFn: () => fetchOrganizations({ page: 1, pageSize: 100 }),
  });

  const pendingUsersCount = data?.count || data?.data.length || 0;
  const pendingDocsCount = compDocs.filter((d) => d.status === 'pending_review').length;
  const executedNdaCount = compDocs.filter((d) => d.kind === 'nda_executed').length;
  const approvedDocsCount = compDocs.filter((d) => d.status === 'approved').length;

  const filteredCompDocs = useMemo(() => {
    return compDocs.filter((d) => {
      if (compStatusFilter !== 'all' && d.status !== compStatusFilter) return false;
      if (compSearch.trim()) {
        const q = compSearch.trim().toLowerCase();
        const orgName = (d.organizations?.name || '').toLowerCase();
        const fileName = (d.original_name || '').toLowerCase();
        const kindLabel = (DOCUMENT_KIND_LABELS[d.kind] || '').toLowerCase();
        if (!orgName.includes(q) && !fileName.includes(q) && !kindLabel.includes(q)) return false;
      }
      return true;
    });
  }, [compDocs, compStatusFilter, compSearch]);

  const handleOpenApprove = (u: Profile) => {
    setSelectedUser(u);
    setRegistrationReason('');
    const defaultRole: AppRole =
      u.requested_role === 'client' ? 'client_manager' : 'vendor_admin';
    setAssignRole(defaultRole);
    setNewOrgName(u.requested_company || '');
    setNewOrgType(u.requested_role === 'client' ? 'client' : 'vendor');
    setOrgMode(u.requested_company ? 'new' : 'existing');
    setSelectedOrgId('');
  };

  const handleApproveConfirm = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    try {
      await reviewRegistration({
        p_user_id:selectedUser.id,p_decision:'approved',p_reason:registrationReason,
        p_role:assignRole,p_org_id:orgMode==='existing'?selectedOrgId||null:null,
        p_org_name:orgMode==='new'?newOrgName.trim():null,p_org_type:newOrgType,
      });

      toast({
        title: 'User approved',
        description: `${selectedUser.full_name} assigned as ${ROLE_LABELS[assignRole]}.`,
        tone: 'success',
      });
      setSelectedUser(null);
      queryClient.invalidateQueries({ queryKey: ['pending_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_dashboard_summary'] });
      queryClient.invalidateQueries({ queryKey: ['organizations_all'] });
    } catch (err) {
      toast({
        title: 'Approval failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectUser = async (u: Profile) => {
    try {
      await reviewRegistration({p_user_id:u.id,p_decision:'rejected',p_reason:registrationReason});
      setSelectedUser(null);
      toast({
        title: 'Account suspended',
        description: u.email,
        tone: 'info',
      });
      queryClient.invalidateQueries({ queryKey: ['pending_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_dashboard_summary'] });
    } catch (err) {
      toast({
        title: 'Action failed',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    }
  };

  // Compliance Document actions
  const handleViewDoc = async (doc: OrganizationDocumentWithOrg) => {
    if (!doc.storage_path) {
      toast({ title: 'No storage path for this file.', tone: 'error' });
      return;
    }
    setOpeningDocId(doc.id);
    try {
      const url = await createSignedDocumentUrl(doc.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({ title: 'Could not open document', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleDirectApproveDoc = async (doc: OrganizationDocumentWithOrg) => {
    setReviewSaving(true);
    try {
      await reviewOrganizationDocument({
        documentId: doc.id,
        decision: 'approved',
        notes: 'Approved by admin',
      });
      if (doc.kind === 'nda_executed') {
        await updateOrganizationNdaStatus({
          orgId: doc.org_id,
          status: 'verified',
          evidenceDocId: doc.id,
          notes: 'Verified upon approving executed NDA document',
        });
      }
      toast({
        title: 'Document approved',
        description: `${doc.organizations?.name || 'Organization'} is now approved and verified for protected collaboration.`,
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_documents'] });
      queryClient.invalidateQueries({ queryKey: ['organization_onboarding', doc.org_id] });
      queryClient.invalidateQueries({ queryKey: ['organizations_all'] });
    } catch (err) {
      toast({ title: 'Approval failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setReviewSaving(false);
    }
  };

  const handleSubmitReviewDoc = async () => {
    if (!reviewingDoc) return;
    setReviewSaving(true);
    try {
      await reviewOrganizationDocument({
        documentId: reviewingDoc.id,
        decision: reviewDecision,
        notes: reviewNotes || null,
      });
      if (reviewDecision === 'approved' && reviewingDoc.kind === 'nda_executed') {
        await updateOrganizationNdaStatus({
          orgId: reviewingDoc.org_id,
          status: 'verified',
          evidenceDocId: reviewingDoc.id,
          notes: reviewNotes || 'Verified upon approving executed NDA document',
        });
      } else if (reviewDecision === 'rejected' && reviewingDoc.kind === 'nda_executed') {
        await updateOrganizationNdaStatus({
          orgId: reviewingDoc.org_id,
          status: 'rejected',
          evidenceDocId: reviewingDoc.id,
          notes: reviewNotes || 'Rejected during review',
        });
      }
      toast({
        title: `Document ${reviewDecision.replace('_', ' ')}`,
        tone: reviewDecision === 'approved' ? 'success' : 'info',
      });
      setReviewingDoc(null);
      setReviewNotes('');
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_documents'] });
      queryClient.invalidateQueries({ queryKey: ['organization_onboarding', reviewingDoc.org_id] });
      queryClient.invalidateQueries({ queryKey: ['organizations_all'] });
    } catch (err) {
      toast({ title: 'Review recording failed', description: mapSupabaseError(err), tone: 'error' });
    } finally {
      setReviewSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals & Compliance Review"
        description="Verify vendor NDAs, legal documentation, and company user registrations."
      />

      {/* Tabs Switcher */}
      <div className="flex border-b border-[var(--border)] gap-6">
        <button
          type="button"
          onClick={() => setActiveTab('compliance')}
          className={`pb-3 text-[14px] font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'compliance'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Compliance &amp; NDA Reviews
          {pendingDocsCount > 0 ? (
            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-300">
              {pendingDocsCount}
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-[var(--bg-subtle)] text-[var(--text-tertiary)]">
              {compDocs.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`pb-3 text-[14px] font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'users'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Users className="w-4 h-4" />
          User Sign-ups
          {pendingUsersCount > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-300">
              {pendingUsersCount}
            </span>
          )}
        </button>
      </div>

      {/* ─── TAB 1: COMPLIANCE & NDA REVIEWS ──────────────────────────────── */}
      {activeTab === 'compliance' && (
        <div className="space-y-6">
          {/* Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-[8px] border border-amber-200 bg-amber-50/50">
              <div className="text-[12px] font-medium text-amber-700">Pending Review</div>
              <div className="text-[22px] font-bold text-amber-900 mt-1">{pendingDocsCount}</div>
            </div>
            <div className="p-3.5 rounded-[8px] border border-blue-200 bg-blue-50/50">
              <div className="text-[12px] font-medium text-blue-700">Executed NDAs</div>
              <div className="text-[22px] font-bold text-blue-900 mt-1">{executedNdaCount}</div>
            </div>
            <div className="p-3.5 rounded-[8px] border border-emerald-200 bg-emerald-50/50">
              <div className="text-[12px] font-medium text-emerald-700">Approved &amp; Verified</div>
              <div className="text-[22px] font-bold text-emerald-900 mt-1">{approvedDocsCount}</div>
            </div>
            <div className="p-3.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <div className="text-[12px] font-medium text-[var(--text-secondary)]">Total Documents</div>
              <div className="text-[22px] font-bold text-[var(--text-primary)] mt-1">{compDocs.length}</div>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={compStatusFilter === 'all' ? 'primary' : 'outline'}
                onClick={() => setCompStatusFilter('all')}
              >
                All ({compDocs.length})
              </Button>
              <Button
                size="sm"
                variant={compStatusFilter === 'pending_review' ? 'primary' : 'outline'}
                onClick={() => setCompStatusFilter('pending_review')}
              >
                Pending Review ({pendingDocsCount})
              </Button>
              <Button
                size="sm"
                variant={compStatusFilter === 'approved' ? 'primary' : 'outline'}
                onClick={() => setCompStatusFilter('approved')}
              >
                Approved ({approvedDocsCount})
              </Button>
              <Button
                size="sm"
                variant={compStatusFilter === 'rejected' ? 'primary' : 'outline'}
                onClick={() => setCompStatusFilter('rejected')}
              >
                Rejected / More Info
              </Button>
            </div>
            <div className="w-72">
              <Input
                placeholder="Search vendor or file name…"
                value={compSearch}
                onChange={(e) => setCompSearch(e.target.value)}
              />
            </div>
          </div>

          {compLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : filteredCompDocs.length === 0 ? (
            <EmptyState
              title={compStatusFilter === 'pending_review' ? 'No pending documents' : 'No compliance documents found'}
              description={
                compStatusFilter === 'pending_review'
                  ? 'All uploaded NDAs and compliance files have been reviewed.'
                  : 'Documents uploaded by vendor agencies and clients will appear here.'
              }
            />
          ) : (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table>
                <thead>
                  <tr>
                    <th>Vendor / Organization</th>
                    <th>Document Type</th>
                    <th>Attached File</th>
                    <th>Status</th>
                    <th>Uploaded</th>
                    <th>Notes</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompDocs.map((doc) => {
                    const statusTone =
                      doc.status === 'approved'
                        ? 'success'
                        : doc.status === 'pending_review'
                        ? 'amber'
                        : doc.status === 'rejected'
                        ? 'danger'
                        : 'info';
                    const fileSizeKb = doc.size_bytes ? Math.round(doc.size_bytes / 1024) : null;
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div className="font-medium text-[var(--text-primary)]">
                            {doc.organizations?.name || 'Organization'}
                          </div>
                          <Badge tone="neutral" className="mt-0.5 text-[10px]">
                            {doc.organizations?.type || 'vendor'}
                          </Badge>
                        </td>
                        <td>
                          <div className="font-medium text-[13px]">
                            {DOCUMENT_KIND_LABELS[doc.kind] || doc.kind}
                          </div>
                          {doc.kind === 'nda_executed' && (
                            <span className="text-[11px] text-blue-600 font-semibold">
                              Protected Sourcing NDA
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-secondary)]">
                            <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="truncate max-w-[180px]">{doc.original_name || 'Document'}</span>
                            {fileSizeKb && <span className="text-[11px] text-[var(--text-tertiary)]">({fileSizeKb} KB)</span>}
                          </div>
                        </td>
                        <td>
                          <Badge tone={statusTone}>
                            {doc.status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                          {formatLocalDate(doc.uploaded_at)}
                        </td>
                        <td className="text-[12px] text-[var(--text-secondary)] max-w-[200px] truncate">
                          {doc.review_notes || '—'}
                        </td>
                        <td className="text-right space-x-1.5 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDoc(doc)}
                            loading={openingDocId === doc.id}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            View
                          </Button>
                          {doc.status === 'pending_review' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleDirectApproveDoc(doc)}
                                loading={reviewSaving}
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                  setReviewingDoc(doc);
                                  setReviewDecision('rejected');
                                  setReviewNotes('');
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {doc.status !== 'pending_review' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReviewingDoc(doc);
                                setReviewDecision(doc.status === 'approved' ? 'rejected' : 'approved');
                                setReviewNotes(doc.review_notes || '');
                              }}
                            >
                              Edit review
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: USER SIGN-UPS ────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : error ? (
            <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
          ) : !data?.data.length ? (
            <EmptyState
              title="No sign-ups yet"
              description="Candidate, vendor and client registrations will appear here for review."
            />
          ) : (
            <div>
              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Mobile</th><th>User type</th><th>Designation</th><th>Business role</th>
                      <th>Requested company</th>
                      <th>Registered</th><th>Verification</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((u) => (
                      <tr key={u.id}>
                        <td className="font-medium"><button className="underline" onClick={() => handleOpenApprove(u)}>{u.full_name}</button></td>
                        <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                          {u.email}
                        </td>
                        <td>{u.phone || '—'}</td>
                        <td>
                          <Badge tone="amber">{u.requested_role || 'pending'}</Badge>
                        </td><td>{u.designation || '—'}</td><td>{u.business_role || u.department || '—'}</td>
                        <td className="text-[var(--text-secondary)]">
                          {u.requested_company || '-'}
                        </td>
                        <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                          {formatLocalDate(u.created_at)}
                        </td>
                        <td>{u.registration_details?.verification_status || '—'}</td>
                        <td><Button size="sm" onClick={() => handleOpenApprove(u)}>Review</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
            </div>
          )}
        </div>
      )}

      {/* Review Document Dialog */}
      <Dialog
        open={Boolean(reviewingDoc)}
        onClose={() => setReviewingDoc(null)}
        title="Review Compliance Document"
        description={
          reviewingDoc
            ? `${reviewingDoc.organizations?.name || 'Organization'} · ${DOCUMENT_KIND_LABELS[reviewingDoc.kind] || reviewingDoc.kind}`
            : ''
        }
      >
        <div className="space-y-4">
          <div className="p-3 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] space-y-1">
            <div className="text-[13px] font-medium text-[var(--text-primary)]">
              File: {reviewingDoc?.original_name || 'Document'}
            </div>
            <div className="text-[12px] text-[var(--text-tertiary)]">
              Uploaded at {reviewingDoc ? formatLocalDate(reviewingDoc.uploaded_at) : '—'}
            </div>
            {reviewingDoc?.storage_path && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => reviewingDoc && handleViewDoc(reviewingDoc)}
              >
                <Eye className="w-3.5 h-3.5 mr-1" />
                View document in new tab
              </Button>
            )}
          </div>

          <Select
            label="Decision"
            value={reviewDecision}
            onChange={(e) => setReviewDecision(e.target.value as any)}
            options={[
              { value: 'approved', label: 'Approve (Verify organization)' },
              { value: 'rejected', label: 'Reject' },
              { value: 'more_info_requested', label: 'Request more information' },
            ]}
          />

          <div>
            <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">
              Review Notes (visible in audit record)
            </label>
            <textarea
              className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={3}
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="e.g. Valid incorporation documents and signed authorized representative verified."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setReviewingDoc(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitReviewDoc} loading={reviewSaving}>
              Submit review decision
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Approve User Modal */}
      <Dialog
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title="Registration review"
        description={
          selectedUser ? `${selectedUser.full_name} · ${selectedUser.email}` : ''
        }
      >
        <div className="space-y-4">
          {selectedUser && <RegistrationReviewDetails user={selectedUser} />}
          {selectedUser?.registration_details?.verification_status === 'pending' && <>
          <Input label="Review reason (required for approval or rejection)" value={registrationReason} onChange={e=>setRegistrationReason(e.target.value)} />
          <Select
            label="Role"
            value={assignRole}
            onChange={(e) => setAssignRole(e.target.value as AppRole)}
            options={[
              { value: 'client_manager', label: 'Client hiring manager' },
              { value: 'client_member', label: 'Client interview panel' },
              { value: 'vendor_admin', label: 'Vendor agency admin' },
              { value: 'vendor_recruiter', label: 'Vendor recruiter' },
              { value: 'recruiter', label: 'HireNest recruiter' },
              { value: 'admin', label: 'HireNest admin' },
              { value: 'candidate', label: 'Direct candidate' },
            ]}
          />

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={orgMode === 'existing' ? 'primary' : 'outline'}
              onClick={() => setOrgMode('existing')}
            >
              Existing organization
            </Button>
            <Button
              type="button"
              size="sm"
              variant={orgMode === 'new' ? 'primary' : 'outline'}
              onClick={() => setOrgMode('new')}
            >
              New organization
            </Button>
          </div>

          {orgMode === 'existing' ? (
            <Select
              label="Organization"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              options={[
                { value: '', label: 'No organization (HQ / Candidate)' },
                ...(orgsData?.data || []).map((o) => ({
                  value: o.id,
                  label: `${o.name} (${o.type})`,
                })),
              ]}
            />
          ) : (
            <div className="space-y-3 rounded-[6px] border border-[var(--border)] p-3 bg-[var(--bg-subtle)]">
              <Input
                label="New organization name"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Legal or brand name"
              />
              <Select
                label="Organization type"
                value={newOrgType}
                onChange={(e) => setNewOrgType(e.target.value as OrgType)}
                options={[
                  { value: 'client', label: 'Hiring client' },
                  { value: 'vendor', label: 'Vendor agency' },
                  { value: 'internal', label: 'HireNest internal' },
                ]}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={submitting || registrationReason.trim().length < 3} onClick={() => selectedUser && handleRejectUser(selectedUser)}>Reject registration</Button>
            <Button onClick={handleApproveConfirm} loading={submitting} disabled={registrationReason.trim().length < 3}>
              Activate account
            </Button>
          </div>
          </>}
        </div>
      </Dialog>
    </div>
  );
};

// 3. Admin Organizations Page
export const AdminOrganizationsPage: React.FC = () => {
  const { profile, startImpersonating } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<OrgType>('client');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<OrgType>('client');
  const [status, setStatus] = useState<OrgStatus>('approved');
  const [slaTier, setSlaTier] = useState<SlaTier>('standard');
  const [industry, setIndustry] = useState('');
  const [domain, setDomain] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['organizations', activeTab, page, search],
    queryFn: () =>
      fetchOrganizations({
        page,
        type: activeTab,
        search,
      }),
  });

  const { data: internalProfilesData, isLoading: loadingInternalProfiles } = useQuery({
    queryKey: ['internal_team_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'recruiter'])
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as Profile[];
    },
    enabled: activeTab === 'internal',
  });

  const { data: staffMembersData } = useQuery({
    queryKey: ['internal_staff_members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_members')
        .select('*');
      if (error) return [];
      return data || [];
    },
    enabled: activeTab === 'internal',
  });

  const [companyFields,setCompanyFields]=useState({website:'',location:'',business_classification:'',staffing_capabilities:[] as string[],engagement_models:[] as string[]});
  const openModal = (org?: Organization) => {
    setCompanyFields({website:org?.website||'',location:org?.location||'',business_classification:org?.business_classification||'',staffing_capabilities:org?.staffing_capabilities||[],engagement_models:org?.engagement_models||[]});
    if (org) {
      setEditingOrg(org);
      setName(org.name);
      setType(org.type);
      setStatus(org.status);
      setSlaTier(org.sla_tier);
      setIndustry(org.industry || '');
      setDomain(org.domain || '');
      setGstNumber(org.gst_number || '');
      setContactName(org.contact_name || '');
      setContactEmail(org.contact_email || '');
      setContactPhone(org.contact_phone || '');
    } else {
      setEditingOrg(null);
      setName('');
      setType(activeTab);
      setStatus('approved');
      setSlaTier('standard');
      setIndustry('');
      setDomain('');
      setGstNumber('');
      setContactName('');
      setContactEmail('');
      setContactPhone('');
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...companyFields,
        name: name.trim(),
        type,
        status,
        sla_tier: slaTier,
        industry: industry.trim() || null,
        domain: domain.trim() || null,
        gst_number: gstNumber.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      };
      if (editingOrg) {
        await updateOrganization(editingOrg.id, payload);
        toast({ title: 'Organization updated', tone: 'success' });
      } else {
        await createOrganization(payload);
        toast({ title: 'Organization created', tone: 'success' });
      }
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    } catch (err) {
      toast({
        title: 'Could not save organization',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Manage hiring clients, vendor agencies, SLA tiers, and approval statuses."
        actions={
          <Button onClick={() => openModal()}>
            <Plus className="h-3.5 w-3.5" />
            New organization
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'client', label: 'Clients' },
          { id: 'vendor', label: 'Vendors' },
          { id: 'internal', label: 'Internal' },
        ]}
        activeTab={activeTab}
        onChange={(id) => {
          setActiveTab(id as OrgType);
          setPage(1);
        }}
      />

      <div className="flex items-center gap-2">
        <div className="w-64">
          <Input
            placeholder="Filter by name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {search && (
          <Button size="sm" variant="ghost" onClick={() => setSearch('')}>
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No organizations found"
          description="Create an organization to assign users and requirements."
          actionLabel="New organization"
          onAction={() => openModal()}
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Status</th>
                  <th>SLA tier</th>
                  <th>Industry & domain</th>
                  <th>Primary contact</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => navigate(`/admin/organizations/${org.id}`)}
                    className="cursor-pointer"
                  >
                    <td className="font-medium">{org.name}</td>
                    <td>
                      <Badge
                        tone={
                          org.status === 'approved'
                            ? 'emerald'
                            : org.status === 'pending_review'
                              ? 'amber'
                              : 'red'
                        }
                      >
                        {org.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {org.sla_tier}
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      {org.industry || '-'} {org.domain ? `· ${org.domain}` : ''}
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      {org.contact_name || '-'}{' '}
                      {org.contact_email ? `(${org.contact_email})` : ''}
                    </td>
                    <td
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {org.type === 'vendor' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              startImpersonating(org);
                              navigate('/vendor');
                            }}
                            title={`Jump into workspace as ${org.name}`}
                          >
                            View as Vendor
                          </Button>
                        )}
                        {org.type === 'client' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              startImpersonating(org);
                              navigate('/client');
                            }}
                            title={`Jump into workspace as ${org.name}`}
                          >
                            View as Client
                          </Button>
                        )}
                        {org.type === 'internal' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              startImpersonating(org);
                              navigate('/admin');
                            }}
                            title={`Jump into workspace as ${org.name}`}
                          >
                            View Internal
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openModal(org)}>
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      {activeTab === 'internal' && (
        <section className="space-y-4 pt-6 border-t border-[var(--border)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--accent)]" />
                Internal Operations &amp; HQ Staff Access
              </h2>
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                Active operations managers, platform administrators, and recruiters with internal workspace access.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/admin/team')}
              title="Configure internal staff permissions and departments"
            >
              Manage Team &amp; Permissions →
            </Button>
          </div>

          {loadingInternalProfiles ? (
            <TableSkeleton rows={4} cols={5} />
          ) : !internalProfilesData?.length ? (
            <div className="py-6 text-center text-[13px] text-[var(--text-secondary)] border border-[var(--border)] rounded-[8px]">
              No internal staff members configured yet.
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table>
                <thead>
                  <tr>
                    <th>Staff Member</th>
                    <th>Designation &amp; Role</th>
                    <th>Employee ID</th>
                    <th>Access Scope</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {internalProfilesData.map((staffProf) => {
                    const staffMeta = (staffMembersData || []).find(
                      (s: any) => s.user_id === staffProf.id
                    );
                    const designation =
                      staffMeta?.designation ||
                      (staffProf.role === 'admin'
                        ? 'Platform Administrator & Operations Lead'
                        : 'Operations & Sourcing Specialist');
                    const employeeId = staffMeta?.employee_id || '—';
                    const isCurrentUser = staffProf.id === profile?.id;

                    return (
                      <tr key={staffProf.id}>
                        <td>
                          <div className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                            {staffProf.full_name || staffProf.email.split('@')[0]}
                            {isCurrentUser && (
                              <Badge tone="rich_blue">You</Badge>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
                            {staffProf.email}
                          </div>
                        </td>
                        <td>
                          <div className="text-[13px] text-[var(--text-primary)] font-medium">
                            {designation}
                          </div>
                          <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wide">
                            {ROLE_LABELS[staffProf.role] || staffProf.role}
                          </div>
                        </td>
                        <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                          {employeeId}
                        </td>
                        <td>
                          <Badge tone={staffProf.role === 'admin' ? 'indigo' : 'neutral'}>
                            {staffProf.role === 'admin' ? 'HQ Platform Governance' : 'Sourcing & Operations'}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={staffProf.status === 'active' ? 'emerald' : 'red'}>
                            {staffProf.status}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate('/admin/team')}
                            title="Edit permissions in Team Management"
                          >
                            Permissions
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingOrg ? 'Edit organization' : 'New organization'}
        maxWidth="max-w-[640px]"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Organization name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as OrgType)}
              options={[
                { value: 'client', label: 'Client' },
                { value: 'vendor', label: 'Vendor' },
                { value: 'internal', label: 'Internal' },
              ]}
            />
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrgStatus)}
              options={[
                { value: 'approved', label: 'Approved' },
                { value: 'pending_review', label: 'Pending review' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
            <Select
              label="SLA tier"
              value={slaTier}
              onChange={(e) => setSlaTier(e.target.value as SlaTier)}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'premium', label: 'Premium' },
                { value: 'enterprise', label: 'Enterprise' },
              ]}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
            <Input
              label="Domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="company.com"
            />
            <Input
              label="GST number"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['website','location','business_classification'] as const).map(key=><Input key={key} label={key.replaceAll('_',' ')} value={companyFields[key]} onChange={e=>setCompanyFields({...companyFields,[key]:e.target.value})}/>)}
            {(['staffing_capabilities','engagement_models'] as const).map(key=><fieldset key={key}><legend className="text-[12px]">{key.replaceAll('_',' ')}</legend><div className="flex gap-3">{(key==='staffing_capabilities'?['IT','Non-IT']:['FTE','C2C','C2H']).map(v=><label key={v} className="flex gap-1 text-[13px]"><input type="checkbox" checked={companyFields[key].includes(v)} onChange={e=>setCompanyFields({...companyFields,[key]:e.target.checked?[...companyFields[key],v]:companyFields[key].filter(x=>x!==v)})}/>{v}</label>)}</div></fieldset>)}
            {editingOrg?.primary_contact_user_id&&<p className="text-[12px]">Primary contact details are managed through the linked user profile.</p>}
            <Input
              label="Contact name"
              disabled={Boolean(editingOrg?.primary_contact_user_id)}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <Input
              label="Contact email"
              disabled={Boolean(editingOrg?.primary_contact_user_id)}
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            <Input
              label="Contact phone"
              disabled={Boolean(editingOrg?.primary_contact_user_id)}
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save organization
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

// 4. Admin Organization Detail Page
export const AdminOrganizationDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { startImpersonating } = useAuth();
  const navigate = useNavigate();

  const { data: org, isLoading } = useQuery({
    queryKey: ['organization_detail', id],
    queryFn: () => fetchOrganizationById(id!),
    enabled: Boolean(id),
  });

  const { data: usersData } = useQuery({
    queryKey: ['org_users', id, org?.type],
    queryFn: async () => {
      if (org?.type === 'internal') {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .in('role', ['admin', 'recruiter'])
          .order('created_at', { ascending: true });
        if (error) throw error;
        return { data: (data || []) as Profile[], count: data?.length || 0 };
      }
      return fetchProfiles({ orgId: id!, page: 1 });
    },
    enabled: Boolean(id && org),
  });

  const { data: reqsData } = useQuery({
    queryKey: ['org_requirements', id],
    queryFn: () => fetchRequirements({ clientOrgId: id!, page: 1 }),
    enabled: Boolean(id && org?.type === 'client'),
  });

  const { data: vendorCandidates } = useQuery({
    queryKey: ['org_vendor_candidates', id],
    queryFn: () => fetchCandidates({ ownerVendorOrgId: id!, page: 1 }),
    enabled: Boolean(id && org?.type === 'vendor'),
  });

  const { data: vendorSubmissions } = useQuery({
    queryKey: ['org_vendor_submissions', id],
    queryFn: () => fetchSubmissions({ vendorOrgId: id!, page: 1 }),
    enabled: Boolean(id && org?.type === 'vendor'),
  });

  const { data: vendorPerf } = useQuery({
    queryKey: ['vendor_performance', id],
    queryFn: () => getVendorPerformanceRpc(id!),
    enabled: Boolean(id && org?.type === 'vendor'),
  });

  if (isLoading || !org) {
    return <TableSkeleton rows={5} cols={4} />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={org.name}
        description={`${org.type} organization · Status: ${org.status.replace('_', ' ')} · SLA tier: ${org.sla_tier}`}
        actions={
          org.type === 'vendor' ? (
            <Button
              onClick={() => {
                startImpersonating(org);
                navigate('/vendor');
              }}
              title={`Simulate and view workspace as ${org.name}`}
            >
              Jump into Workspace (View as Vendor)
            </Button>
          ) : org.type === 'client' ? (
            <Button
              onClick={() => {
                startImpersonating(org);
                navigate('/client');
              }}
              title={`Simulate and view workspace as ${org.name}`}
            >
              Jump into Workspace (View as Client)
            </Button>
          ) : org.type === 'internal' ? (
            <Button
              onClick={() => {
                startImpersonating(org);
                navigate('/admin');
              }}
              title={`Simulate and view workspace as ${org.name}`}
            >
              Jump into Workspace (View Internal)
            </Button>
          ) : undefined
        }
      />

      {org.type !== 'internal' && <OrganizationOnboardingPanel orgId={org.id} isAdmin />}

      {org.type === 'vendor' && vendorPerf && <section className="space-y-3"><h2 className="font-semibold">Vendor performance</h2><VendorPerformancePanel performance={vendorPerf} /></section>}
      <section className="grid gap-3 sm:grid-cols-2 rounded-lg border border-[var(--border)] p-4">
        {Object.entries({Website:org.website,Location:org.location,Industry:org.industry,Classification:org.business_classification,'Staffing capabilities':org.staffing_capabilities?.join(', '),'Engagement models':org.engagement_models?.join(', '),'Primary contact':org.contact_name,Mobile:org.contact_phone,Email:org.contact_email,Designation:org.primary_contact?.designation,Department:org.primary_contact?.department,'Business role':org.primary_contact?.business_role,Verification:org.status}).map(([k,v])=><div key={k}><div className="text-[12px] text-[var(--text-secondary)]">{k}</div><div className="text-[13px]">{v||'—'}</div></div>)}
      </section>
      <OrganizationTeam orgId={org.id} internal={org.type==='internal'} />

      {org.type === 'client' && (
        <section className="space-y-2">
          <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
            Client requirements ({reqsData?.count || 0})
          </h3>
          {!reqsData?.data.length ? (
            <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3 border-y border-[var(--border)]">
              No requirements created yet.
            </p>
          ) : (
            <div className="border-t border-[var(--border)]">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {reqsData.data.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          to={`/admin/requirements/${r.id}`}
                          className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                        >
                          {r.title}
                        </Link>
                      </td>
                      <td>
                        <Badge tone={r.status === 'open' ? 'emerald' : 'slate'}>
                          {REQUIREMENT_STATUS_LABELS[r.status]}
                        </Badge>
                      </td>
                      <td className="text-[var(--text-secondary)]">{r.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {org.type === 'vendor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-2">
            <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
              Vendor candidates ({vendorCandidates?.count || 0})
            </h3>
            {!vendorCandidates?.data.length ? (
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3 border-y border-[var(--border)]">
                No candidates in pool.
              </p>
            ) : (
              <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
                {vendorCandidates.data.map((c) => (
                  <div
                    key={c.id}
                    className="h-10 px-3 flex items-center justify-between text-[13px] leading-[20px]"
                  >
                    <Link
                      to={`/admin/candidates/${c.id}`}
                      className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                    >
                      {c.full_name}
                    </Link>
                    <span className="text-[var(--text-secondary)]">
                      {c.current_title || '-'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
              Vendor submissions ({vendorSubmissions?.count || 0})
            </h3>
            {!vendorSubmissions?.data.length ? (
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3 border-y border-[var(--border)]">
                No submissions recorded.
              </p>
            ) : (
              <div className="border-y border-[var(--border)] divide-y divide-[var(--border)]">
                {vendorSubmissions.data.map((s) => (
                  <div
                    key={s.id}
                    className="h-10 px-3 flex items-center justify-between text-[13px] leading-[20px]"
                  >
                    <span className="truncate">
                      {s.candidates?.full_name || 'Candidate'} →{' '}
                      {s.requirements?.title || 'Requirement'}
                    </span>
                    <Badge tone="slate">{STAGE_LABELS[s.stage]}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

// 5. Admin Users Page
export const AdminUsersPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('');
  const [orgFilter, setOrgFilter] = useState('');
  const [search, setSearch] = useState('');

  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [nextRole, setNextRole] = useState<AppRole>('candidate');
  const [nextOrgId, setNextOrgId] = useState('');
  const [nextStatus, setNextStatus] = useState<'active' | 'pending_approval' | 'suspended'>(
    'active'
  );
  const [saving, setSaving] = useState(false);

  const [linkModalUser, setLinkModalUser] = useState<Profile | null>(null);
  const [linkCandidateId, setLinkCandidateId] = useState('');
  const [linking, setLinking] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin_users', page, roleFilter, orgFilter, search],
    queryFn: () =>
      fetchProfiles({
        page,
        role: roleFilter,
        orgId: orgFilter,
        search,
      }),
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations_all'],
    queryFn: () => fetchOrganizations({ page: 1, pageSize: 100 }),
  });

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      await adminAssignUser({
        p_user_id: editingUser.id,
        p_role: nextRole,
        p_org_id: nextOrgId || null,
        p_status: nextStatus,
      });
      toast({ title: 'User updated', tone: 'success' });
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin_users'] });
    } catch (err) {
      toast({
        title: 'Could not update user',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLinkCandidate = async () => {
    if (!linkModalUser || !linkCandidateId.trim()) return;
    setLinking(true);
    try {
      await adminLinkCandidateAccount({
        p_candidate_id: linkCandidateId.trim(),
        p_user_id: linkModalUser.id,
      });
      await queryClient.invalidateQueries();
      toast({
        title: 'Candidate profile linked',
        tone: 'success',
      });
      setLinkModalUser(null);
      setLinkCandidateId('');
    } catch (err) {
      toast({
        title: 'Could not link candidate account',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Assign workspace roles, organization memberships, account statuses, and candidate profile links."
      />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Input
            placeholder="Search by full name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-48">
          <Select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as AppRole | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All roles' },
              { value: 'admin', label: 'HQ admin' },
              { value: 'recruiter', label: 'HQ recruiter' },
              { value: 'client_manager', label: 'Client hiring manager' },
              { value: 'client_member', label: 'Client member' },
              { value: 'vendor_admin', label: 'Vendor admin' },
              { value: 'vendor_recruiter', label: 'Vendor recruiter' },
              { value: 'candidate', label: 'Direct candidate' },
              { value: 'pending', label: 'Pending' },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All organizations' },
              ...(orgsData?.data || []).map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </div>
        {(roleFilter || orgFilter || search) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRoleFilter('');
              setOrgFilter('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No matching users"
          description="Clear your role or organization filters to view all users."
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Organization</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((u) => {
                  const orgName =
                    orgsData?.data.find((o) => o.id === u.org_id)?.name || '-';
                  return (
                    <tr key={u.id}>
                      <td className="font-medium">{u.full_name}</td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {u.email}
                      </td>
                      <td className="text-[var(--text-secondary)]">{ROLE_LABELS[u.role]}</td>
                      <td>
                        <Badge
                          tone={
                            u.status === 'active'
                              ? 'emerald'
                              : u.status === 'pending_approval'
                                ? 'amber'
                                : 'red'
                          }
                        >
                          {u.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="text-[var(--text-secondary)]">{orgName}</td>
                      <td className="text-right space-x-1.5">
                        {u.role === 'candidate' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setLinkModalUser(u);
                              setLinkCandidateId('');
                            }}
                          >
                            Link profile
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingUser(u);
                            setNextRole(u.role);
                            setNextOrgId(u.org_id || '');
                            setNextStatus(u.status);
                          }}
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      {/* Manage User Role / Org / Status Modal */}
      <Dialog
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Manage user role & status"
        description={editingUser ? `${editingUser.full_name} · ${editingUser.email}` : ''}
      >
        <div className="space-y-4">
          <Select
            label="Role"
            value={nextRole}
            onChange={(e) => setNextRole(e.target.value as AppRole)}
            options={[
              { value: 'admin', label: 'HQ admin' },
              { value: 'recruiter', label: 'HQ recruiter' },
              { value: 'client_manager', label: 'Client hiring manager' },
              { value: 'client_member', label: 'Client member' },
              { value: 'vendor_admin', label: 'Vendor admin' },
              { value: 'vendor_recruiter', label: 'Vendor recruiter' },
              { value: 'candidate', label: 'Direct candidate' },
              { value: 'pending', label: 'Pending' },
            ]}
          />
          <Select
            label="Organization"
            value={nextOrgId}
            onChange={(e) => setNextOrgId(e.target.value)}
            options={[
              { value: '', label: 'None' },
              ...(orgsData?.data || []).map((o) => ({
                value: o.id,
                label: `${o.name} (${o.type})`,
              })),
            ]}
          />
          <Select
            label="Status"
            value={nextStatus}
            onChange={(e) =>
              setNextStatus(e.target.value as 'active' | 'pending_approval' | 'suspended')
            }
            options={[
              { value: 'active', label: 'Active' },
              { value: 'pending_approval', label: 'Pending approval' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Link Candidate Account Modal */}
      <Dialog
        open={Boolean(linkModalUser)}
        onClose={() => setLinkModalUser(null)}
        title="Link candidate record"
        description={`Link a candidate UUID to ${linkModalUser?.full_name} (${linkModalUser?.email}).`}
      >
        <div className="space-y-4">
          <Input
            label="Candidate ID (UUID)"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={linkCandidateId}
            onChange={(e) => setLinkCandidateId(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLinkModalUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleLinkCandidate}
              loading={linking}
              disabled={!linkCandidateId.trim()}
            >
              Link account
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
