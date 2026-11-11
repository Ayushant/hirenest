import { supabase } from '../lib/supabase';
import type { PermissionSet, StaffRole } from '../lib/staffRbac';

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = data?.session?.access_token;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  status: string;
  employeeId: string | null;
  departmentId: string | null;
  designation: string | null;
  role: StaffRole;
  reportingManagerId: string | null;
  team: string | null;
  joiningDate: string | null;
  hasOverrides: boolean;
  invitedAt: string | null;
  activatedAt: string | null;
}
export interface Department {
  id: string;
  name: string;
}
export interface MyAccess {
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  department: string | null;
  designation: string | null;
  employeeId: string | null;
  team: string | null;
  joiningDate: string | null;
  reportingManager: { name: string; email: string } | null;
  permissions: PermissionSet;
  restrictedFields: string[];
}
export interface AccessAuditEvent {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  target_user_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: string;
}
export interface RoleTemplate {
  role: StaffRole;
  permissions: PermissionSet;
  restrictedFields: string[];
  customised: boolean;
}

export const staffApi = {
  me: () => api<{ me: MyAccess }>('/api/staff/me').then((r) => r.me),
  users: () => api<{ users: StaffUser[] }>('/api/staff/users').then((r) => r.users),
  createUser: (body: Record<string, unknown>) =>
    api<{ userId: string }>('/api/staff/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: Record<string, unknown>) =>
    api<{ changed: string[] }>(`/api/staff/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suspend: (id: string, reason?: string) =>
    api(`/api/staff/users/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reactivate: (id: string) => api(`/api/staff/users/${id}/reactivate`, { method: 'POST', body: '{}' }),
  departments: () => api<{ departments: Department[] }>('/api/staff/departments').then((r) => r.departments),
  addDepartment: (name: string) =>
    api('/api/staff/departments', { method: 'POST', body: JSON.stringify({ name }) }),
  templates: () => api<{ templates: RoleTemplate[] }>('/api/staff/templates').then((r) => r.templates),
  saveTemplate: (role: StaffRole, permissions: PermissionSet) =>
    api(`/api/staff/templates/${role}`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
  audit: () => api<{ events: AccessAuditEvent[] }>('/api/staff/audit').then((r) => r.events),
};
