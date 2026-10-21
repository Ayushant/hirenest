import { supabase } from '../lib/supabase';
import type {
  EmploymentType,
  MarginType,
  Requirement,
  RequirementFinancials,
  RequirementMargins,
  RequirementStatus,
  RequirementVendorShare,
  WorkMode,
} from '../types/db';

const DEFAULT_PAGE_SIZE = 25;

export async function fetchRequirements(params: {
  page?: number;
  pageSize?: number;
  clientOrgId?: string;
  status?: RequirementStatus | '';
  isPublic?: boolean;
  search?: string;
}): Promise<{ data: Requirement[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.clientOrgId) query = query.eq('client_org_id', params.clientOrgId);
  if (params.status) query = query.eq('status', params.status);
  if (params.isPublic !== undefined) query = query.eq('is_public', params.isPublic);
  if (params.search?.trim()) {
    query = query.ilike('title', `%${params.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Requirement[], count: count || 0 };
}

export async function fetchRequirementById(id: string): Promise<Requirement | null> {
  const { data, error } = await supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Requirement | null;
}

// Section 5.3: Allowed direct write columns for requirements
export interface CreateRequirementInput {
  client_org_id: string;
  title: string;
  description: string;
  skills: string[];
  min_experience: number;
  max_experience: number;
  location: string;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  openings: number;
  vendor_visible_budget: number | null;
  currency: string;
  submission_sla_hours: number;
}

export type UpdateRequirementInput = Omit<CreateRequirementInput, 'client_org_id'>;

export async function createRequirement(input: CreateRequirementInput): Promise<Requirement> {
  const { data, error } = await supabase
    .from('requirements')
    .insert({
      client_org_id: input.client_org_id,
      title: input.title,
      description: input.description,
      skills: input.skills,
      min_experience: input.min_experience,
      max_experience: input.max_experience,
      location: input.location,
      work_mode: input.work_mode,
      employment_type: input.employment_type,
      openings: input.openings,
      vendor_visible_budget: input.vendor_visible_budget,
      currency: input.currency,
      submission_sla_hours: input.submission_sla_hours,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Requirement;
}

export async function updateRequirement(
  id: string,
  input: UpdateRequirementInput
): Promise<Requirement> {
  const { data, error } = await supabase
    .from('requirements')
    .update({
      title: input.title,
      description: input.description,
      skills: input.skills,
      min_experience: input.min_experience,
      max_experience: input.max_experience,
      location: input.location,
      work_mode: input.work_mode,
      employment_type: input.employment_type,
      openings: input.openings,
      vendor_visible_budget: input.vendor_visible_budget,
      currency: input.currency,
      submission_sla_hours: input.submission_sla_hours,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Requirement;
}

export async function fetchRequirementFinancials(
  requirementId: string
): Promise<RequirementFinancials | null> {
  const { data, error } = await supabase
    .from('requirement_financials')
    .select('*')
    .eq('requirement_id', requirementId)
    .maybeSingle();
  if (error) return null; // Vendors cannot read requirement_financials per RLS
  return data as RequirementFinancials | null;
}

export async function upsertRequirementFinancials(payload: {
  requirement_id: string;
  actual_client_budget: number | null;
  notes: string | null;
}): Promise<void> {
  const { error } = await supabase.from('requirement_financials').upsert({
    requirement_id: payload.requirement_id,
    actual_client_budget: payload.actual_client_budget,
    notes: payload.notes,
  });
  if (error) throw error;
}

export async function fetchRequirementMargins(
  requirementId: string
): Promise<RequirementMargins | null> {
  const { data, error } = await supabase
    .from('requirement_margins')
    .select('*')
    .eq('requirement_id', requirementId)
    .maybeSingle();
  if (error) return null; // Admin only
  return data as RequirementMargins | null;
}

export async function upsertRequirementMargins(payload: {
  requirement_id: string;
  platform_margin: number | null;
  margin_type: MarginType;
}): Promise<void> {
  const { error } = await supabase.from('requirement_margins').upsert({
    requirement_id: payload.requirement_id,
    platform_margin: payload.platform_margin,
    margin_type: payload.margin_type,
  });
  if (error) throw error;
}

export async function fetchRequirementVendorShares(
  requirementId?: string,
  vendorOrgId?: string
): Promise<RequirementVendorShare[]> {
  let query = supabase
    .from('requirement_vendor_shares')
    .select('*, organizations:vendor_org_id(id, name, sla_tier), requirements:requirement_id(*)')
    .order('shared_at', { ascending: false });

  if (requirementId) query = query.eq('requirement_id', requirementId);
  if (vendorOrgId) query = query.eq('vendor_org_id', vendorOrgId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as RequirementVendorShare[];
}

// Section 5.4 RPCs for Requirements
export async function setRequirementStatus(params: {
  p_requirement_id: string;
  p_status: RequirementStatus;
  p_reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('set_requirement_status', params);
  if (error) throw error;
}

export async function setRequirementPublic(params: {
  p_requirement_id: string;
  p_is_public: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('set_requirement_public', params);
  if (error) throw error;
}

export async function shareRequirementWithVendors(params: {
  p_requirement_id: string;
  p_vendor_org_ids: string[];
  p_sla_hours?: number;
}): Promise<number> {
  const { data, error } = await supabase.rpc('share_requirement_with_vendors', params);
  if (error) throw error;
  return Number(data || 0);
}

export async function revokeRequirementShare(params: {
  p_requirement_id: string;
  p_vendor_org_id: string;
}): Promise<void> {
  const { error } = await supabase.rpc('revoke_requirement_share', params);
  if (error) throw error;
}

export async function acknowledgeRequirement(params: {
  p_requirement_id: string;
}): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_requirement', params);
  if (error) throw error;
}
