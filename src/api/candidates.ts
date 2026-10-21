import { supabase } from '../lib/supabase';
import { buildSafeResumeStoragePath } from '../lib/hash';
import type {
  Candidate,
  CandidateContacts,
  CandidateMatch,
  CandidateSource,
  CreateCandidateResult,
  DuplicateCheckResult,
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

// Two-way deterministic matching queries (candidate_matches)
export async function fetchMatchesForRequirement(params: {
  requirementId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: CandidateMatch[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('candidate_matches')
    .select(
      '*, candidates:candidate_id(*, source_vendor:source_vendor_org_id(id, name), owner_vendor:owner_vendor_org_id(id, name))',
      { count: 'exact' }
    )
    .eq('requirement_id', params.requirementId)
    .order('final_score', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: (data || []) as CandidateMatch[], count: count || 0 };
}

export async function fetchMatchesForCandidate(params: {
  candidateId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: CandidateMatch[]; count: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('candidate_matches')
    .select(
      '*, requirements:requirement_id(*, organizations:client_org_id(id, name))',
      { count: 'exact' }
    )
    .eq('candidate_id', params.candidateId)
    .order('final_score', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: (data || []) as CandidateMatch[], count: count || 0 };
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
  const { error } = await supabase.rpc('recompute_matches', {
    p_requirement_id: requirementId,
  });
  if (error) throw error;
}
