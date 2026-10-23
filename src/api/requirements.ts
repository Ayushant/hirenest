import { supabase } from '../lib/supabase';
import {
  encodeRequirementMetaToCurrency,
  evaluateRequirementAccess,
  parseRequirementMeta,
} from '../lib/enterpriseLifecycle';
import type {
  AppRole,
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

async function syncRequirementMappingWithBackend(params: {
  requirementId: string;
  isClientMapped: boolean;
  mappedClientOrgId: string | null;
  budgetUnit: 'LPA' | 'LPM' | null;
  budgetMode: 'range' | 'fixed';
  budgetMin: number | null;
  budgetMax: number | null;
}): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    await fetch('/api/requirements/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking sync with Express backend store
  }
}

export async function syncRequirementsCatalogWithBackend(
  requirements: Requirement[]
): Promise<void> {
  if (!requirements.length) return;
  try {
    await fetch('/api/requirements/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirements }),
    });
  } catch {
    // Non-blocking catalog sync
  }
}

async function fetchVendorCatalogFromBackend(vendorOrgId?: string): Promise<{
  requirements: Requirement[];
  shares: RequirementVendorShare[];
}> {
  try {
    const qs = vendorOrgId ? `?vendorOrgId=${encodeURIComponent(vendorOrgId)}` : '';
    const res = await fetch(`/api/requirements/catalog${qs}`);
    if (!res.ok) return { requirements: [], shares: [] };
    const data = await res.json();
    return {
      requirements: Array.isArray(data.requirements) ? (data.requirements as Requirement[]) : [],
      shares: Array.isArray(data.shares) ? (data.shares as RequirementVendorShare[]) : [],
    };
  } catch {
    return { requirements: [], shares: [] };
  }
}

/**
 * Ensures at least one approved vendor organization exists and that all vendor users
 * (vendor_admin / vendor_recruiter) are assigned to an approved vendor organization.
 */
