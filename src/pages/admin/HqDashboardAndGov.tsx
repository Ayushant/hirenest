import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCheck, Building2, Link2 } from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
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
import { fetchRequirements } from '../../api/requirements';
import { fetchCandidates } from '../../api/candidates';
import { fetchSubmissions } from '../../api/submissions';
import { getVendorPerformanceRpc } from '../../api/interviews';
import { useAuth } from '../../auth/AuthProvider';
import { mapSupabaseError } from '../../lib/errors';
import { ROLE_LABELS, STAGE_LABELS, REQUIREMENT_STATUS_LABELS, formatLocalDate } from '../../lib/format';
import { useToast } from '../../components/ui/Toast';
import type {
  AppRole,
  Organization,
  OrgStatus,
  OrgType,
  Profile,
  SlaTier,
} from '../../types/db';

// 1. HQ Dashboard (Admin & Recruiter)
export const HqDashboardPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const prefix = profile?.role === 'admin' ? '/admin' : '/recruiter';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin_dashboard_summary'],
    queryFn: fetchAdminDashboardSummary,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="HQ Operations Dashboard"
          description="Real-time governance overview across clients, vendors, requirements, and pipelines."
        />
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="HQ Operations Dashboard"
        description="Governed overview of organizations, active requirements, candidate sources, and SLA queues."
      />

      {/* Top Row StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Client Organizations"
          value={summary.clients ?? 0}
          sublabel="Active & pending clients"
          onClick={() =>
            navigate(profile?.role === 'admin' ? '/admin/organizations?type=client' : `${prefix}/requirements`)
          }
        />
        <StatCard
          label="Vendor Agencies"
          value={summary.vendors ?? 0}
          sublabel="Partner staffing agencies"
          onClick={() =>
            navigate(
              profile?.role === 'admin'
                ? '/admin/organizations?type=vendor'
                : `${prefix}/vendor-performance`
            )
          }
        />
        {profile?.role === 'admin' && (
          <StatCard
            label="Pending User Approvals"
            value={summary.pending_users ?? 0}
            tone={(summary.pending_users ?? 0) > 0 ? 'amber' : 'default'}
            sublabel="Awaiting org & role assignment"
            onClick={() => navigate('/admin/approvals')}
          />
        )}
        <StatCard
          label="Open Duplicate Flags"
          value={summary.open_duplicate_flags ?? 0}
          tone={(summary.open_duplicate_flags ?? 0) > 0 ? 'amber' : 'default'}
          sublabel="Require ownership review"
          onClick={() => navigate(`${prefix}/duplicates`)}
        />
        {profile?.role === 'admin' && (
          <StatCard
            label="Open Rating Disputes"
            value={summary.open_disputes ?? 0}
            tone={(summary.open_disputes ?? 0) > 0 ? 'red' : 'default'}
            sublabel="Vendor rating disputes"
            onClick={() => navigate('/admin/disputes')}
          />
        )}
        <StatCard
          label="Interviews Pending Feedback"
          value={summary.interviews_pending_feedback ?? 0}
          tone={(summary.interviews_pending_feedback ?? 0) > 0 ? 'red' : 'default'}
          sublabel="Completed rounds awaiting ratings"
          onClick={() => navigate(`${prefix}/interviews`)}
        />
      </div>

      {/* Breakdown Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Candidates by Source
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {(['vendor', 'direct', 'internal'] as const).map((src) => (
              <div
                key={src}
                onClick={() => navigate(`${prefix}/candidates?source=${src}`)}
                className="py-2.5 flex items-center justify-between cursor-pointer hover:text-indigo-600"
              >
                <span className="capitalize">
                  {src === 'internal' ? 'HireNest Sourced' : src === 'direct' ? 'Direct Applicant' : 'Vendor Sourced'}
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {candBySource[src] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Requirements by Status
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {(
              ['draft', 'pending_approval', 'open', 'on_hold', 'closed', 'filled'] as const
            ).map((st) => (
              <div
                key={st}
                onClick={() => navigate(`${prefix}/requirements?status=${st}`)}
                className="py-2 flex items-center justify-between cursor-pointer hover:text-indigo-600"
              >
                <span>{REQUIREMENT_STATUS_LABELS[st]}</span>
                <span className="font-mono tabular-nums font-semibold">
                  {reqByStatus[st] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Submissions by Pipeline Stage
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-60 overflow-y-auto">
            {(
              [
                'applied',
                'recruiter_review',
                'client_review',
                'interviewing',
                'offered',
                'offer_accepted',
                'onboarded',
                'rejected',
                'withdrawn',
              ] as const
            ).map((stage) => (
              <div
                key={stage}
                onClick={() => navigate(`${prefix}/submissions?stage=${stage}`)}
                className="py-2 flex items-center justify-between cursor-pointer hover:text-indigo-600"
              >
                <span>{STAGE_LABELS[stage]}</span>
                <span className="font-mono tabular-nums font-semibold">
                  {subByStage[stage] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// 2. Admin Approvals Page (pending profiles -> Approve dialog: pick or create org, pick role -> admin_assign_user)
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
        title: 'User approved and activated',
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
        title: 'Account rejected and suspended',
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
        title="Pending User Approvals"
        description="Verify company sign-ups, provision or assign organizations, and activate role access."
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : !data?.data.length ? (
        <EmptyState
          title="No pending sign-ups"
          description="All vendor agency and hiring client registrations have been processed."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Requested Intent</th>
                  <th className="py-3 px-4">Requested Company</th>
                  <th className="py-3 px-4">Registered</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {data.data.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {u.full_name}
                    </td>
                    <td className="py-3 px-4 font-mono">{u.email}</td>
                    <td className="py-3 px-4 capitalize">
                      <Badge tone="amber">{u.requested_role || 'pending'}</Badge>
                    </td>
                    <td className="py-3 px-4">{u.requested_company || '—'}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {formatLocalDate(u.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button size="sm" onClick={() => handleOpenApprove(u)}>
                        <UserCheck className="h-3.5 w-3.5" />
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
          <Pagination
            page={page}
            totalCount={data.count}
            onPageChange={setPage}
          />
        </Card>
      )}

      {/* Approve User Modal */}
      <Dialog
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title="Approve & Assign User"
        description={
          selectedUser
            ? `${selectedUser.full_name} (${selectedUser.email})`
            : ''
        }
      >
        <div className="space-y-4">
          <Select
            label="Assign Role"
            value={assignRole}
            onChange={(e) => setAssignRole(e.target.value as AppRole)}
            options={[
              { value: 'client_manager', label: 'Client Hiring Manager' },
              { value: 'client_member', label: 'Client Interview Panel' },
              { value: 'vendor_admin', label: 'Vendor Agency Admin' },
              { value: 'vendor_recruiter', label: 'Vendor Recruiter' },
              { value: 'recruiter', label: 'HireNest Internal Recruiter' },
              { value: 'admin', label: 'HireNest Admin' },
              { value: 'candidate', label: 'Direct Candidate' },
            ]}
          />

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={orgMode === 'existing' ? 'primary' : 'outline'}
              onClick={() => setOrgMode('existing')}
            >
              Pick Existing Organization
            </Button>
            <Button
              type="button"
              size="sm"
              variant={orgMode === 'new' ? 'primary' : 'outline'}
              onClick={() => setOrgMode('new')}
            >
              Create New Organization
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
            <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <Input
                label="New Organization Name"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Company legal or brand name"
              />
              <Select
                label="Organization Type"
                value={newOrgType}
                onChange={(e) => setNewOrgType(e.target.value as OrgType)}
                options={[
                  { value: 'client', label: 'Hiring Client' },
                  { value: 'vendor', label: 'Vendor Agency' },
                  { value: 'internal', label: 'HireNest Internal' },
                ]}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleApproveConfirm} loading={submitting}>
              Activate Account
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
        description="Manage Hiring Clients, Vendor Agencies, and Internal HQ entities, SLA tiers, and approval statuses."
        actions={
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4" />
            New Organization
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

      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter by organization name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
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
          description="Create a new organization to begin assigning users and requirements."
          actionLabel="New Organization"
          onAction={() => openModal()}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Organization</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">SLA Tier</th>
                  <th className="py-3 px-4">Industry / Domain</th>
                  <th className="py-3 px-4">Primary Contact</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {data.data.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => navigate(`/admin/organizations/${org.id}`)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {org.name}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        tone={
                          org.status === 'approved'
                            ? 'emerald'
                            : org.status === 'pending_review'
                              ? 'amber'
                              : 'red'
                        }
                      >
                        {org.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 uppercase font-mono text-[11px]">
                      {org.sla_tier}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {org.industry || '—'} {org.domain ? `· ${org.domain}` : ''}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {org.contact_name || '—'}{' '}
                      {org.contact_email ? `(${org.contact_email})` : ''}
                    </td>
                    <td
                      className="py-3 px-4 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="outline" onClick={() => openModal(org)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalCount={data.count} onPageChange={setPage} />
        </Card>
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingOrg ? 'Edit Organization' : 'Create Organization'}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-3.5">
          <Input
            label="Organization Name"
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
                { value: 'pending_review', label: 'Pending Review' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
            <Select
              label="SLA Tier"
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
              label="GST Number"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Contact Name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <Input
              label="Contact Email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            <Input
              label="Contact Phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Organization
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

// 4. Admin Organization Detail Page (Users, Requirements or Candidates/Submissions, Vendor Performance Card)
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
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={`${org.type.toUpperCase()} Organization · Status: ${org.status} · SLA Tier: ${org.sla_tier}`}
      />

      {org.type === 'vendor' && vendorPerf && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Vendor Performance Scorecard
          </h3>
          <VendorPerformancePanel performance={vendorPerf} />
        </div>
      )}

      {/* Users in Organization */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400" />
          Organization Users ({usersData?.count || 0})
        </h3>
        {!usersData?.data.length ? (
          <p className="text-xs text-slate-500">No users assigned to this organization.</p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {usersData.data.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold">{u.full_name}</span>
                  <span className="ml-2 font-mono text-slate-500">{u.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="indigo">{ROLE_LABELS[u.role]}</Badge>
                  <Badge tone={u.status === 'active' ? 'emerald' : 'red'}>{u.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {org.type === 'client' && (
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Client Requirements ({reqsData?.count || 0})
          </h3>
          {!reqsData?.data.length ? (
            <p className="text-xs text-slate-500">No requirements created yet.</p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {reqsData.data.map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <Link
                    to={`/admin/requirements/${r.id}`}
                    className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {r.title}
                  </Link>
                  <Badge tone="slate">{REQUIREMENT_STATUS_LABELS[r.status]}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {org.type === 'vendor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Owned Candidates ({vendorCandidates?.count || 0})
            </h3>
            {!vendorCandidates?.data.length ? (
              <p className="text-xs text-slate-500">No candidates in pool.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {vendorCandidates.data.map((c) => (
                  <div key={c.id} className="py-2 flex items-center justify-between">
                    <Link
                      to={`/admin/candidates/${c.id}`}
                      className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {c.full_name}
                    </Link>
                    <span className="text-slate-500">{c.current_title || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Vendor Submissions ({vendorSubmissions?.count || 0})
            </h3>
            {!vendorSubmissions?.data.length ? (
              <p className="text-xs text-slate-500">No submissions recorded.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {vendorSubmissions.data.map((s) => (
                  <div key={s.id} className="py-2 flex items-center justify-between">
                    <span>
                      {s.candidates?.full_name || 'Candidate'} → {s.requirements?.title || 'Req'}
                    </span>
                    <Badge tone="indigo">{STAGE_LABELS[s.stage]}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

// 5. Admin Users Page (list with role & org filters, admin_assign_user, admin_link_candidate_account)
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

  // Link candidate account modal (admin_link_candidate_account)
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
      toast({ title: 'User role & status updated', tone: 'success' });
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
        title: 'Candidate profile linked to user account',
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
        title="Users & Role Governance"
        description="Assign workspace roles, organization memberships, account statuses, and candidate profile links."
      />

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Input
          placeholder="Search by full name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as AppRole | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Roles' },
            { value: 'admin', label: 'HQ Admin' },
            { value: 'recruiter', label: 'HQ Recruiter' },
            { value: 'client_manager', label: 'Client Hiring Manager' },
            { value: 'client_member', label: 'Client Member' },
            { value: 'vendor_admin', label: 'Vendor Admin' },
            { value: 'vendor_recruiter', label: 'Vendor Recruiter' },
            { value: 'candidate', label: 'Direct Candidate' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
        <Select
          value={orgFilter}
          onChange={(e) => {
            setOrgFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Organizations' },
            ...(orgsData?.data || []).map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
        {(roleFilter || orgFilter || search) && (
          <Button
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
          description="Try clearing your role or organization filters."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Organization</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {data.data.map((u) => {
                  const orgName =
                    orgsData?.data.find((o) => o.id === u.org_id)?.name || '—';
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {u.full_name}
                      </td>
                      <td className="py-3 px-4 font-mono">{u.email}</td>
                      <td className="py-3 px-4">
                        <Badge tone="indigo">{ROLE_LABELS[u.role]}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          tone={
                            u.status === 'active'
                              ? 'emerald'
                              : u.status === 'pending_approval'
                                ? 'amber'
                                : 'red'
                          }
                        >
                          {u.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-slate-500">{orgName}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {u.role === 'candidate' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setLinkModalUser(u);
                              setLinkCandidateId('');
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Link Profile
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
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
        </Card>
      )}

      {/* Manage User Role / Org / Status Modal */}
      <Dialog
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Manage User Role & Status"
        description={editingUser ? `${editingUser.full_name} (${editingUser.email})` : ''}
      >
        <div className="space-y-4">
          <Select
            label="Role"
            value={nextRole}
            onChange={(e) => setNextRole(e.target.value as AppRole)}
            options={[
              { value: 'admin', label: 'HQ Admin' },
              { value: 'recruiter', label: 'HQ Recruiter' },
              { value: 'client_manager', label: 'Client Hiring Manager' },
              { value: 'client_member', label: 'Client Member' },
              { value: 'vendor_admin', label: 'Vendor Admin' },
              { value: 'vendor_recruiter', label: 'Vendor Recruiter' },
              { value: 'candidate', label: 'Direct Candidate' },
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
            label="Account Status"
            value={nextStatus}
            onChange={(e) =>
              setNextStatus(e.target.value as 'active' | 'pending_approval' | 'suspended')
            }
            options={[
              { value: 'active', label: 'Active' },
              { value: 'pending_approval', label: 'Pending Approval' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} loading={saving}>
              Save Changes
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Link Candidate Account Modal */}
      <Dialog
        open={Boolean(linkModalUser)}
        onClose={() => setLinkModalUser(null)}
        title="Link Existing Candidate Record"
        description={`Link a candidate UUID to ${linkModalUser?.full_name} (${linkModalUser?.email}) via admin_link_candidate_account.`}
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
              Link Candidate Account
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
