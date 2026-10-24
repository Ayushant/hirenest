import { supabase } from '../lib/supabase';
import {
  computeRequirementDuplicateGroupKey,
  computeRequirementFingerprint,
  encodeRequirementMetaToCurrency,
  evaluateRequirementAccess,
  getRequirementFinancialsCache,
  getRequirementMarginsCache,
  isRequirementSoftDeleted,
  normalizeSkillsSignature,
  parseRequirementMeta,
  saveRequirementDeletedCache,
  saveRequirementExtendedCache,
  saveRequirementFinancialsCache,
  saveRequirementMarginsCache,
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

// In-memory client-side concurrency lock keyed by requirement fingerprint so simultaneous createRequirement calls never race
const inFlightClientCreateLocks = new Map<
  string,
  Promise<Requirement & { wasDuplicatePrevented?: boolean }>
>();

async function hydrateDeletedRequirementsFromBackend(): Promise<void> {
  try {
    const res = await fetch('/api/requirements/governance-state');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.deletedRequirements && typeof data.deletedRequirements === 'object') {
      for (const [reqId, rec] of Object.entries(
        data.deletedRequirements as Record<
          string,
          {
            isDeleted?: boolean;
            deletedAt?: string;
            deletedBy?: string;
            canonicalId?: string | null;
            reason?: string | null;
          }
        >
      )) {
        if (rec?.isDeleted) {
          saveRequirementDeletedCache(reqId, {
            isDeleted: true,
            deletedAt: rec.deletedAt || null,
            deletedBy: rec.deletedBy || null,
            canonicalId: rec.canonicalId || null,
            deleteReason: rec.reason || null,
          });
        }
      }
    }
  } catch {
    // Non-blocking hydration
  }
}

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

    const reqList = ((allReqs || []) as Requirement[]).filter(
      (r) => !isRequirementSoftDeleted(r)
    );
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
  includeDeleted?: boolean;
}): Promise<{ data: Requirement[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;

  await hydrateDeletedRequirementsFromBackend();

  let query = supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)')
    .order('created_at', { ascending: false });

  if (params.clientOrgId) query = query.eq('client_org_id', params.clientOrgId);
  if (params.status) query = query.eq('status', params.status);
  if (params.isPublic !== undefined) query = query.eq('is_public', params.isPublic);
  if (params.search?.trim()) {
    query = query.ilike('title', `%${params.search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  let allRows = (data || []) as Requirement[];

  // Filter out soft-deleted requirements before syncing or displaying in active lists
  if (!params.includeDeleted) {
    allRows = allRows.filter((r) => !isRequirementSoftDeleted(r));
  }

  if (allRows.length > 0 && !params.forVendor) {
    void syncRequirementsCatalogWithBackend(
      allRows.filter((r) => !isRequirementSoftDeleted(r))
    );
  }

  // If querying for Vendor workspace, merge with backend published catalog so eligible open requirements are always visible
  if (params.forVendor) {
    const backendCatalog = await fetchVendorCatalogFromBackend();
    const byId = new Map<string, Requirement>();
    for (const r of allRows) {
      if (!isRequirementSoftDeleted(r)) {
        byId.set(r.id, r);
      }
    }
    for (const r of backendCatalog.requirements) {
      if (!byId.has(r.id) && !isRequirementSoftDeleted(r)) {
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
    if (!params.includeDeleted && isRequirementSoftDeleted(req)) {
      return false;
    }
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
  options?: { viewerRole?: AppRole; viewerOrgId?: string | null; allowDeletedForAdminAudit?: boolean }
): Promise<Requirement | null> {
  await hydrateDeletedRequirementsFromBackend();

  if (!options?.allowDeletedForAdminAudit && isRequirementSoftDeleted(id)) {
    return null;
  }

  const { data, error } = await supabase
    .from('requirements')
    .select('*, organizations:client_org_id(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  let req = data as Requirement | null;

  if (req && !options?.allowDeletedForAdminAudit && isRequirementSoftDeleted(req)) {
    return null;
  }

  if (!req) {
    const backendCatalog = await fetchVendorCatalogFromBackend(options?.viewerOrgId || undefined);
    req = backendCatalog.requirements.find((r) => r.id === id) || null;
    if (req && !options?.allowDeletedForAdminAudit && isRequirementSoftDeleted(req)) {
      return null;
    }
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
      allowDeletedForAdminAudit: options.allowDeletedForAdminAudit,
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
  sourceRef?: string;
}

export type UpdateRequirementInput = Omit<CreateRequirementInput, 'client_org_id'>;

/**
 * Idempotent requirement creation with backend + database duplicate prevention.
 * Checks normalized fingerprint (title, skills, client organization scope, location, work mode, sourceRef)
 * so retries or concurrent submissions return the single canonical active requirement instead of inserting duplicates.
 * Similar roles for different clients have distinct fingerprints and remain separate.
 */
export async function createRequirement(
  input: CreateRequirementInput
): Promise<Requirement & { wasDuplicatePrevented?: boolean }> {
  const inputMeta = parseRequirementMeta(
    input.currency,
    input.vendor_visible_budget,
    input.client_org_id
  );

  const fingerprint = computeRequirementFingerprint({
    title: input.title,
    skills: input.skills,
    client_org_id: input.client_org_id,
    mappedClientOrgId: inputMeta.mappedClientOrgId,
    isClientMapped: inputMeta.isClientMapped,
    location: input.location,
    work_mode: input.work_mode,
    sourceRef: input.sourceRef,
  });

  // 1. Serialize concurrent client-side/process-level calls sharing the exact same fingerprint
  const existingInFlight = inFlightClientCreateLocks.get(fingerprint);
  if (existingInFlight) {
    const firstResult = await existingInFlight;
    return { ...firstResult, wasDuplicatePrevented: true };
  }

  const executeCreation = (async (): Promise<
    Requirement & { wasDuplicatePrevented?: boolean }
  > => {
    await hydrateDeletedRequirementsFromBackend();

    // 2. Check server-side atomic idempotency guard
    try {
      const guardRes = await fetch('/api/requirements/idempotent-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          skills: input.skills,
          client_org_id: input.client_org_id,
          mappedClientOrgId: inputMeta.mappedClientOrgId,
          isClientMapped: inputMeta.isClientMapped,
          location: input.location,
          work_mode: input.work_mode,
          sourceRef: input.sourceRef,
        }),
      });
      if (guardRes.ok) {
        const guardData = await guardRes.json();
        if (guardData.duplicate && guardData.canonicalRequirementId) {
          const existingDb = await fetchRequirementById(guardData.canonicalRequirementId);
          if (existingDb && !isRequirementSoftDeleted(existingDb)) {
            return { ...existingDb, wasDuplicatePrevented: true };
          }
          if (guardData.existingRequirement && typeof guardData.existingRequirement.id === 'string') {
            return {
              ...(guardData.existingRequirement as Requirement),
              wasDuplicatePrevented: true,
            };
          }
        }
      }
    } catch {
      // Fallback to direct database duplicate verification
    }

    // 3. Authoritative database check for existing active equivalent requirement for this client
    try {
      const { data: existingClientReqs } = await supabase
        .from('requirements')
        .select('*, organizations:client_org_id(id, name)')
        .eq('client_org_id', input.client_org_id)
        .order('created_at', { ascending: true });

      const targetSkillsSig = normalizeSkillsSignature(input.skills);
      const targetCoreKey = computeRequirementDuplicateGroupKey({
        title: input.title,
        client_org_id: input.client_org_id,
        mappedClientOrgId: inputMeta.mappedClientOrgId,
        isClientMapped: inputMeta.isClientMapped,
        location: input.location,
        work_mode: input.work_mode,
      });

      for (const row of (existingClientReqs || []) as Requirement[]) {
        if (isRequirementSoftDeleted(row)) continue;
        if (row.status === 'closed' || row.status === 'filled') continue;

        const rowMeta = parseRequirementMeta(row);
        const rowFp = computeRequirementFingerprint({
          title: row.title,
          skills: row.skills,
          client_org_id: row.client_org_id,
          mappedClientOrgId: rowMeta.mappedClientOrgId,
          isClientMapped: rowMeta.isClientMapped,
          location: row.location,
          work_mode: row.work_mode,
        });

        const rowCoreKey = computeRequirementDuplicateGroupKey({
          title: row.title,
          client_org_id: row.client_org_id,
          mappedClientOrgId: rowMeta.mappedClientOrgId,
          isClientMapped: rowMeta.isClientMapped,
          location: row.location,
          work_mode: row.work_mode,
        });
        const rowSkillsSig = normalizeSkillsSignature(row.skills);

        const isEquivalent =
          rowFp === fingerprint ||
          (rowCoreKey === targetCoreKey &&
            (rowSkillsSig === targetSkillsSig || !rowSkillsSig || !targetSkillsSig));

        if (isEquivalent) {
          // If the retry has skills that were missing on the earlier record, enrich the canonical record
          if (input.skills.length > (row.skills?.length || 0)) {
            await supabase
              .from('requirements')
              .update({ skills: input.skills })
              .eq('id', row.id);
            row.skills = input.skills;
          }

          await fetch('/api/requirements/idempotent-guard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: input.title,
              skills: input.skills,
              client_org_id: input.client_org_id,
              mappedClientOrgId: inputMeta.mappedClientOrgId,
              isClientMapped: inputMeta.isClientMapped,
              location: input.location,
              work_mode: input.work_mode,
              sourceRef: input.sourceRef,
              commitRequirement: row,
            }),
          }).catch(() => undefined);

          return { ...row, wasDuplicatePrevented: true };
        }
      }
    } catch {
      // Proceed to insert if query fails
    }

    // 4. Insert the new canonical requirement
    let { data, error } = await supabase
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
      .select('*, organizations:client_org_id(id, name)')
      .single();

    // Fallback if database currency column has a length/check constraint restricting pipe metadata
    if (error && input.currency.includes('|')) {
      const retry = await supabase
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
          currency: inputMeta.baseCurrency || 'INR',
          submission_sla_hours: input.submission_sla_hours,
        })
        .select('*, organizations:client_org_id(id, name)')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    const created = { ...(data as Requirement), currency: input.currency };
    saveRequirementExtendedCache(created.id, inputMeta);

    // 5. Commit canonical requirement to server idempotency registry
    await fetch('/api/requirements/idempotent-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        skills: input.skills,
        client_org_id: input.client_org_id,
        mappedClientOrgId: inputMeta.mappedClientOrgId,
        isClientMapped: inputMeta.isClientMapped,
        location: input.location,
        work_mode: input.work_mode,
        sourceRef: input.sourceRef,
        commitRequirement: created,
      }),
    }).catch(() => undefined);

    await syncRequirementMappingWithBackend({
      requirementId: created.id,
      isClientMapped: inputMeta.isClientMapped,
      mappedClientOrgId: inputMeta.mappedClientOrgId,
      budgetUnit: inputMeta.budgetUnit,
      budgetMode: inputMeta.budgetMode,
      budgetMin: inputMeta.budgetMin,
      budgetMax: inputMeta.budgetMax,
    });
    await syncRequirementsCatalogWithBackend([created]);
    return { ...created, wasDuplicatePrevented: false };
  })();

  inFlightClientCreateLocks.set(fingerprint, executeCreation);
  try {
    return await executeCreation;
  } finally {
    inFlightClientCreateLocks.delete(fingerprint);
  }
}

/**
 * Soft-deletes a requirement (preserving audit history, candidate submissions, and financial records)
 * and removes it from all active Admin, Client, Vendor, and Public feeds.
 */
export async function softDeleteRequirement(params: {
  requirement: Requirement;
  deletedBy?: string | null;
  canonicalId?: string | null;
  reason?: string | null;
}): Promise<{
  requirementId: string;
  deletedAt: string;
  deletedBy: string;
  canonicalId: string | null;
}> {
  const { requirement, deletedBy, canonicalId = null, reason = 'Deleted by Admin' } = params;
  const nowIso = new Date().toISOString();
  const actor = deletedBy || 'admin';
  const meta = parseRequirementMeta(requirement);

  const deletedCurrency = encodeRequirementMetaToCurrency({
    baseCurrency: meta.baseCurrency,
    budgetUnit: meta.budgetUnit || 'LPA',
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
    isClientMapped: meta.isClientMapped,
    mappedClientOrgId: meta.mappedClientOrgId,
    isDeleted: true,
    deletedAt: nowIso,
    deletedBy: actor,
    canonicalId,
  });

  // 1. Save soft-delete state in local cache immediately
  saveRequirementDeletedCache(requirement.id, {
    isDeleted: true,
    deletedAt: nowIso,
    deletedBy: actor,
    canonicalId,
    deleteReason: reason,
  });

  // 2. Persist soft-delete status + metadata to database while keeping row & foreign keys intact
  try {
    await supabase
      .rpc('set_requirement_status', {
        p_requirement_id: requirement.id,
        p_status: 'closed',
        p_reason: reason || `Soft-deleted by ${actor} at ${nowIso}`,
      })
      .then(() => undefined, () => undefined);

    await supabase
      .rpc('set_requirement_public', {
        p_requirement_id: requirement.id,
        p_is_public: false,
      })
      .then(() => undefined, () => undefined);

    const { error: currErr } = await supabase
      .from('requirements')
      .update({
        status: 'closed',
        is_public: false,
        closed_at: nowIso,
        currency: deletedCurrency,
      })
      .eq('id', requirement.id);

    if (currErr) {
      await supabase
        .from('requirements')
        .update({
          status: 'closed',
          is_public: false,
          closed_at: nowIso,
        })
        .eq('id', requirement.id);
    }

    // Revoke any active vendor shares so the requirement disappears from vendor feeds
    const { data: activeShares } = await supabase
      .from('requirement_vendor_shares')
      .select('vendor_org_id, revoked_at')
      .eq('requirement_id', requirement.id);

    for (const sh of activeShares || []) {
      if (!sh.revoked_at && sh.vendor_org_id) {
        await supabase
          .rpc('revoke_requirement_share', {
            p_requirement_id: requirement.id,
            p_vendor_org_id: sh.vendor_org_id,
          })
          .then(() => undefined, () => undefined);
      }
    }
  } catch {
    // Non-fatal if RLS restricts secondary RPC
  }

  // 3. Sync soft deletion with backend governance store
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    await fetch('/api/requirements/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        requirementId: requirement.id,
        title: requirement.title,
        clientOrgId: requirement.client_org_id,
        deletedBy: actor,
        canonicalId,
        reason,
      }),
    });
  } catch {
    // Non-blocking backend sync
  }

  return {
    requirementId: requirement.id,
    deletedAt: nowIso,
    deletedBy: actor,
    canonicalId,
  };
}

/**
 * Consolidates a group of duplicate requirements into the Admin-selected canonical record:
 * 1. Preserves and migrates linked submissions, financials, margins, and skills to the canonical record.
 * 2. Soft-deletes/archives the non-canonical duplicate records with canonicalId linkage.
 */
export async function consolidateDuplicateRequirements(params: {
  canonicalRequirement: Requirement;
  duplicateRequirements: Requirement[];
  deletedBy?: string | null;
}): Promise<{
  canonicalRequirementId: string;
  archivedIds: string[];
  migratedSubmissionCount: number;
}> {
  const { canonicalRequirement, duplicateRequirements, deletedBy } = params;
  const actor = deletedBy || 'admin';
  const archivedIds: string[] = [];
  let migratedSubmissionCount = 0;

  const mergedSkillsSet = new Set<string>(canonicalRequirement.skills || []);
  const canonicalFin = await fetchRequirementFinancials(canonicalRequirement.id);
  const canonicalMar = await fetchRequirementMargins(canonicalRequirement.id);

  for (const dup of duplicateRequirements) {
    if (!dup || dup.id === canonicalRequirement.id) continue;

    for (const sk of dup.skills || []) {
      if (sk && sk.trim()) mergedSkillsSet.add(sk.trim());
    }

    // 1. Migrate or preserve any candidate submissions linked to the duplicate requirement
    try {
      const { data: dupSubs } = await supabase
        .from('submissions')
        .select('id, candidate_id')
        .eq('requirement_id', dup.id);

      if (dupSubs && dupSubs.length > 0) {
        for (const sub of dupSubs) {
          const { error: moveErr } = await supabase
            .from('submissions')
            .update({ requirement_id: canonicalRequirement.id })
            .eq('id', sub.id);
          if (!moveErr) {
            migratedSubmissionCount += 1;
          }
        }
      }
    } catch {
      // Submissions remain preserved on the soft-deleted record if RLS prevents re-pointing
    }

    // 2. Preserve financials if canonical lacks them
    if (!canonicalFin?.actual_client_budget && !canonicalFin?.notes) {
      const dupFin = await fetchRequirementFinancials(dup.id);
      if (dupFin && (dupFin.actual_client_budget !== null || dupFin.notes)) {
        await upsertRequirementFinancials({
          requirement_id: canonicalRequirement.id,
          actual_client_budget: dupFin.actual_client_budget,
          notes: dupFin.notes,
        });
      }
    }

    // 3. Preserve margins if canonical lacks them
    if (canonicalMar?.platform_margin === null || canonicalMar?.platform_margin === undefined) {
      const dupMar = await fetchRequirementMargins(dup.id);
      if (dupMar && dupMar.platform_margin !== null) {
        await upsertRequirementMargins({
          requirement_id: canonicalRequirement.id,
          platform_margin: dupMar.platform_margin,
          margin_type: dupMar.margin_type,
        });
      }
    }

    // 4. Soft-delete the duplicate requirement with canonicalId reference
    await softDeleteRequirement({
      requirement: dup,
      deletedBy: actor,
      canonicalId: canonicalRequirement.id,
      reason: `Consolidated duplicate into canonical requirement ${canonicalRequirement.id}`,
    });

    archivedIds.push(dup.id);
  }

  // Update canonical skills if enriched from duplicates
  const mergedSkills = Array.from(mergedSkillsSet);
  if (mergedSkills.length > (canonicalRequirement.skills?.length || 0)) {
    await supabase
      .from('requirements')
      .update({ skills: mergedSkills })
      .eq('id', canonicalRequirement.id);
  }

  // Notify backend consolidation audit endpoint
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    await fetch('/api/requirements/duplicates/consolidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        canonicalRequirementId: canonicalRequirement.id,
        duplicateRequirementIds: archivedIds,
        title: canonicalRequirement.title,
        clientOrgId: canonicalRequirement.client_org_id,
        deletedBy: actor,
      }),
    });
  } catch {
    // Non-blocking backend sync
  }

  return {
    canonicalRequirementId: canonicalRequirement.id,
    archivedIds,
    migratedSubmissionCount,
  };
}

export async function updateRequirement(
  id: string,
  input: UpdateRequirementInput
): Promise<Requirement> {
  const inputMeta = parseRequirementMeta(input.currency, input.vendor_visible_budget);

  let { data, error } = await supabase
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

  if (error && input.currency.includes('|')) {
    const retry = await supabase
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
        currency: inputMeta.baseCurrency || 'INR',
        submission_sla_hours: input.submission_sla_hours,
      })
      .eq('id', id)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  const updated = { ...(data as Requirement), currency: input.currency };
  saveRequirementExtendedCache(updated.id, inputMeta);

  await syncRequirementMappingWithBackend({
    requirementId: updated.id,
    isClientMapped: inputMeta.isClientMapped,
    mappedClientOrgId: inputMeta.mappedClientOrgId,
    budgetUnit: inputMeta.budgetUnit,
    budgetMode: inputMeta.budgetMode,
    budgetMin: inputMeta.budgetMin,
    budgetMax: inputMeta.budgetMax,
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
  const nextMappedOrgId = params.isClientMapped
    ? params.mappedClientOrgId || params.requirement.client_org_id
    : null;
  const nextCurrency = encodeRequirementMetaToCurrency({
    baseCurrency: meta.baseCurrency,
    budgetUnit: meta.budgetUnit || 'LPA',
    budgetMode: meta.budgetMode,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
    isClientMapped: params.isClientMapped,
    mappedClientOrgId: nextMappedOrgId,
  });

  const nextMeta = parseRequirementMeta(
    nextCurrency,
    params.requirement.vendor_visible_budget,
    params.requirement.client_org_id
  );
  saveRequirementExtendedCache(params.requirement.id, nextMeta);

  const { data } = await supabase
    .from('requirements')
    .update({
      currency: nextCurrency,
    })
    .eq('id', params.requirement.id)
    .select('*, organizations:client_org_id(id, name)')
    .maybeSingle();

  const updated = {
    ...(data ? (data as Requirement) : params.requirement),
    currency: nextCurrency,
  };

  await syncRequirementMappingWithBackend({
    requirementId: updated.id,
    isClientMapped: params.isClientMapped,
    mappedClientOrgId: nextMappedOrgId,
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
  const cached = getRequirementFinancialsCache(requirementId);
  try {
    const { data, error } = await supabase
      .from('requirement_financials')
      .select('*')
      .eq('requirement_id', requirementId)
      .maybeSingle();
    if (error || !data) {
      return cached;
    }
    const dbRow = data as RequirementFinancials;
    const merged: RequirementFinancials = {
      requirement_id: requirementId,
      actual_client_budget:
        dbRow.actual_client_budget !== null && dbRow.actual_client_budget !== undefined
          ? dbRow.actual_client_budget
          : cached?.actual_client_budget ?? null,
      notes: dbRow.notes || cached?.notes || null,
    };
    saveRequirementFinancialsCache(merged);
    return merged;
  } catch {
    return cached;
  }
}

export async function upsertRequirementFinancials(payload: {
  requirement_id: string;
  actual_client_budget: number | null;
  notes: string | null;
}): Promise<void> {
  const normalized: RequirementFinancials = {
    requirement_id: payload.requirement_id,
    actual_client_budget:
      payload.actual_client_budget !== null &&
      payload.actual_client_budget !== undefined &&
      !Number.isNaN(Number(payload.actual_client_budget))
        ? Number(payload.actual_client_budget)
        : null,
    notes: payload.notes && payload.notes.trim() !== '' ? payload.notes.trim() : null,
  };

  // Always persist in local cache first so UI reflects immediately even if RLS restricts UPDATE
  saveRequirementFinancialsCache(normalized);

  try {
    const { data: existing } = await supabase
      .from('requirement_financials')
      .select('requirement_id')
      .eq('requirement_id', normalized.requirement_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('requirement_financials')
        .update({
          actual_client_budget: normalized.actual_client_budget,
          notes: normalized.notes,
        })
        .eq('requirement_id', normalized.requirement_id);
    } else if (normalized.actual_client_budget !== null || normalized.notes !== null) {
      await supabase.from('requirement_financials').insert({
        requirement_id: normalized.requirement_id,
        actual_client_budget: normalized.actual_client_budget,
        notes: normalized.notes,
      });
    }
  } catch {
    // Non-fatal if RLS restricts secondary table write; local cache preserves data
  }
}

export async function fetchRequirementMargins(
  requirementId: string
): Promise<RequirementMargins | null> {
  const cached = getRequirementMarginsCache(requirementId);
  try {
    const { data, error } = await supabase
      .from('requirement_margins')
      .select('*')
      .eq('requirement_id', requirementId)
      .maybeSingle();
    if (error || !data) return cached;
    const dbRow = data as RequirementMargins;
    const merged: RequirementMargins = {
      requirement_id: requirementId,
      platform_margin:
        dbRow.platform_margin !== null && dbRow.platform_margin !== undefined
          ? dbRow.platform_margin
          : cached?.platform_margin ?? null,
      margin_type: dbRow.margin_type || cached?.margin_type || 'percentage',
    };
    saveRequirementMarginsCache(merged);
    return merged;
  } catch {
    return cached;
  }
}

export async function upsertRequirementMargins(payload: {
  requirement_id: string;
  platform_margin: number | null;
  margin_type: MarginType;
}): Promise<void> {
  const normalized: RequirementMargins = {
    requirement_id: payload.requirement_id,
    platform_margin:
      payload.platform_margin !== null &&
      payload.platform_margin !== undefined &&
      !Number.isNaN(Number(payload.platform_margin))
        ? Number(payload.platform_margin)
        : null,
    margin_type: payload.margin_type || 'percentage',
  };

  saveRequirementMarginsCache(normalized);

  try {
    const { data: existing } = await supabase
      .from('requirement_margins')
      .select('requirement_id')
      .eq('requirement_id', normalized.requirement_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('requirement_margins')
        .update({
          platform_margin: normalized.platform_margin,
          margin_type: normalized.margin_type,
        })
        .eq('requirement_id', normalized.requirement_id);
    } else if (normalized.platform_margin !== null) {
      await supabase.from('requirement_margins').insert({
        requirement_id: normalized.requirement_id,
        platform_margin: normalized.platform_margin,
        margin_type: normalized.margin_type,
      });
    }
  } catch {
    // Non-fatal if RLS restricts secondary table write
  }
}

export async function fetchRequirementVendorShares(
  requirementId?: string,
  vendorOrgId?: string
): Promise<RequirementVendorShare[]> {
  await hydrateDeletedRequirementsFromBackend();

  let query = supabase
    .from('requirement_vendor_shares')
    .select('*, organizations:vendor_org_id(id, name, sla_tier), requirements:requirement_id(*)')
    .order('shared_at', { ascending: false });

  if (requirementId) query = query.eq('requirement_id', requirementId);
  if (vendorOrgId) query = query.eq('vendor_org_id', vendorOrgId);

  const { data, error } = await query;
  if (error) throw error;
  const dbShares = ((data || []) as RequirementVendorShare[]).filter((sh) => {
    if (isRequirementSoftDeleted(sh.requirement_id)) return false;
    if (sh.requirements && isRequirementSoftDeleted(sh.requirements)) return false;
    return true;
  });

  // Merge with backend catalog shares so both Admin requirement detail (Overview / Vendor sharing)
  // and Vendor workspace views always reflect active requirement shares
  const backendCatalog = await fetchVendorCatalogFromBackend(vendorOrgId);
  const byReqId = new Map<string, RequirementVendorShare>();
  for (const sh of dbShares) {
    byReqId.set(`${sh.requirement_id}:${sh.vendor_org_id}`, sh);
  }
  for (const sh of backendCatalog.shares) {
    if (requirementId && sh.requirement_id !== requirementId) continue;
    if (isRequirementSoftDeleted(sh.requirement_id)) continue;
    if (sh.requirements && isRequirementSoftDeleted(sh.requirements)) continue;
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

