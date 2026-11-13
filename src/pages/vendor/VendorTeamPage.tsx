import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dialog, EmptyState, ErrorState, Input, PageHeader, Select, TableSkeleton } from '../../components/ui/kit';
import { useToast } from '../../components/ui/Toast';
import { supabase } from '../../lib/supabase';

interface Member {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: 'vendor_admin' | 'vendor_recruiter';
  status: 'active' | 'suspended' | string;
  created_at: string;
}

const ROLE_LABEL: Record<Member['role'], string> = {
  vendor_admin: 'Vendor Admin',
  vendor_recruiter: 'Vendor Recruiter',
};
const ROLE_DESCRIPTION: Record<Member['role'], string> = {
  vendor_admin: 'Full agency access: manage the team, candidates, submissions, offers, billing and compliance.',
  vendor_recruiter: 'Sources and submits candidates for your agency. Cannot manage the team or billing.',
};

async function call<T>(url: string, opts?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = data?.session?.access_token;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export const VendorTeamPage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', mobile: '', role: 'vendor_recruiter' as Member['role'] });

  const q = useQuery({
    queryKey: ['vendor_team'],
    queryFn: () => call<{ members: Member[]; currentUserId: string }>('/api/vendor/team'),
  });

  const invite = useMutation({
    mutationFn: () => call('/api/vendor/team', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: 'Invitation sent', description: `${form.email} will receive a link to set their password.`, tone: 'success' });
      setOpen(false);
      setForm({ name: '', email: '', mobile: '', role: 'vendor_recruiter' });
      qc.invalidateQueries({ queryKey: ['vendor_team'] });
    },
    onError: (e: Error) => toast({ title: 'Could not add user', description: e.message, tone: 'error' }),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      call(`/api/vendor/team/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.body) }),
    onSuccess: () => {
      toast({ title: 'Team updated', tone: 'success' });
      qc.invalidateQueries({ queryKey: ['vendor_team'] });
    },
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, tone: 'error' }),
  });

  if (q.isLoading) return <TableSkeleton rows={5} cols={5} />;
  if (q.error || !q.data) {
    return <ErrorState message={(q.error as Error)?.message || 'Could not load your team.'} onRetry={() => q.refetch()} />;
  }
  const { members, currentUserId } = q.data;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agency team"
        description="Add and manage the people in your agency. Users you add can only see your agency's data."
        actions={<Button onClick={() => setOpen(true)}>Add user</Button>}
      />

      {members.length === 0 ? (
        <EmptyState title="No team members yet" description="Add your first recruiter." />
      ) : (
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.id === currentUserId;
                return (
                  <tr key={m.id}>
                    <td className="font-medium text-[var(--text-primary)]">
                      {m.full_name || '—'} {isSelf && <span className="text-[12px] text-[var(--text-tertiary)]">(you)</span>}
                    </td>
                    <td className="text-[var(--text-secondary)]">{m.email || '—'}</td>
                    <td>
                      {isSelf ? (
                        <Badge tone="neutral">{ROLE_LABEL[m.role]}</Badge>
                      ) : (
                        <div className="w-44">
                          <Select
                            value={m.role}
                            onChange={(e) => update.mutate({ id: m.id, body: { role: e.target.value } })}
                            options={[
                              { value: 'vendor_recruiter', label: ROLE_LABEL.vendor_recruiter },
                              { value: 'vendor_admin', label: ROLE_LABEL.vendor_admin },
                            ]}
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge tone={m.status === 'active' ? 'emerald' : 'amber'}>
                        {m.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      {!isSelf && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update.mutate({ id: m.id, body: { status: m.status === 'active' ? 'suspended' : 'active' } })
                          }
                        >
                          {m.status === 'active' ? 'Suspend' : 'Reactivate'}
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

      <Dialog open={open} onClose={() => setOpen(false)} title="Add user to your agency" description="They get an email to set their password.">
        <div className="space-y-3">
          <Input label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Mobile (optional)" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Select
            label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Member['role'] })}
            options={[
              { value: 'vendor_recruiter', label: ROLE_LABEL.vendor_recruiter },
              { value: 'vendor_admin', label: ROLE_LABEL.vendor_admin },
            ]}
          />
          <p className="text-[12px] text-[var(--text-tertiary)]">{ROLE_DESCRIPTION[form.role]}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.name.trim() || !emailOk || invite.isPending} onClick={() => invite.mutate()}>
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
