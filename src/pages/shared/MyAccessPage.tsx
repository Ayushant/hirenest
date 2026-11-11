import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, ErrorState, PageHeader, TableSkeleton } from '../../components/ui/kit';
import { staffApi } from '../../api/staff';
import {
  MODULE_LABEL,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  STAFF_ROLE_LABEL,
} from '../../lib/staffRbac';

const ACTION_GROUPS: Array<{ label: string; action: (typeof PERMISSION_ACTIONS)[number] }> = [
  { label: 'View', action: 'view' },
  { label: 'Create', action: 'create' },
  { label: 'Edit', action: 'edit' },
  { label: 'Approve', action: 'approve' },
  { label: 'Export', action: 'export' },
  { label: 'Assign', action: 'assign' },
];

/** Read-only: a user can never change their own access from here. */
export const MyAccessPage: React.FC = () => {
  const q = useQuery({ queryKey: ['my_access'], queryFn: staffApi.me });
  if (q.isLoading) return <TableSkeleton rows={6} cols={3} />;
  if (q.error || !q.data) {
    return <ErrorState message={`Could not load your access: ${(q.error as Error)?.message ?? ""}`} />;
  }
  const me = q.data;
  const granted = PERMISSION_MODULES.filter((m) => me.permissions[m]?.actions.length);
  const info: Array<[string, string]> = [
    ['Role', STAFF_ROLE_LABEL[me.role]],
    ['Department', me.department || '—'],
    ['Designation', me.designation || '—'],
    ['Reporting manager', me.reportingManager?.name || '—'],
    ['Employee ID', me.employeeId || '—'],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="My Access" description="What you can see and do in HireNestOS. Contact a Platform Admin to request changes." />
      <dl className="grid gap-3 sm:grid-cols-3">
        {info.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[12px] text-[var(--text-tertiary)]">{k}</dt>
            <dd className="text-[14px] text-[var(--text-primary)]">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto border-y border-[var(--border)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[var(--text-tertiary)]">
              <th className="py-2 pr-4 font-medium">Module</th>
              <th className="py-2 pr-4 font-medium">Record scope</th>
              {ACTION_GROUPS.map((a) => <th key={a.action} className="py-2 px-2 font-medium">{a.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {granted.map((mod) => {
              const grant = me.permissions[mod]!;
              return (
                <tr key={mod}>
                  <td className="py-2 pr-4">{MODULE_LABEL[mod]}</td>
                  <td className="py-2 pr-4"><Badge tone="neutral">{grant.scope}</Badge></td>
                  {ACTION_GROUPS.map((a) => (
                    <td key={a.action} className="py-2 px-2 text-center">{grant.actions.includes(a.action) ? '✓' : '—'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-[14px] font-medium mb-2">Restrictions</h2>
        {me.restrictedFields.length === 0 && PERMISSION_MODULES.every((m) => me.permissions[m]) ? (
          <p className="text-[13px] text-[var(--text-secondary)]">None.</p>
        ) : (
          <ul className="text-[13px] text-[var(--text-secondary)] space-y-1">
            {PERMISSION_MODULES.filter((m) => !me.permissions[m]?.actions.length).map((m) => (
              <li key={m}>No access to {MODULE_LABEL[m]}</li>
            ))}
            {me.restrictedFields.length > 0 && (
              <li>Hidden sensitive fields: {me.restrictedFields.map((f) => f.replace(/_/g, ' ')).join(', ')}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};