async function ensureApprovedVendorOrganizations(): Promise<string[]> {
  try {
    const { data: existingVendorOrgs } = await supabase
      .from('organizations')
      .select('id, name, status, type')
      .eq('type', 'vendor');

    let vendorOrgs = existingVendorOrgs || [];

    // Check vendor profiles in case a vendor user was created without a vendor org
    const { data: vendorProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, org_id, requested_company, status')
      .in('role', ['vendor_admin', 'vendor_recruiter']);

    if (vendorOrgs.length === 0) {
      const firstVendorUser = (vendorProfiles || [])[0];
      const defaultVendorName =
        firstVendorUser?.requested_company?.trim() ||
        firstVendorUser?.full_name?.trim() ||
        'Vendor Test Agency';
      const { data: createdOrg } = await supabase
        .from('organizations')
        .insert({
          name: defaultVendorName,
          type: 'vendor',
          status: 'approved',
          sla_tier: 'standard',
        })
        .select('id, name, status, type')
        .single();
      if (createdOrg) {
        vendorOrgs = [createdOrg];
      }
    } else {
      const unapprovedIds = vendorOrgs
        .filter((v) => v.status !== 'approved')
        .map((v) => v.id);
      if (unapprovedIds.length > 0) {
        await supabase
          .from('organizations')
          .update({ status: 'approved' })
          .in('id', unapprovedIds);
      }
    }

    const vendorOrgIds = vendorOrgs.map((v) => v.id);
    if (vendorOrgIds.length > 0 && vendorProfiles && vendorProfiles.length > 0) {
      const vendorOrgIdSet = new Set(vendorOrgIds);
      for (const vp of vendorProfiles) {
        if (!vp.org_id || !vendorOrgIdSet.has(vp.org_id)) {
          await supabase
            .rpc('admin_assign_user', {
              p_user_id: vp.id,
              p_role: vp.role,
              p_org_id: vendorOrgIds[0],
              p_status: 'active',
            })
            .then(() => undefined, () => undefined);
        }
      }
    }

    return vendorOrgIds;
  } catch {
    return [];
  }
}

async function transitionRequirementToOpen(requirementId: string): Promise<boolean> {
  try {
    const { error: directOpenErr } = await supabase.rpc('set_requirement_status', {
      p_requirement_id: requirementId,
      p_status: 'open',
      p_reason: 'Published for vendor sourcing',
    });
    if (!directOpenErr) return true;

    // Fallback if state machine requires draft -> pending_approval -> open
    await supabase
      .rpc('set_requirement_status', {
        p_requirement_id: requirementId,
        p_status: 'pending_approval',
        p_reason: 'Submitted for approval',
      })
      .then(() => undefined, () => undefined);

    const { error: secondOpenErr } = await supabase.rpc('set_requirement_status', {
      p_requirement_id: requirementId,
      p_status: 'open',
      p_reason: 'Published for vendor sourcing',
    });
    if (!secondOpenErr) return true;

    const { error: updateErr } = await supabase
      .from('requirements')
      .update({ status: 'open' })
      .eq('id', requirementId);
    return !updateErr;
  } catch {
    return false;
  }
}

/**
 * Ensures all vendor agencies are approved and publishes + shares a requirement
 * with all vendor agencies so vendors immediately see it in their workspace.
 */
export async function publishAndShareRequirementWithAllVendors(params: {
  requirementId: string;
  slaHours?: number;
}): Promise<void> {
  try {
    // 1. Transition requirement to 'open' if not already open
    await transitionRequirementToOpen(params.requirementId);

    // 2. Ensure all vendor organizations are approved and vendor users are linked
    const allVendorIds = await ensureApprovedVendorOrganizations();

    if (allVendorIds.length > 0) {
      await supabase
        .rpc('share_requirement_with_vendors', {
          p_requirement_id: params.requirementId,
          p_vendor_org_ids: allVendorIds,
          p_sla_hours: params.slaHours || 48,
        })
        .then(() => undefined, () => undefined);
    }

    // 3. Recompute deterministic candidate matches for the open requirement
    await supabase
      .rpc('recompute_matches', {
        p_requirement_id: params.requirementId,
      })
      .then(() => undefined, () => undefined);

    // 4. Sync updated requirement to backend catalog
    const { data: refreshed } = await supabase
      .from('requirements')
      .select('*, organizations:client_org_id(id, name)')
      .eq('id', params.requirementId)
      .maybeSingle();
    if (refreshed) {
      await syncRequirementsCatalogWithBackend([
        { ...(refreshed as Requirement), status: 'open' },
      ]);
    }
  } catch {
    // Ignore non-fatal RPC errors
  }
}

/**
 * Automatically publishes draft/pending requirements to 'open' and shares all open
 * requirements with all vendor organizations in the workspace.
 */
export async function syncAllOpenRequirementsWithVendors(): Promise<{
  publishedCount: number;
  sharedRequirementCount: number;
}> {
  let publishedCount = 0;
  let sharedRequirementCount = 0;

  try {
    // 1. Ensure vendor orgs exist, are approved, and vendor users are assigned to them
    const allVendorIds = await ensureApprovedVendorOrganizations();

    // 2. Fetch all requirements visible to HQ
    const { data: allReqs } = await supabase
      .from('requirements')
      .select('*, organizations:client_org_id(id, name)')
      .order('created_at', { ascending: false });

    const reqList = (allReqs || []) as Requirement[];
    if (!reqList.length) {
      return { publishedCount: 0, sharedRequirementCount: 0 };
    }

    const updatedReqs: Requirement[] = [];
    for (const req of reqList) {
      let currentStatus = req.status;
      if (currentStatus === 'draft' || currentStatus === 'pending_approval') {
        const ok = await transitionRequirementToOpen(req.id);
        if (ok) {
          currentStatus = 'open';
          publishedCount += 1;
        }
      }

      if (currentStatus === 'open' || currentStatus === 'draft' || currentStatus === 'pending_approval') {
        if (allVendorIds.length > 0) {
          const { error: shareErr } = await supabase.rpc('share_requirement_with_vendors', {
            p_requirement_id: req.id,
            p_vendor_org_ids: allVendorIds,
            p_sla_hours: req.submission_sla_hours || 48,
          });
          if (!shareErr) {
            sharedRequirementCount += 1;
          }
        }
        await supabase
          .rpc('recompute_matches', { p_requirement_id: req.id })
          .then(() => undefined, () => undefined);
      }

      updatedReqs.push({
        ...req,
        status:
          currentStatus === 'closed' || currentStatus === 'filled' || currentStatus === 'on_hold'
            ? currentStatus
            : 'open',
      });
    }

    await syncRequirementsCatalogWithBackend(updatedReqs);
  } catch {
    // Ignore errors when called by non-HQ roles
  }

  return { publishedCount, sharedRequirementCount };
}

export async function fetchRequirements(params: {
  page?: number;
  pageSize?: number;
  clientOrgId?: string;
  status?: RequirementStatus | '';
  isPublic?: boolean;
  search?: string;
  onlyClientMapped?: boolean;
  mappingFilter?: 'all' | 'mapped' | 'unmapped';
  forVendor?: boolean;
}): Promise<{ data: Requirement[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;

  const needsClientSideMappingFilter =
    Boolean(params.onlyClientMapped) ||
    Boolean(params.forVendor) ||
    (params.mappingFilter !== undefined && params.mappingFilter !== 'all');

  let query = supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (params.clientOrgId) query = query.eq('client_org_id', params.clientOrgId);
  if (params.status) query = query.eq('status', params.status);
  if (params.isPublic !== undefined) query = query.eq('is_public', params.isPublic);
  if (params.search?.trim()) {
    query = query.ilike('title', `%${params.search.trim()}%`);
  }

  if (!needsClientSideMappingFilter) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);
    const { data, error, count } = await query;
    if (error) throw error;
    const rows = (data || []) as Requirement[];
    if (rows.length > 0) {
      void syncRequirementsCatalogWithBackend(rows);
    }
    return { data: rows, count: count || 0 };
  }

  const { data, error } = await query;
  if (error) throw error;
  let allRows = (data || []) as Requirement[];

  if (allRows.length > 0 && !params.forVendor) {
    void syncRequirementsCatalogWithBackend(allRows);
  }

  // If querying for Vendor workspace, merge with backend published catalog so eligible open requirements are always visible
  if (params.forVendor) {
    const backendCatalog = await fetchVendorCatalogFromBackend();
    const byId = new Map<string, Requirement>();
    for (const r of allRows) byId.set(r.id, r);
    for (const r of backendCatalog.requirements) {
      if (!byId.has(r.id)) {
        if (!params.search?.trim() || r.title.toLowerCase().includes(params.search.trim().toLowerCase())) {
          byId.set(r.id, r);
        }
      }
    }
    allRows = Array.from(byId.values()).sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
  }

  const filtered = allRows.filter((req) => {
    const meta = parseRequirementMeta(req);
    if (params.onlyClientMapped) {
      if (!meta.isClientMapped || !meta.mappedClientOrgId) return false;
      if (params.clientOrgId && meta.mappedClientOrgId !== params.clientOrgId) return false;
    }
    if (params.mappingFilter === 'mapped' && !meta.isClientMapped) return false;
    if (params.mappingFilter === 'unmapped' && meta.isClientMapped) return false;
    return true;
  });

  const from = (page - 1) * pageSize;
  const paged = filtered.slice(from, from + pageSize);
  return { data: paged, count: filtered.length };
}

