import { supabase } from '../lib/supabase';

export interface PublicJob {
  id: string;
  slug: string;
  title: string;
  description: string;
  skills: string[];
  min_experience: number | null;
  max_experience: number | null;
  location: string | null;
  work_mode: 'onsite' | 'hybrid' | 'remote' | null;
  employment_type:
    | 'full_time'
    | 'contract'
    | 'contract_to_hire'
    | 'part_time'
    | null;
  openings: number;
  currency: string;
  client_org_name: string | null;
  posted_at: string;
}

export interface PublicJobSummary {
  id: string;
  slug: string;
  title: string;
  location: string | null;
  work_mode: PublicJob['work_mode'];
  employment_type: PublicJob['employment_type'];
  min_experience: number | null;
  max_experience: number | null;
  client_org_name: string | null;
  posted_at: string;
}

export async function fetchPublicJob(slug: string): Promise<PublicJob | null> {
  const { data, error } = await supabase.rpc('get_public_requirement', {
    p_slug: slug,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row || null) as PublicJob | null;
}

export async function listPublicJobs(
  limit = 50,
  offset = 0
): Promise<PublicJobSummary[]> {
  const { data, error } = await supabase.rpc('list_public_requirements', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data || []) as PublicJobSummary[];
}
