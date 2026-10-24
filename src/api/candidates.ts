import { supabase } from '../lib/supabase';
import { buildSafeResumeStoragePath } from '../lib/hash';
import {
  computeFineTunedCandidateMatch,
  decomposeCompoundSkills,
} from '../lib/matchingEngine';
import type {
  Candidate,
  CandidateContacts,
  CandidateMatch,
  CandidateSource,
  CreateCandidateResult,
  DuplicateCheckResult,
  Requirement,
} from '../types/db';

const DEFAULT_PAGE_SIZE = 25;

export async function fetchCandidates(params: {
  page?: number;
  pageSize?: number;
  originalSource?: CandidateSource | '';
  ownerVendorOrgId?: string;
  skill?: string;
  minExp?: number;
  maxExp?: number;
  search?: string;
}): Promise<{ data: Candidate[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('candidates')
    .select(
      '*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name), candidate_contacts(*)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.originalSource) query = query.eq('original_source', params.originalSource);
  if (params.ownerVendorOrgId) query = query.eq('owner_vendor_org_id', params.ownerVendorOrgId);
  if (params.skill?.trim()) {
    query = query.contains('skills', [params.skill.trim()]);
  }
  if (params.minExp !== undefined && !Number.isNaN(params.minExp)) {
    query = query.gte('total_experience_years', params.minExp);
  }
  if (params.maxExp !== undefined && !Number.isNaN(params.maxExp)) {
    query = query.lte('total_experience_years', params.maxExp);
  }
  if (params.search?.trim()) {
    query = query.ilike('full_name', `%${params.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Candidate[], count: count || 0 };
}

export async function fetchCandidateById(id: string): Promise<Candidate | null> {
  const { data, error } = await supabase
    .from('candidates')
    .select(
      '*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Candidate | null;
}

export async function fetchMyCandidateProfile(userId: string): Promise<Candidate | null> {
  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Candidate | null;
}

export async function fetchCandidateContacts(
  candidateId: string
): Promise<CandidateContacts | null> {
  const { data, error } = await supabase
    .from('candidate_contacts')
    .select('*')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) return null; // Clients cannot read candidate_contacts per RLS
  return data as CandidateContacts | null;
}

// Section 5.4 RPCs: check_candidate_duplicate & create_candidate
export async function checkCandidateDuplicate(params: {
  p_email?: string | null;
  p_phone?: string | null;
  p_resume_hash?: string | null;
}): Promise<DuplicateCheckResult> {
  const { data, error } = await supabase.rpc('check_candidate_duplicate', params);
  if (error) throw error;
  return data as DuplicateCheckResult;
}

export async function createCandidateRpc(params: {
  p_full_name: string;
  p_email?: string | null;
  p_phone?: string | null;
  p_linkedin_url?: string | null;
  p_current_title?: string | null;
  p_location?: string | null;
  p_total_experience_years?: number | null;
  p_skills?: string[];
  p_summary?: string | null;
  p_resume_hash?: string | null;
}): Promise<CreateCandidateResult> {
  const { data, error } = await supabase.rpc('create_candidate', params);
  if (error) throw error;
  return data as CreateCandidateResult;
}

// Section 5.3: Allowed direct update on candidates & candidate_contacts
export async function updateCandidateProfile(
  candidateId: string,
  payload: Partial<
    Pick<
      Candidate,
      | 'full_name'
      | 'current_title'
      | 'location'
      | 'total_experience_years'
      | 'skills'
      | 'summary'
      | 'resume_path'
      | 'resume_hash'
      | 'parsed_data'
    >
  >
): Promise<Candidate> {
  const { data, error } = await supabase
    .from('candidates')
    .update(payload)
    .eq('id', candidateId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Candidate;
}

export async function updateCandidateContacts(
  candidateId: string,
  payload: {
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from('candidate_contacts')
    .update({
      email: payload.email,
      phone: payload.phone,
      linkedin_url: payload.linkedin_url,
    })
    .eq('candidate_id', candidateId);
  if (error) throw error;
}

// Private storage bucket `resumes`: upload and 5-minute signed URL
export async function uploadCandidateResume(
  candidateId: string,
  file: File,
  resumeHash: string
): Promise<string> {
  const storagePath = buildSafeResumeStoragePath(candidateId, file.name);
  const { error: uploadError } = await supabase.storage
    .from('resumes')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) throw uploadError;

  await updateCandidateProfile(candidateId, {
    resume_path: storagePath,
    resume_hash: resumeHash,
  });

  return storagePath;
}

export async function getResumeSignedUrl(resumePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('resumes')
    .createSignedUrl(resumePath, 300); // 5 minutes per Section 5.2 & 10
  if (error) throw error;
  return data.signedUrl;
}

// Two-way deterministic matching queries (candidate_matches) enriched with JD + Resume skill fine-tuning
export async function fetchMatchesForRequirement(params: {
  requirementId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: CandidateMatch[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  // Fetch requirement, existing match rows, and full candidate pool in parallel
  const [reqRes, matchesRes, candidatesRes] = await Promise.all([
    supabase
      .from('requirements')
      .select('*, organizations:client_org_id(id, name)')
      .eq('id', params.requirementId)
      .maybeSingle(),
    supabase
      .from('candidate_matches')
      .select(
        '*, candidates:candidate_id(*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name))'
      )
      .eq('requirement_id', params.requirementId),
    supabase
      .from('candidates')
      .select(
        '*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name)'
      )
      .order('created_at', { ascending: false })
      .limit(250),
  ]);

  if (matchesRes.error) throw matchesRes.error;

  const requirement = reqRes.data as Requirement | null;
  const existingMatches = (matchesRes.data || []) as CandidateMatch[];
  const allCandidates = (candidatesRes.data || []) as Candidate[];

  if (!requirement) {
    const sortedFallback = [...existingMatches].sort((a, b) => b.final_score - a.final_score);
    return {
      data: sortedFallback.slice(from, to),
      count: sortedFallback.length,
    };
  }

  // If the requirement has compound unsplit skill strings (e.g. separated by ';', '/', or 'and'),
  // decompose and normalize them in the background so future RPCs & UI chips are clean.
  const rawSkills = Array.isArray(requirement.skills) ? requirement.skills : [];
  const atomicSkills = decomposeCompoundSkills(rawSkills);
  const hasCompoundSkill = rawSkills.some((s) => /[;/\n]|,\s|\band\b/i.test(s));
  if (hasCompoundSkill && atomicSkills.length > rawSkills.length) {
    void supabase
      .from('requirements')
      .update({ skills: atomicSkills })
      .eq('id', requirement.id);
    requirement.skills = atomicSkills;
  }

  // Map existing matches by candidate_id to preserve override_score and DB IDs
  const existingByCandidateId = new Map<string, CandidateMatch>();
  for (const m of existingMatches) {
    existingByCandidateId.set(m.candidate_id, m);
  }

  // Ensure any candidate referenced in existingMatches is also in the candidate map
  const candidateMap = new Map<string, Candidate>();
  for (const c of allCandidates) {
    candidateMap.set(c.id, c);
  }
  for (const m of existingMatches) {
    if (m.candidates && !candidateMap.has(m.candidate_id)) {
      candidateMap.set(m.candidate_id, m.candidates);
    }
  }

  const enrichedMatches: CandidateMatch[] = [];
  const updatesToSync: Array<{
    id: string;
    skill_score: number;
    experience_score: number;
    computed_score: number;
    matched_skills: string[];
    unproven_skills: string[];
    experience_note: string;
    evidence: Record<string, unknown>;
  }> = [];

  for (const candidate of candidateMap.values()) {
    const existing = existingByCandidateId.get(candidate.id);
    const fineTuned = computeFineTunedCandidateMatch(requirement, candidate, existing);

    const evidencePayload: Record<string, unknown> = {
      ...(existing?.evidence || {}),
      engine: 'v2.2-4d-weighted',
      formula: '0.40*S + 0.25*E + 0.20*D + 0.15*N',
      skill_score: fineTuned.skill_score,
      experience_score: fineTuned.experience_score,
      domain_score: fineTuned.domain_score,
      seniority_score: fineTuned.seniority_score,
      dimensions: fineTuned.dimensions,
    };

    const matchRecord: CandidateMatch = {
      id: existing?.id || `${requirement.id}_${candidate.id}`,
      requirement_id: requirement.id,
      candidate_id: candidate.id,
      computed_score: fineTuned.computed_score,
      skill_score: fineTuned.skill_score,
      experience_score: fineTuned.experience_score,
      domain_score: fineTuned.domain_score,
      seniority_score: fineTuned.seniority_score,
      override_score: existing?.override_score ?? null,
      final_score: fineTuned.final_score,
      matched_skills: fineTuned.matched_skills,
      unproven_skills: fineTuned.unproven_skills,
      experience_note: fineTuned.experience_note,
      evidence: evidencePayload,
      engine_version: 'v2.2-4d-weighted',
      calculated_at: existing?.calculated_at || new Date().toISOString(),
      override_reason: existing?.override_reason ?? null,
      overridden_by: existing?.overridden_by ?? null,
      overridden_at: existing?.overridden_at ?? null,
      candidates: candidate,
      requirements: requirement,
    };

    enrichedMatches.push(matchRecord);

    if (
      existing?.id &&
      (existing.computed_score !== fineTuned.computed_score ||
        existing.skill_score !== fineTuned.skill_score ||
        (existing.evidence as Record<string, unknown> | null)?.domain_score !==
          fineTuned.domain_score ||
        JSON.stringify(existing.matched_skills) !== JSON.stringify(fineTuned.matched_skills) ||
        JSON.stringify(existing.unproven_skills) !== JSON.stringify(fineTuned.unproven_skills))
    ) {
      updatesToSync.push({
        id: existing.id,
        skill_score: fineTuned.skill_score,
        experience_score: fineTuned.experience_score,
        computed_score: fineTuned.computed_score,
        matched_skills: fineTuned.matched_skills,
        unproven_skills: fineTuned.unproven_skills,
        experience_note: fineTuned.experience_note,
        evidence: evidencePayload,
      });
    }
  }

  // Best-effort background sync of fine-tuned scores into candidate_matches table
  // Note: final_score is a GENERATED ALWAYS AS (COALESCE(override_score, computed_score)) column in PostgreSQL
  if (updatesToSync.length > 0) {
    void Promise.allSettled(
      updatesToSync.map((u) =>
        supabase
          .from('candidate_matches')
          .update({
            skill_score: u.skill_score,
            experience_score: u.experience_score,
            computed_score: u.computed_score,
            matched_skills: u.matched_skills,
            unproven_skills: u.unproven_skills,
            experience_note: u.experience_note,
            evidence: u.evidence,
            engine_version: 'v2.2-4d-weighted',
          })
          .eq('id', u.id)
      )
    );
  }

  enrichedMatches.sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    if (b.skill_score !== a.skill_score) return b.skill_score - a.skill_score;
    return b.experience_score - a.experience_score;
  });

  return {
    data: enrichedMatches.slice(from, to),
    count: enrichedMatches.length,
  };
}

export async function fetchMatchesForCandidate(params: {
  candidateId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: CandidateMatch[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  const [candRes, matchesRes, reqsRes] = await Promise.all([
    supabase
      .from('candidates')
      .select(
        '*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name)'
      )
      .eq('id', params.candidateId)
      .maybeSingle(),
    supabase
      .from('candidate_matches')
      .select('*, requirements:requirement_id(*, organizations:client_org_id(id, name))')
      .eq('candidate_id', params.candidateId),
    supabase
      .from('requirements')
      .select('*, organizations:client_org_id(id, name)')
      .in('status', ['open', 'pending_approval', 'draft'])
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (matchesRes.error) throw matchesRes.error;

  const candidate = candRes.data as Candidate | null;
  const existingMatches = (matchesRes.data || []) as CandidateMatch[];
  const allRequirements = (reqsRes.data || []) as Requirement[];

  if (!candidate) {
    const sortedFallback = [...existingMatches].sort((a, b) => b.final_score - a.final_score);
    return {
      data: sortedFallback.slice(from, to),
      count: sortedFallback.length,
    };
  }

  const existingByReqId = new Map<string, CandidateMatch>();
  for (const m of existingMatches) {
    existingByReqId.set(m.requirement_id, m);
  }

  const reqMap = new Map<string, Requirement>();
  for (const r of allRequirements) {
    // Exclude soft-deleted requirements
    const notesStr = String((r as unknown as Record<string, unknown>).notes || '');
    if (notesStr.includes('__HIRENEST_DELETED_META__:')) continue;
    reqMap.set(r.id, r);
  }
  for (const m of existingMatches) {
    if (m.requirements && !reqMap.has(m.requirement_id)) {
      reqMap.set(m.requirement_id, m.requirements);
    }
  }

  const enrichedMatches: CandidateMatch[] = [];
  for (const req of reqMap.values()) {
    const existing = existingByReqId.get(req.id);
    const fineTuned = computeFineTunedCandidateMatch(req, candidate, existing);

    enrichedMatches.push({
      id: existing?.id || `${req.id}_${candidate.id}`,
      requirement_id: req.id,
      candidate_id: candidate.id,
      computed_score: fineTuned.computed_score,
      skill_score: fineTuned.skill_score,
      experience_score: fineTuned.experience_score,
      domain_score: fineTuned.domain_score,
      seniority_score: fineTuned.seniority_score,
      override_score: existing?.override_score ?? null,
      final_score: fineTuned.final_score,
      matched_skills: fineTuned.matched_skills,
      unproven_skills: fineTuned.unproven_skills,
      experience_note: fineTuned.experience_note,
      evidence: {
        ...(existing?.evidence || {}),
        engine: 'v2.2-4d-weighted',
        formula: '0.40*S + 0.25*E + 0.20*D + 0.15*N',
        skill_score: fineTuned.skill_score,
        experience_score: fineTuned.experience_score,
        domain_score: fineTuned.domain_score,
        seniority_score: fineTuned.seniority_score,
        dimensions: fineTuned.dimensions,
      },
      engine_version: 'v2.2-4d-weighted',
      calculated_at: existing?.calculated_at || new Date().toISOString(),
      override_reason: existing?.override_reason ?? null,
      overridden_by: existing?.overridden_by ?? null,
      overridden_at: existing?.overridden_at ?? null,
      candidates: candidate,
      requirements: req,
    });
  }

  enrichedMatches.sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    if (b.skill_score !== a.skill_score) return b.skill_score - a.skill_score;
    return b.experience_score - a.experience_score;
  });

  return {
    data: enrichedMatches.slice(from, to),
    count: enrichedMatches.length,
  };
}

// HQ-only match RPCs
export async function overrideMatchScore(params: {
  p_requirement_id: string;
  p_candidate_id: string;
  p_score: number | null;
  p_reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc('override_match', params);
  if (error) throw error;
}

export async function recomputeRequirementMatches(requirementId: string): Promise<void> {
  // First normalize any compound skill paragraphs on the requirement into atomic skills
  const { data: reqData } = await supabase
    .from('requirements')
    .select('id, skills')
    .eq('id', requirementId)
    .maybeSingle();

  if (reqData && Array.isArray(reqData.skills)) {
    const atomic = decomposeCompoundSkills(reqData.skills);
    if (atomic.length > 0 && JSON.stringify(atomic) !== JSON.stringify(reqData.skills)) {
      await supabase
        .from('requirements')
        .update({ skills: atomic })
        .eq('id', requirementId);
    }
  }

  const { error } = await supabase.rpc('recompute_matches', {
    p_requirement_id: requirementId,
  });
  if (error) {
    // Even if RPC warns/errors (e.g. requirement still in draft), fetchMatchesForRequirement
    // computes and populates fine-tuned matches for all candidates.
    console.warn('recompute_matches RPC notice:', error.message);
  }

  // Trigger fine-tuned match calculation & sync
  await fetchMatchesForRequirement({ requirementId, page: 1, pageSize: 100 });
}