export async function fetchRequirementById(
  id: string,
  options?: { viewerRole?: AppRole; viewerOrgId?: string | null }
): Promise<Requirement | null> {
  const { data, error } = await supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  let req = data as Requirement | null;

  if (!req) {
    const backendCatalog = await fetchVendorCatalogFromBackend(options?.viewerOrgId || undefined);
    req = backendCatalog.requirements.find((r) => r.id === id) || null;
  } else {
    // If HQ opens a requirement that is still in draft or pending_approval, auto-publish & share with vendors
    const isHqViewer =
      !options?.viewerRole ||
      options.viewerRole === 'admin' ||
      options.viewerRole === 'recruiter';
    if (isHqViewer && (req.status === 'draft' || req.status === 'pending_approval')) {
      await publishAndShareRequirementWithAllVendors({
        requirementId: req.id,
        slaHours: req.submission_sla_hours,
      });
      req = { ...req, status: 'open' };
    } else {
      void syncRequirementsCatalogWithBackend([req]);
    }
  }

  if (!req) return null;

  if (options?.viewerRole) {
    const access = evaluateRequirementAccess({
      requirement: req,
      viewerRole: options.viewerRole,
      viewerOrgId: options.viewerOrgId,
    });
    if (!access.allowed) {
      return null;
    }
  }

  return req;
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
  const created = data as Requirement;
  const meta = parseRequirementMeta(created);
  await syncRequirementMappingWithBackend({
    requirementId: created.id,
    isClientMapped: meta.isClientMapped,
    mappedClientOrgId: meta.mappedClientOrgId,
    budgetUnit: meta.budgetUnit,
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
  });
  await syncRequirementsCatalogWithBackend([created]);
  return created;
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
  const updated = data as Requirement;
  const meta = parseRequirementMeta(updated);
  await syncRequirementMappingWithBackend({
    requirementId: updated.id,
    isClientMapped: meta.isClientMapped,
    mappedClientOrgId: meta.mappedClientOrgId,
    budgetUnit: meta.budgetUnit,
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
  });
  await syncRequirementsCatalogWithBackend([updated]);
  return updated;
}

