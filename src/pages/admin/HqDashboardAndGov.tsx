import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
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
import { VendorPerformancePanel } from '../../components/domain/VendorScoreCard';
import { OrganizationOnboardingPanel } from '../../components/domain/OrganizationOnboardingPanel';
import {
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
  const { profile } = useAuth();
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
    queryFn: () => fetchRequirements({ page: 1, pageSize: 20 }),
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

  const summary = data || {};
  const candBySource = summary.candidates_by_source || {};
  const reqByStatus = summary.requirements_by_status || {};
  const subByStage = summary.submissions_by_stage || {};

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

  return (
    <div className="space-y-8">
      {/* Workspace Dashboard Header Band (Sky 50 + 24px storm-blue dot grid at 8% opacity) */}
      <div className="dashboard-header-band rounded-[10px] border border-[var(--border)] px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="type-greeting text-[var(--text-primary)]">
            {profile?.full_name ? `Good day, ${profile.full_name.split(' ')[0]}` : 'Operations'}
          </h1>
          <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">
            Governed overview across client requisitions, vendor SLAs, and pipeline stages.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePublishAllToVendors}
            loading={syncingVendors}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Publish &amp; share all with vendors
          </Button>
          <Button size="sm" onClick={() => navigate(`${prefix}/requirements`)}>
            View all requirements
          </Button>
        </div>
      </div>

      {/* 1. Needs attention */}
      <section className="space-y-2.5">
        <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Needs attention
        </h2>
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
          {attentionItems.map((item) => (
            <div
              key={item.label}
              onClick={() => navigate(item.to)}
              className="h-11 px-4 flex items-center justify-between text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Badge tone={item.tone}>{item.label}</Badge>
              <div className="flex items-center gap-4">
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {item.count}
                </span>
                <span className="text-[12px] leading-[16px] text-[var(--accent)] font-medium">
                  Review →
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Single row of 4 plain metrics separated by vertical dividers */}
      <MetricStrip
        items={[
          {
            label: 'Client organizations',
            value: summary.clients ?? 0,
            onClick: () =>
              navigate(isAdmin ? '/admin/organizations' : `${prefix}/requirements`),
          },
          {
            label: 'Vendor agencies',
            value: summary.vendors ?? 0,
            onClick: () =>
              navigate(isAdmin ? '/admin/organizations' : `${prefix}/vendor-performance`),
          },
          {
            label: 'Open requirements',
            value: reqByStatus.open ?? 0,
            onClick: () => navigate(`${prefix}/requirements?status=open`),
          },
          {
            label: 'Active interviews',
            value: subByStage.interviewing ?? 0,
            onClick: () => navigate(`${prefix}/submissions?stage=interviewing`),
          },
        ]}
      />

      {/* 2B. Company-Wide Offer & Onboarding Lifecycle Metrics */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Offer Management &amp; Onboarding Oversight
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`${prefix}/offers`)}>
              Offers Desk ({offerMetrics.offersIssued})
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate(`${prefix}/onboarded`)}>
              Confirmed Onboarded ({offerMetrics.onboardedCandidates})
            </Button>
          </div>
        </div>
        <MetricStrip
          items={[
            {
              label: 'Candidates shared',
              value: offerMetrics.candidatesShared,
              onClick: () => navigate(`${prefix}/submissions`),
            },
            {
              label: 'Offers issued',
              value: offerMetrics.offersIssued,
              onClick: () => navigate(`${prefix}/offers`),
            },
            {
              label: 'Offers accepted',
              value: offerMetrics.offersAccepted,
              tone: offerMetrics.offersAccepted > 0 ? 'success' : 'default',
              onClick: () => navigate(`${prefix}/offers`),
            },
            {
              label: 'Pending offers',
              value: offerMetrics.pendingOffers,
              tone: offerMetrics.pendingOffers > 0 ? 'warning' : 'default',
              onClick: () => navigate(`${prefix}/offers`),
            },
            {
              label: 'Confirmed onboarded',
              value: offerMetrics.onboardedCandidates,
              tone: offerMetrics.onboardedCandidates > 0 ? 'success' : 'default',
              onClick: () => navigate(`${prefix}/onboarded`),
            },
            {
              label: 'Upcoming joinings',
              value: offerMetrics.upcomingJoiningsCount,
              onClick: () => navigate(`${prefix}/onboarded`),
            },
          ]}
        />
      </section>

      {/* 3. Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2.5">
          <h3 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Candidates by source
          </h3>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {(['vendor', 'direct', 'internal'] as const).map((src) => (
              <div
                key={src}
                onClick={() => navigate(`${prefix}/candidates?source=${src}`)}
                className="h-11 px-4 flex items-center justify-between text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[var(--text-primary)]">
                  {src === 'internal'
                    ? 'HireNest'
                    : src === 'direct'
                      ? 'Direct'
                      : 'Vendor'}
                </span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {candBySource[src] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2.5">
          <h3 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Requirements by status
          </h3>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {(
              ['open', 'pending_approval', 'draft', 'on_hold', 'filled', 'closed'] as const
            ).map((st) => (
              <div
                key={st}
                onClick={() => navigate(`${prefix}/requirements?status=${st}`)}
                className="h-11 px-4 flex items-center justify-between text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[var(--text-primary)]">
                  {REQUIREMENT_STATUS_LABELS[st]}
                </span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {reqByStatus[st] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2.5">
          <h3 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Submissions by stage
          </h3>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {(
              [
                'applied',
                'recruiter_review',
                'client_review',
                'interviewing',
                'offered',
                'onboarded',
              ] as const
            ).map((stage) => (
              <div
                key={stage}
                onClick={() => navigate(`${prefix}/submissions?stage=${stage}`)}
                className="h-11 px-4 flex items-center justify-between text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[var(--text-primary)]">{STAGE_LABELS[stage]}</span>
                <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                  {subByStage[stage] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Active Requirements Overview on Dashboard */}
      {recentReqs?.data && recentReqs.data.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Active requirements ({recentReqs.data.length})
            </h3>
            <Link
              to={`${prefix}/requirements`}
              className="text-[12px] font-medium text-[var(--accent)] hover:underline"
            >
              Open requirements pipeline →
            </Link>
          </div>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)] overflow-hidden">
            {recentReqs.data.slice(0, 6).map((req) => {
              const budgetInfo = formatRequirementBudgetWithSubtitle(req);
              return (
                <div
                  key={req.id}
                  onClick={() => navigate(`${prefix}/requirements/${req.id}`)}
                  className="h-12 px-4 flex items-center justify-between gap-4 text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-[var(--text-primary)] truncate">
                      {req.title}
                    </span>
                    <Badge tone={req.status === 'open' ? 'emerald' : 'slate'}>
                      {REQUIREMENT_STATUS_LABELS[req.status]}
                    </Badge>
                    <span className="text-[12px] text-[var(--text-secondary)] truncate hidden sm:inline">
                      {req.organizations?.name || 'Client'} · {req.location} · {req.work_mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                      {budgetInfo.formatted}
                    </span>
                    <span className="text-[12px] text-[var(--accent)] font-medium">
                      Open →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

// 2. Admin Approvals Page
export const AdminApprovalsPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [assignRole, setAssignRole] = useState<AppRole>('vendor_admin');
  const [orgMode, setOrgMode] = useState<'existing' | 'new'>('existing');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<OrgType>('vendor');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pending_profiles', page],
    queryFn: () => fetchProfiles({ page, status: 'pending_approval' }),
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations_all'],
    queryFn: () => fetchOrganizations({ page: 1, pageSize: 100 }),
  });

  const handleOpenApprove = (u: Profile) => {
    setSelectedUser(u);
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
      let targetOrgId: string | null = selectedOrgId || null;
      if (orgMode === 'new') {
        if (!newOrgName.trim()) {
          toast({ title: 'Enter organization name', tone: 'error' });
          setSubmitting(false);
          return;
        }
        const createdOrg = await createOrganization({
          name: newOrgName.trim(),
          type: newOrgType,
          status: 'approved',
          sla_tier: 'standard',
          contact_name: selectedUser.full_name,
          contact_email: selectedUser.email,
        });
        targetOrgId = createdOrg.id;
      }

      await adminAssignUser({
        p_user_id: selectedUser.id,
        p_role: assignRole,
        p_org_id: targetOrgId,
        p_status: 'active',
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
      await adminAssignUser({
        p_user_id: u.id,
        p_role: 'pending',
        p_org_id: null,
        p_status: 'suspended',
      });
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Verify company sign-ups, assign organizations, and activate role access."
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No pending sign-ups"
          description="New vendor agency and hiring client registrations will appear here for verification."
        />
      ) : (
        <div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Intent</th>
                  <th>Requested company</th>
                  <th>Registered</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.full_name}</td>
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {u.email}
                    </td>
                    <td>
                      <Badge tone="amber">{u.requested_role || 'pending'}</Badge>
                    </td>
                    <td className="text-[var(--text-secondary)]">
                      {u.requested_company || '-'}
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDate(u.created_at)}
                    </td>
                    <td className="text-right space-x-1.5">
                      <Button size="sm" onClick={() => handleOpenApprove(u)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleRejectUser(u)}
                      >
                        Reject
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
      )}

      {/* Approve User Modal */}
      <Dialog
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title="Approve & assign user"
        description={
          selectedUser ? `${selectedUser.full_name} · ${selectedUser.email}` : ''
        }
      >
        <div className="space-y-4">
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
            <Button onClick={handleApproveConfirm} loading={submitting}>
              Activate account
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

// 3. Admin Organizations Page
export const AdminOrganizationsPage: React.FC = () => {
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

  const openModal = (org?: Organization) => {
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
                      <Button size="sm" variant="ghost" onClick={() => openModal(org)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </div>
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
            <Input
              label="Contact name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <Input
              label="Contact email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            <Input
              label="Contact phone"
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

  const { data: org, isLoading } = useQuery({
    queryKey: ['organization_detail', id],
    queryFn: () => fetchOrganizationById(id!),
    enabled: Boolean(id),
  });

  const { data: usersData } = useQuery({
    queryKey: ['org_users', id],
    queryFn: () => fetchProfiles({ orgId: id!, page: 1 }),
    enabled: Boolean(id),
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
      />

      {org.type !== 'internal' && <OrganizationOnboardingPanel orgId={org.id} isAdmin />}

      {org.type === 'vendor' && vendorPerf && (
        <section className="space-y-3">
          <h2 className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Vendor performance
          </h2>
          <VendorPerformancePanel performance={vendorPerf} />
        </section>
      )}

      {/* Users in Organization */}
      <section className="space-y-2">
        <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
          Users ({usersData?.count || 0})
        </h3>
        {!usersData?.data.length ? (
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3 border-y border-[var(--border)]">
            No users assigned to this organization.
          </p>
        ) : (
          <div className="border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {usersData.data.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.full_name}</td>
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {u.email}
                    </td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>
                      <Badge tone={u.status === 'active' ? 'emerald' : 'red'}>
                        {u.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
