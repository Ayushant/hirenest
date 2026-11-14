import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  ChevronDown,
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  User,
  Building2,
  Globe,
  Calendar,
} from 'lucide-react';
import {
  fetchEarlyAccessApplications,
  updateEarlyAccessApplication,
  sendEarlyAccessInvitation,
  MODULE_LABELS,
  BUSINESS_TYPE_LABELS,
  COMPANY_SIZE_LABELS,
  type EarlyAccessApplication,
  type EarlyAccessStatus,
} from '../../api/earlyAccess';

const STATUS_CONFIG: Record<
  EarlyAccessStatus,
  { label: string; color: string; bg: string; icon: React.FC<{ className?: string }> }
> = {
  submitted: { label: 'Submitted', color: 'text-[#1A56C2]', bg: 'bg-[#EEF4FF]', icon: Clock },
  under_review: { label: 'Under review', color: 'text-[#D97706]', bg: 'bg-[#FFFBEB]', icon: AlertCircle },
  approved: { label: 'Approved', color: 'text-[#059669]', bg: 'bg-[#ECFDF5]', icon: CheckCircle2 },
  waitlisted: { label: 'Waitlisted', color: 'text-[#716E64]', bg: 'bg-[#F8F4F0]', icon: Clock },
  rejected: { label: 'Rejected', color: 'text-[#DC2626]', bg: 'bg-[#FEF2F2]', icon: XCircle },
};