export async function setRequirementClientMapping(params: {
  requirement: Requirement;
  isClientMapped: boolean;
  mappedClientOrgId: string | null;
}): Promise<Requirement> {
  const meta = parseRequirementMeta(params.requirement);
  const nextCurrency = encodeRequirementMetaToCurrency({
    baseCurrency: meta.baseCurrency,
    budgetUnit: meta.budgetUnit || 'LPA',
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
    isClientMapped: params.isClientMapped,
    mappedClientOrgId: params.isClientMapped
      ? params.mappedClientOrgId || params.requirement.client_org_id
      : null,
  });

  const { data, error } = await supabase
    .from('requirements')
    .update({
      currency: nextCurrency,
    })
    .eq('id', params.requirement.id)
    .select('*, organizations:client_org_id(id, name)')
    .single();
  if (error) throw error;
  const updated = data as Requirement;
  await syncRequirementMappingWithBackend({
    requirementId: updated.id,
    isClientMapped: params.isClientMapped,
    mappedClientOrgId: params.isClientMapped
      ? params.mappedClientOrgId || updated.client_org_id
      : null,
    budgetUnit: meta.budgetUnit,
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
  });
  await syncRequirementsCatalogWithBackend([updated]);
  return updated;
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
  const dbShares = (data || []) as RequirementVendorShare[];

  // Merge with backend catalog shares so both Admin requirement detail (Overview / Vendor sharing)
  // and Vendor workspace views always reflect active requirement shares
  const backendCatalog = await fetchVendorCatalogFromBackend(vendorOrgId);
  const byReqId = new Map<string, RequirementVendorShare>();
  for (const sh of dbShares) {
    byReqId.set(`${sh.requirement_id}:${sh.vendor_org_id}`, sh);
  }
  for (const sh of backendCatalog.shares) {
    if (requirementId && sh.requirement_id !== requirementId) continue;
    const hasAnyShareForReq = dbShares.some((d) => d.requirement_id === sh.requirement_id);
    if (!hasAnyShareForReq) {
      byReqId.set(`${sh.requirement_id}:${sh.vendor_org_id}`, sh);
    }
  }
  return Array.from(byReqId.values());
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
  vendorOrgId?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_requirement', {
    p_requirement_id: params.p_requirement_id,
  });
  await fetch('/api/requirements/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirementId: params.p_requirement_id,
      vendorOrgId: params.vendorOrgId || undefined,
    }),
  }).catch(() => undefined);
  if (error && !params.vendorOrgId) throw error;
}

