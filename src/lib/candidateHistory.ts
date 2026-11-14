import { supabase } from './supabase';

export type PastOutcome = 'rejected' | 'released' | 'requirement_closed' | 'requirement_on_hold';

export interface CandidateHistoryEntry {
  submissionId: string;
  requirementId: string;
  requirementTitle: string;
  outcome: PastOutcome;
  at: string;
  reason: string | null;
}

export const PAST_OUTCOME_LABEL: Record<PastOutcome, string> = {
  rejected: 'Previously rejected',
  released: 'Released to talent pool',
  requirement_closed: 'Requirement closed',
  requirement_on_hold: 'Requirement on hold',
};

const ACTIVE_STAGES = new Set(['applied', 'recruiter_review', 'client_review', 'interviewing', 'offered']);

/**
 * Past outcomes for candidates (internal users only): rejected, released, or sitting in a
 * requirement the client has since closed/held. Used to surface reusable candidates on new matches.
 */
export async function fetchCandidateHistory(
  candidateIds: string[],
  excludeRequirementId?: string
): Promise<Map<string, CandidateHistoryEntry[]>> {
  const out = new Map<string, CandidateHistoryEntry[]>();
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('submissions')
    .select('id, candidate_id, requirement_id, stage, rejection_reason, stage_changed_at, updated_at, requirements:requirement_id(id, title, status)')
    .in('candidate_id', ids);
  if (error || !data) return out;

  type Row = {
    id: string;
    candidate_id: string;
    requirement_id: string;
    stage: string;
    rejection_reason: string | null;
    stage_changed_at: string | null;
    updated_at: string | null;
    requirements: { id: string; title: string; status: string } | { id: string; title: string; status: string }[] | null;
  };
  const rows = (data as unknown as Row[]).filter((r) => r.requirement_id !== excludeRequirementId);

  const terminalIds = rows.filter((r) => r.stage === 'rejected' || r.stage === 'withdrawn').map((r) => r.id);
  const reasonBySub = new Map<string, string>();
  if (terminalIds.length > 0) {
    const { data: hist } = await supabase
      .from('submission_stage_history')
      .select('submission_id, to_stage, reason, created_at')
      .in('submission_id', terminalIds)
      .in('to_stage', ['rejected', 'withdrawn'])
      .order('created_at', { ascending: false });
    for (const h of (hist || []) as Array<{ submission_id: string; reason: string | null }>) {
      if (h.reason && !reasonBySub.has(h.submission_id)) reasonBySub.set(h.submission_id, h.reason);
    }
  }

  for (const r of rows) {
    const req = Array.isArray(r.requirements) ? r.requirements[0] : r.requirements;
    let outcome: PastOutcome | null = null;
    if (r.stage === 'rejected') outcome = 'rejected';
    else if (r.stage === 'withdrawn') outcome = 'released';
    else if (ACTIVE_STAGES.has(r.stage) && req?.status === 'on_hold') outcome = 'requirement_on_hold';
    else if (ACTIVE_STAGES.has(r.stage) && (req?.status === 'closed' || req?.status === 'filled')) outcome = 'requirement_closed';
    if (!outcome) continue;
    const entry: CandidateHistoryEntry = {
      submissionId: r.id,
      requirementId: r.requirement_id,
      requirementTitle: req?.title || 'Requirement',
      outcome,
      at: r.stage_changed_at || r.updated_at || '',
      reason: reasonBySub.get(r.id) || r.rejection_reason || null,
    };
    const list = out.get(r.candidate_id) || [];
    list.push(entry);
    out.set(r.candidate_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}