const STATUS_OPTIONS: EarlyAccessStatus[] = [
  'submitted',
  'under_review',
  'approved',
  'waitlisted',
  'rejected',
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ApplicationDetail({
  app,
  onUpdate,
  onClose,
}: {
  app: EarlyAccessApplication;
  onUpdate: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<EarlyAccessStatus>(app.status);
  const [assignedTo, setAssignedTo] = useState(app.assignedTo || '');
  const [adminNotes, setAdminNotes] = useState(app.adminNotes || '');
  const [followUpDate, setFollowUpDate] = useState(app.followUpDate || '');
  const [saving, setSaving] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEarlyAccessApplication({
        id: app.applicationId,
        status,
        assignedTo: assignedTo || null,
        adminNotes,
        followUpDate: followUpDate || null,
      });
      onUpdate();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    setSendingInvite(true);
    try {
      await sendEarlyAccessInvitation(app.applicationId);
      onUpdate();
    } catch {
      // ignore
    } finally {
      setSendingInvite(false);
    }
  };

  const inputCls =
    'w-full h-9 px-3 rounded-[6px] border border-[#E3DDD3] bg-white text-[#14213D] text-[13px] placeholder:text-[#A39F92] focus:outline-none focus:border-[#1A56C2] focus:ring-[3px] focus:ring-[#1A56C2]/10';
  const labelCls = 'block text-[12px] font-medium text-[#605D52] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8 bg-black/30 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[12px] border border-[#E3DDD3] shadow-xl w-full max-w-[640px] mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0EBE4]">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-[#A39F92]">{app.applicationId}</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium ${STATUS_CONFIG[app.status].bg} ${STATUS_CONFIG[app.status].color}`}
              >
                {STATUS_CONFIG[app.status].label}
              </span>
            </div>
            <h3 className="text-[16px] font-semibold text-[#14213D] mt-1">{app.contactName}</h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-[6px] hover:bg-[#F0EBE4] flex items-center justify-center text-[#A39F92]"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Contact info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-[13px]">
              <User className="h-3.5 w-3.5 text-[#A39F92]" />
              <span className="text-[#858175]">{app.designation || 'No designation'}</span>
            </div>
            <div className="flex items-center gap-2 text-[13px]">
              <Mail className="h-3.5 w-3.5 text-[#A39F92]" />
              <a href={`mailto:${app.businessEmail}`} className="text-[#1A56C2] hover:underline">
                {app.businessEmail}
              </a>
            </div>
            <div className="flex items-center gap-2 text-[13px]">
              <Building2 className="h-3.5 w-3.5 text-[#A39F92]" />
              <span className="text-[#14213D] font-medium">{app.companyName}</span>
            </div>
            {app.companyWebsite && (
              <div className="flex items-center gap-2 text-[13px]">
                <Globe className="h-3.5 w-3.5 text-[#A39F92]" />
                <a
                  href={app.companyWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#1A56C2] hover:underline inline-flex items-center gap-1"
                >
                  Website <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Company details */}
          <div className="rounded-[8px] bg-[#F8F4F0] border border-[#F0EBE4] p-4 space-y-2">
            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div>
                <span className="text-[#A39F92]">Type</span>
                <div className="text-[#14213D] font-medium mt-0.5">
                  {BUSINESS_TYPE_LABELS[app.businessType]}
                </div>
              </div>
              <div>
                <span className="text-[#A39F92]">Size</span>
                <div className="text-[#14213D] font-medium mt-0.5">
                  {COMPANY_SIZE_LABELS[app.companySize]}
                </div>
              </div>
              <div>
                <span className="text-[#A39F92]">Country</span>
                <div className="text-[#14213D] font-medium mt-0.5">{app.country}</div>
              </div>
            </div>
            {app.recruitmentTeamSize && (
              <div className="text-[12px]">
                <span className="text-[#A39F92]">Recruitment team: </span>
                <span className="text-[#14213D]">{app.recruitmentTeamSize}</span>
              </div>
            )}
          </div>

          {/* Modules */}
          {app.interestedModules.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-[#605D52] mb-1.5">Interested modules</div>
              <div className="flex flex-wrap gap-1.5">
                {app.interestedModules.map((m) => (
                  <span
                    key={m}
                    className="px-2 py-0.5 rounded-[4px] bg-[#EEF4FF] text-[12px] font-medium text-[#1A56C2]"
                  >
                    {MODULE_LABELS[m]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Requirements & challenges */}
          {app.businessRequirements && (
            <div>
              <div className="text-[12px] font-medium text-[#605D52] mb-1">Business requirements</div>
              <p className="text-[13px] text-[#14213D] leading-relaxed">{app.businessRequirements}</p>
            </div>
          )}
          {app.currentChallenges && (
            <div>
              <div className="text-[12px] font-medium text-[#605D52] mb-1">Current challenges</div>
              <p className="text-[13px] text-[#14213D] leading-relaxed">{app.currentChallenges}</p>
            </div>
          )}
          {app.comments && (
            <div>
              <div className="text-[12px] font-medium text-[#605D52] mb-1">Additional comments</div>
              <p className="text-[13px] text-[#14213D] leading-relaxed">{app.comments}</p>
            </div>
          )}

          {/* LinkedIn */}
          {app.linkedinUrl && (
            <a
              href={app.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-[#1A56C2] hover:underline"
            >
              LinkedIn profile <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <div className="border-t border-[#F0EBE4] pt-4" />

          {/* Admin controls */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as EarlyAccessStatus)}
                className={inputCls}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Assigned to</label>
              <input
                type="text"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Team member name"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Follow-up date</label>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Admin notes</label>
            <textarea
              rows={3}
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Internal notes about this application..."
              className={`${inputCls} h-auto py-2`}
            />
          </div>

          {/* Timestamps */}
          <div className="flex flex-wrap gap-4 text-[12px] text-[#A39F92]">
            <span>Submitted: {formatDateTime(app.submittedAt)}</span>
            {app.invitationSentAt && <span>Invited: {formatDateTime(app.invitationSentAt)}</span>}
            {app.registeredAt && <span>Registered: {formatDateTime(app.registeredAt)}</span>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#F0EBE4]">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-[6px] border border-[#E3DDD3] text-[13px] font-medium text-[#858175] hover:bg-[#F8F4F0]"
          >
            Close
          </button>
          <div className="flex items-center gap-2">
            {status === 'approved' && !app.invitationSentAt && (
              <button
                onClick={handleInvite}
                disabled={sendingInvite}
                className="h-8 px-3 rounded-[6px] bg-[#059669] text-white text-[13px] font-medium hover:bg-[#047857] disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {sendingInvite ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                Send invitation
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-8 px-3 rounded-[6px] bg-[#1A56C2] text-white text-[13px] font-medium hover:bg-[#123E8F] disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const EarlyAccessDashboardPage: React.FC = () => {
  const [apps, setApps] = useState<EarlyAccessApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<EarlyAccessStatus | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<EarlyAccessApplication | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEarlyAccessApplications(
        filterStatus ? { status: filterStatus } : undefined
      );
      setApps(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = apps.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.contactName.toLowerCase().includes(q) ||
      a.companyName.toLowerCase().includes(q) ||
      a.businessEmail.toLowerCase().includes(q) ||
      a.applicationId.toLowerCase().includes(q)
    );
  });

  const counts = apps.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-[#14213D]">Early access applications</h1>
          <p className="text-[13px] text-[#858175] mt-0.5">
            Review and manage early access requests for HireNestOS
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] font-medium">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                filterStatus === s
                  ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color} border-current`
                  : 'border-[#E3DDD3] text-[#858175] hover:border-[#A39F92]'
              }`}
            >
              {STATUS_CONFIG[s].label}
              {counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A39F92]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, company, email or application ID..."
          className="w-full h-9 pl-9 pr-3 rounded-[6px] border border-[#E3DDD3] bg-white text-[#14213D] text-[13px] placeholder:text-[#A39F92] focus:outline-none focus:border-[#1A56C2] focus:ring-[3px] focus:ring-[#1A56C2]/10"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#A39F92]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading applications...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[#A39F92] text-[13px]">
          {apps.length === 0
            ? 'No early access applications yet.'
            : 'No applications match your filters.'}
        </div>
      ) : (
        <div className="rounded-[8px] border border-[#E3DDD3] bg-white overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#F0EBE4] bg-[#F8F4F0]">
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Application
                </th>
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Company
                </th>
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Type
                </th>
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Status
                </th>
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Submitted
                </th>
                <th className="text-left font-medium text-[#858175] px-4 py-2.5 text-[12px]">
                  Assigned
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const sc = STATUS_CONFIG[a.status];
                return (
                  <tr
                    key={a.applicationId}
                    onClick={() => setSelected(a)}
                    className="border-b border-[#F0EBE4] last:border-0 hover:bg-[#F8F4F0] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#14213D]">{a.contactName}</div>
                      <div className="text-[12px] text-[#A39F92] font-mono">{a.applicationId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[#14213D]">{a.companyName}</div>
                      <div className="text-[12px] text-[#A39F92]">{a.businessEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-[#858175]">
                      {BUSINESS_TYPE_LABELS[a.businessType]}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium ${sc.bg} ${sc.color}`}
                      >
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#858175]">{formatDate(a.submittedAt)}</td>
                    <td className="px-4 py-3 text-[#858175]">{a.assignedTo || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <ApplicationDetail
          app={selected}
          onUpdate={() => {
            setSelected(null);
            load();
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};
