import { supabase } from '../lib/supabase';
import type {
  AdminDashboardSummary,
  AppRole,
  AuditLog,
  DuplicateFlag,
  Organization,
  OrgStatus,
  OrgType,
  PlatformSettings,
  Profile,
  SlaTier,
  UserStatus,
} from '../types/db';

export const DEFAULT_PAGE_SIZE = 25;

export async function fetchAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const { data, error } = await supabase.rpc('admin_dashboard_summary');
  if (error) throw error;
  return (data || {}) as AdminDashboardSummary;
}

export async function adminAssignUser(params: {
  p_user_id: string;
  p_role: AppRole;
  p_org_id?: string | null;
  p_status?: UserStatus;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_user', params);
  if (error) throw error;
}

export async function adminLinkCandidateAccount(params: {
  p_candidate_id: string;
  p_user_id: string;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_link_candidate_account', params);
  if (error) throw error;
}

export async function fetchProfiles(params: {
  page?: number;
  pageSize?: number;
  role?: AppRole | '';
  status?: UserStatus | '';
  orgId?: string | '';
  search?: string;
}): Promise<{ data: Profile[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.role) query = query.eq('role', params.role);
  if (params.status) query = query.eq('status', params.status);
  if (params.orgId) query = query.eq('org_id', params.orgId);
  if (params.search?.trim()) {
    query = query.ilike('full_name', `%${params.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Profile[], count: count || 0 };
}

export async function updateOwnProfile(
  userId: string,
  payload: { full_name: string; phone: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: payload.full_name,
      phone: payload.phone,
    })
    .eq('id', userId);
  if (error) throw error;
}

export async function fetchOrganizations(params: {
  page?: number;
  pageSize?: number;
  type?: OrgType | '';
  status?: OrgStatus | '';
  search?: string;
}): Promise<{ data: Organization[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('organizations')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.type) query = query.eq('type', params.type);
  if (params.status) query = query.eq('status', params.status);
  if (params.search?.trim()) {
    query = query.ilike('name', `%${params.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Organization[], count: count || 0 };
}

export async function fetchOrganizationById(id: string): Promise<Organization | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Organization | null;
}

export interface UpsertOrganizationPayload {
  name: string;
  type: OrgType;
  status: OrgStatus;
  industry?: string | null;
  domain?: string | null;
  gst_number?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  sla_tier: SlaTier;
}

export async function createOrganization(
  payload: UpsertOrganizationPayload
): Promise<Organization> {
  const { data, error } = await supabase
    .from('organizations')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function updateOrganization(
  id: string,
  payload: Partial<UpsertOrganizationPayload>
): Promise<Organization> {
  const { data, error } = await supabase
    .from('organizations')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function fetchDuplicateFlags(params: {
  page?: number;
  pageSize?: number;
  status?: 'open' | 'resolved' | '';
}): Promise<{ data: DuplicateFlag[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('duplicate_flags')
    .select(
      '*, candidates:existing_candidate_id(id, full_name, original_source, owner_vendor_org_id), organizations:attempted_org_id(id, name), requirements:requirement_id(id, title)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.status) query = query.eq('status', params.status);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as DuplicateFlag[], count: count || 0 };
}

export async function resolveDuplicateFlag(params: {
  p_flag_id: string;
  p_note: string;
  p_new_owner_vendor_org_id?: string | null;
}): Promise<void> {
  const rpcArgs: Record<string, unknown> = {
    p_flag_id: params.p_flag_id,
    p_note: params.p_note,
  };
  if (params.p_new_owner_vendor_org_id !== undefined) {
    rpcArgs.p_new_owner_vendor_org_id = params.p_new_owner_vendor_org_id;
  }
  const { error } = await supabase.rpc('resolve_duplicate_flag', rpcArgs);
  if (error) throw error;
}

export async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data as PlatformSettings | null;
}

export async function updatePlatformSettings(
  payload: Partial<
    Pick<
      PlatformSettings,
      | 'timing_weight'
      | 'quality_weight'
      | 'compliance_weight'
      | 'weights_approved'
      | 'min_sample_size'
      | 'default_submission_sla_hours'
      | 'share_vendor_summary_with_clients'
      | 'ai_screening_enabled'
    >
  >
): Promise<PlatformSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .update(payload)
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw error;
  return data as PlatformSettings;
}

export async function fetchAuditLogs(params: {
  page?: number;
  pageSize?: number;
  tableName?: string;
  action?: string;
  actorId?: string;
  recordId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: AuditLog[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.tableName) query = query.eq('table_name', params.tableName);
  if (params.action) query = query.eq('action', params.action);
  if (params.actorId) query = query.eq('actor_id', params.actorId);
  if (params.recordId) query = query.eq('record_id', params.recordId);
  if (params.fromDate) query = query.gte('created_at', params.fromDate);
  if (params.toDate) query = query.lte('created_at', params.toDate);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as AuditLog[], count: count || 0 };
}
